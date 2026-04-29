/* Hermes Browser Relay — Background Service Worker */
const DEFAULT_RELAY = 'ws://localhost:3500/ws';
const RECONNECT_DELAY = 5000;
const HEARTBEAT_INTERVAL = 30000;

let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let sessionId = null;
let relayUrl = DEFAULT_RELAY;

async function getRelayUrl() {
  const stored = await chrome.storage.local.get('relayUrl');
  relayUrl = stored.relayUrl || DEFAULT_RELAY;
  return relayUrl;
}

function setStatus(status, detail = '') {
  chrome.storage.local.set({ status, detail, ts: Date.now() });
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url.startsWith('chrome://')) return null;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      url: location.href,
      title: document.title,
      html: document.documentElement.outerHTML,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    })
  });
  const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  return {
    url: result.result.url,
    title: result.result.title,
    html: result.result.html,
    viewport: result.result.viewport,
    screenshot_b64: screenshot,
    user_agent: navigator.userAgent
  };
}

async function sendState() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const state = await captureActiveTab();
  if (state) ws.send(JSON.stringify({ type: 'state', ...state }));
}

async function connect() {
  await getRelayUrl();
  if (ws) { try { ws.close(); } catch (e) {} }
  setStatus('connecting', `Connecting to ${relayUrl}...`);
  try {
    ws = new WebSocket(relayUrl);
    ws.onopen = async () => {
      setStatus('connected', relayUrl);
      sessionId = self.crypto.randomUUID();
      ws.send(JSON.stringify({ type: 'register', session_id: sessionId }));
      await sendState();
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_INTERVAL);
    };
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'action') handleServerAction(msg);
      else if (msg.type === 'registered') {
        sessionId = msg.session_id;
        chrome.storage.local.set({ sessionId });
      }
    };
    ws.onclose = () => {
      setStatus('disconnected', 'Reconnecting...');
      clearInterval(heartbeatTimer);
      scheduleReconnect();
    };
    ws.onerror = () => setStatus('error', 'WebSocket error');
  } catch (e) {
    setStatus('error', e.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_DELAY);
}

async function handleServerAction(msg) {
  const { action_id, action, payload } = msg;
  let result = {};
  let success = false;
  try {
    switch (action) {
      case 'capture': {
        const state = await captureActiveTab();
        result = state || {}; success = !!state; break;
      }
      case 'screenshot': {
        const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        result = { screenshot_b64: screenshot }; success = true; break;
      }
      case 'navigate': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) { await chrome.tabs.update(tab.id, { url: payload.url }); success = true; }
        break;
      }
      case 'click':
      case 'type':
      case 'scroll':
      case 'snapshot': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && !tab.url.startsWith('chrome://')) {
          const [execResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (act, pld) => {
              try {
                if (act === 'snapshot') {
                  return {
                    url: location.href,
                    title: document.title,
                    html: document.documentElement.outerHTML,
                    text: document.body.innerText.substring(0, 8000)
                  };
                }
                const el = document.querySelector(pld.selector);
                if (!el) return { error: 'Element not found' };
                if (act === 'click') { el.click(); return { clicked: true }; }
                if (act === 'type') {
                  el.value = pld.text || '';
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return { typed: true };
                }
                if (act === 'scroll') { window.scrollTo(pld.x || 0, pld.y || 0); return { scrolled: true }; }
              } catch (e) { return { error: e.message }; }
            },
            args: [action, payload]
          });
          result = execResult.result || {};
          success = !result.error;
        }
        break;
      }
      default: result = { error: 'Unknown action' };
    }
  } catch (e) { result = { error: e.message }; }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'action_result', action_id, success, result }));
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'connect') {
    connect().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (request.action === 'disconnect') {
    if (ws) { ws.close(); ws = null; }
    setStatus('disconnected', 'Manual disconnect');
    sendResponse({ ok: true }); return true;
  }
  if (request.action === 'capture') {
    sendState().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (request.action === 'getStatus') {
    chrome.storage.local.get(['status', 'detail', 'sessionId', 'relayUrl']).then(sendResponse);
    return true;
  }
  if (request.action === 'setRelayUrl') {
    chrome.storage.local.set({ relayUrl: request.url }).then(() => { relayUrl = request.url; sendResponse({ ok: true }); });
    return true;
  }
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
