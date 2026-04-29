# Hermes Eyes

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.9+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg?logo=fastapi&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4.svg?logo=googlechrome&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-Realtime-010101.svg)

![Hermes Eyes Banner](assets/banner.png)

**Hermes Eyes** gives your AI assistant a direct view into your browser. A Chrome extension captures the active tab's DOM, screenshot, and viewport state, then streams it to a relay server where your agent can inspect pages, run commands, and persist captures to disk.

Built for authenticated pages, design tools, and dynamic state that headless browsers can't reach.

---

## What It Does

| Feature | How |
|---------|-----|
| **Live page capture** | Screenshot + full DOM + viewport metadata on every state update |
| **Persistent relay** | WebSocket connection with auto-reconnect and heartbeat |
| **Bidirectional control** | Agent can send commands: `capture`, `click`, `type`, `scroll`, `navigate`, `screenshot`, `snapshot` |
| **Disk persistence** | Every capture is saved to disk with a `latest` symlink for easy access |
| **HTTP fallback** | POST `/capture` and GET `/latest` for manual or scripted capture |
| **Configurable** | Extension options page — no hardcoded URLs |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/oespinozai/hermes-eyes.git
cd hermes-eyes
```

### 2. Start the server

```bash
cd server
pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 3500
```

Or use the systemd service:

```bash
sudo systemctl enable --now hermes-browser-relay
```

### 3. Install the Chrome extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Click the extension icon → **Options** → set your relay URL (default: `ws://localhost:3500/ws`)

### 4. Connect

The extension auto-connects on startup. Click **Capture Tab** in the popup to send the current page to your agent immediately.

---

## API

### WebSocket `/ws`

| Message | Direction | Purpose |
|---------|-----------|---------|
| `register` | Extension → Server | Start a session |
| `state` | Extension → Server | Full page capture (auto-persisted) |
| `action` | Server → Extension | Remote command (`capture`, `click`, `type`, `scroll`, `navigate`, `screenshot`, `snapshot`) |
| `action_result` | Extension → Server | Command response |
| `ping` / `pong` | Both | Keepalive |

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status + active session count |
| `/sessions` | GET | List active sessions |
| `/sessions/{id}` | GET | Session details + last state |
| `/sessions/{id}/action` | POST | Send action to a session |
| `/sessions/{id}/capture` | POST | Request a capture |
| `/capture` | POST | One-shot HTTP capture (no WebSocket needed) |
| `/latest` | GET | Metadata for the most recent persisted capture |

---

## Project Structure

```
.
├── extension/          # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js     # Service worker — WebSocket client
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   ├── options.html      # Configurable relay URL
│   ├── options.js
│   ├── content.js
│   └── icons/
├── server/             # FastAPI relay server
│   ├── main.py
│   ├── requirements.txt
│   └── captures/         # Persisted captures
└── assets/
    └── banner.png
```

---

## Use Cases

- **Design review** — Share Figma, Framer, or Webflow pages with your agent
- **Auth-walled debugging** — Dashboards, admin panels, SaaS apps
- **Content QA** — Blog posts, landing pages, CMS previews
- **E2E assistance** — Agent guides you through workflows by seeing your screen

---

## License

MIT
