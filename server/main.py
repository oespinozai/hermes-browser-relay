#!/usr/bin/env python3
"""Hermes Browser Relay Server

WebSocket relay for live browser sessions + HTTP capture persistence.
"""
import asyncio
import base64
import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

APP_DIR = Path(__file__).resolve().parent
CAPTURE_DIR = APP_DIR / "captures"
CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Hermes Browser Relay", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Disk persistence helpers (merged from hermes-eyes)
# ---------------------------------------------------------------------------

def persist_capture(
    url: str,
    title: str,
    html: str,
    screenshot_b64: Optional[str] = None,
    user_agent: Optional[str] = None,
    viewport: Optional[dict] = None,
) -> dict:
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    uid = f"{ts}-{int(time.time() * 1000) % 10000}"
    capture_path = CAPTURE_DIR / uid
    capture_path.mkdir(parents=True, exist_ok=True)

    html_file = capture_path / "page.html"
    html_file.write_text(html, encoding="utf-8")

    screenshot_file = None
    if screenshot_b64:
        screenshot_file = capture_path / "screenshot.png"
        try:
            screenshot_file.write_bytes(base64.b64decode(screenshot_b64))
        except Exception:
            screenshot_file = None

    meta = {
        "uid": uid,
        "timestamp": ts,
        "url": url,
        "title": title,
        "user_agent": user_agent,
        "viewport": viewport,
        "files": {
            "html": str(html_file),
            "screenshot": str(screenshot_file) if screenshot_file else None,
        },
    }
    (capture_path / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    latest_dir = CAPTURE_DIR / "latest"
    if latest_dir.exists() or latest_dir.is_symlink():
        latest_dir.unlink()
    latest_dir.symlink_to(capture_path, target_is_directory=True)
    return meta


# ---------------------------------------------------------------------------
# WebSocket session management (original hermes-browser-relay)
# ---------------------------------------------------------------------------

class BrowserSession:
    def __init__(self, websocket: WebSocket, session_id: str):
        self.ws = websocket
        self.id = session_id
        self.url: Optional[str] = None
        self.title: Optional[str] = None
        self.last_state: Optional[dict] = None
        self.connected_at = datetime.utcnow()
        self._pending: Dict[str, asyncio.Future] = {}

    async def send_action(self, action: str, payload: dict, timeout: float = 30.0) -> dict:
        action_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self._pending[action_id] = future
        await self.ws.send_json({
            "type": "action",
            "action_id": action_id,
            "action": action,
            "payload": payload,
        })
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending.pop(action_id, None)

    def resolve_action(self, action_id: str, result: dict):
        fut = self._pending.pop(action_id, None)
        if fut and not fut.done():
            fut.set_result(result)


sessions: Dict[str, BrowserSession] = {}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id: Optional[str] = None
    try:
        data = await websocket.receive_json()
        if data.get("type") != "register":
            await websocket.close(code=4001)
            return
        session_id = data.get("session_id") or str(uuid.uuid4())
        session = BrowserSession(websocket, session_id)
        sessions[session_id] = session
        await websocket.send_json({"type": "registered", "session_id": session_id})
        print(f"[relay] Session registered: {session_id}")
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "state":
                session.url = data.get("url")
                session.title = data.get("title")
                session.last_state = data
                # Also persist to disk so agent can read offline
                try:
                    persist_capture(
                        url=data.get("url", ""),
                        title=data.get("title", ""),
                        html=data.get("html", ""),
                        screenshot_b64=data.get("screenshot_b64"),
                        user_agent=data.get("user_agent"),
                        viewport=data.get("viewport"),
                    )
                except Exception as e:
                    print(f"[relay] persist error: {e}")
            elif msg_type == "action_result":
                session.resolve_action(data.get("action_id"), data.get("result", {}))
            elif msg_type == "pong":
                pass
    except WebSocketDisconnect:
        print(f"[relay] Session disconnected: {session_id}")
    finally:
        if session_id and session_id in sessions:
            del sessions[session_id]


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

@app.get("/sessions")
async def list_sessions():
    return {
        "sessions": [
            {
                "id": s.id,
                "url": s.url,
                "title": s.title,
                "connected_at": s.connected_at.isoformat(),
            }
            for s in sessions.values()
        ]
    }


@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    s = sessions[session_id]
    return {
        "id": s.id,
        "url": s.url,
        "title": s.title,
        "last_state": s.last_state,
        "connected_at": s.connected_at.isoformat(),
    }


class ActionRequest(BaseModel):
    action: str
    payload: dict = {}


@app.post("/sessions/{session_id}/action")
async def send_action(session_id: str, req: ActionRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    result = await sessions[session_id].send_action(req.action, req.payload)
    return {"success": True, "result": result}


@app.post("/sessions/{session_id}/capture")
async def request_capture(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    result = await sessions[session_id].send_action("capture", {})
    return {"success": True, "result": result}


# ---- HTTP capture fallback (merged from hermes-eyes) ----

class CapturePayload(BaseModel):
    url: str
    title: str
    html: str
    screenshot_b64: Optional[str] = None
    user_agent: Optional[str] = None
    viewport: Optional[dict] = None


@app.post("/capture")
async def capture_http(payload: CapturePayload):
    meta = persist_capture(
        url=payload.url,
        title=payload.title,
        html=payload.html,
        screenshot_b64=payload.screenshot_b64,
        user_agent=payload.user_agent,
        viewport=payload.viewport,
    )
    return {"status": "ok", "capture": meta}


@app.get("/latest")
async def latest():
    latest_dir = CAPTURE_DIR / "latest"
    if not latest_dir.exists():
        return {"status": "no_captures"}
    meta_file = latest_dir / "meta.json"
    if not meta_file.exists():
        return {"status": "no_meta"}
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    return {"status": "ok", "capture": meta}


@app.get("/health")
async def health():
    return {"status": "ok", "sessions": len(sessions), "captures_dir": str(CAPTURE_DIR)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3500)
