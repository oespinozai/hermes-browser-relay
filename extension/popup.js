const els = {
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  relayUrl: document.getElementById('relay-url'),
  sessionId: document.getElementById('session-id'),
  btnConnect: document.getElementById('btn-connect'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  btnCapture: document.getElementById('btn-capture'),
  toast: document.getElementById('toast')
};

function setStatus(status, detail) {
  const map = {
    connected: { cls: 'ok', text: 'Connected' },
    connecting: { cls: 'warn', text: 'Connecting...' },
    disconnected: { cls: 'bad', text: 'Disconnected' },
    error: { cls: 'bad', text: 'Error' }
  };
  const s = map[status] || { cls: 'bad', text: status };
  els.statusDot.className = s.cls;
  els.statusText.textContent = detail || s.text;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2000);
}

async function refresh() {
  const data = await chrome.runtime.sendMessage({ action: 'getStatus' });
  if (data.relayUrl) els.relayUrl.value = data.relayUrl;
  if (data.sessionId) els.sessionId.value = data.sessionId;
  setStatus(data.status || 'disconnected', data.detail);
}

els.btnConnect.addEventListener('click', async () => {
  const url = els.relayUrl.value.trim();
  if (url) await chrome.runtime.sendMessage({ action: 'setRelayUrl', url });
  const res = await chrome.runtime.sendMessage({ action: 'connect' });
  if (res.ok) showToast('Connecting...');
  else showToast(res.error || 'Failed');
  setTimeout(refresh, 500);
});

els.btnDisconnect.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'disconnect' });
  showToast('Disconnected');
  refresh();
});

els.btnCapture.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ action: 'capture' });
  if (res.ok) showToast('Captured!');
  else showToast(res.error || 'Capture failed');
});

document.addEventListener('DOMContentLoaded', refresh);
