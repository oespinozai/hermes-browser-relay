/* Hermes Browser Relay — Options page */

const DEFAULT_RELAY_URL = 'ws://localhost:3500/ws';

const input = document.getElementById('relayUrl');
const btn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

async function load() {
  const stored = await chrome.storage.local.get('relayUrl');
  input.value = stored.relayUrl || DEFAULT_RELAY_URL;
}

async function save() {
  const url = input.value.trim() || DEFAULT_RELAY_URL;
  await chrome.storage.local.set({ relayUrl: url });
  statusEl.textContent = 'Saved!';
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

btn.addEventListener('click', save);
load();
