/* Hermes Browser Relay — Options page */

const DEFAULT_LOCAL = 'ws://localhost:3500/ws';

const localInput = document.getElementById('localUrl');
const publicInput = document.getElementById('publicUrl');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const statusEl = document.getElementById('status');
const localSection = document.getElementById('localSection');
const publicSection = document.getElementById('publicSection');
const modeBtns = document.querySelectorAll('.mode-btn');

let currentMode = 'local';

function setMode(mode) {
  currentMode = mode;
  modeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  localSection.style.display = mode === 'local' ? 'block' : 'none';
  publicSection.style.display = mode === 'public' ? 'block' : 'none';
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

async function load() {
  const stored = await chrome.storage.local.get(['relayMode', 'relayUrl', 'publicRelayUrl']);
  const mode = stored.relayMode || 'local';
  setMode(mode);
  localInput.value = stored.relayUrl || DEFAULT_LOCAL;
  publicInput.value = stored.publicRelayUrl || '';
}

function getActiveUrl() {
  const url = currentMode === 'local'
    ? (localInput.value.trim() || DEFAULT_LOCAL)
    : (publicInput.value.trim() || '');
  return url;
}

async function save() {
  const url = getActiveUrl();
  if (currentMode === 'public' && !url) {
    showStatus('Please enter a public relay URL', 'error');
    return;
  }
  await chrome.storage.local.set({
    relayMode: currentMode,
    relayUrl: localInput.value.trim() || DEFAULT_LOCAL,
    publicRelayUrl: publicInput.value.trim()
  });
  showStatus('Saved!');
}

async function testConnection() {
  const url = getActiveUrl();
  if (!url) { showStatus('No URL configured', 'error'); return; }
  showStatus('Testing...', 'warn');
  try {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.close(); showStatus('Connection timed out', 'error'); }, 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      showStatus('Connected successfully!');
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      showStatus('Connection failed', 'error');
    };
  } catch (e) {
    showStatus(`Error: ${e.message}`, 'error');
  }
}

function showStatus(msg, cls = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

saveBtn.addEventListener('click', save);
testBtn.addEventListener('click', testConnection);
load();
