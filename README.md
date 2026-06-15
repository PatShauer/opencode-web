# opencode-web

Browser-based interface for [opencode](https://opencode.ai), providing persistent sessions, file tree browsing, and streaming agent output — all through a tunnel-friendly SSE architecture.

## Prerequisites

- **Node.js** 24+
- **opencode CLI** installed and configured (`opencode --version` should work)
- API provider configured in opencode (`opencode providers`)

The server spawns `opencode.exe` directly — make sure the binary path in `server.js` points to your installation.

## Quick Start

```bash
cd opencode-web
cp .env.example .env
npm install
node server.js
```

Then expose it:
```bash
kimaki tunnel -p 3458
```

## Architecture

```
Browser                     Server (Node.js)                opencode CLI
  │                              │                              │
  │  POST /api/send {msg, sid}   │                              │
  │─────────────────────────────>│  spawn opencode run --format json --session <sid>
  │                              │─────────────────────────────>│
  │                              │         stdout (JSON lines)  │
  │                              │<─────────────────────────────│
  │  SSE: data: {"type":"text",  │                              │
  │        "text":"Hello"}       │                              │
  │<─────────────────────────────│                              │
  │                              │                              │
  │  Refresh page                │                              │
  │  GET /api/session/<id>       │  opencode export <id>        │
  │<─────────────────────────────│<─────────────────────────────│
```

### Why not terminal scraping?

v1 attempted to capture opencode's TUI via `tuistory`. That approach was abandoned — the TUI produces box-drawing characters, cursor repositioning artifacts, and full-screen redraws that make content extraction unreliable.

v2 uses `opencode run --format json`, which outputs clean structured JSON events to stdout. No terminal involved.

## API Reference

### `POST /api/send`

Sends a message to opencode and streams JSON events back via SSE.

**Request:**
```json
{"message": "list files", "sessionId": "ses_xxx"}
```

If `sessionId` is omitted, a new session is created. The session ID is returned in the event stream.

**Response:** SSE stream of JSON lines. Each line is `data: <json>\n\n`.

**Event types:**

| type | part field | meaning |
|---|---|---|
| `step_start` | — | opencode begins processing |
| `text` | `.text` | Assistant response text delta |
| `tool_use` | `.tool`, `.state.input`, `.state.output` | Tool call (bash, read, write, etc.) |
| `step_finish` | `.tokens`, `.reason` | Step completed; `reason` is `"stop"` or `"tool-calls"` |
| `session` | `.id` | Session ID (emitted once per new session) |
| `done` | — | Stream ended |

### `GET /api/session/:id`

Returns the exported session data from `opencode export <id>` as JSON.

**Response structure:**
```json
{
  "info": {"id": "...", "title": "...", "directory": "...", ...},
  "messages": [
    {
      "info": {"role": "user|assistant", ...},
      "parts": [
        {"type": "text", "text": "..."},
        {"type": "tool", "tool": "bash", "state": {"input": {...}, "output": "..."}}
      ]
    }
  ]
}
```

### `GET /api/sessions`

Lists all opencode sessions via `opencode session list --format json`. Returns an array of `{id, title, updated, directory}`.

### `DELETE /api/session/:id`

Deletes a session via `opencode session delete <id>`.

### `GET /api/files/<path>`

Recursive directory listing (max depth 3, skips `node_modules` and `.git`).

Returns:
```json
[{"name":"server.js","type":"file","_path":"C:\\full\\path"}, ...]
```

### `GET /api/file/<path>`

Reads a file (max 50000 chars). Returns `{"path":"...","content":"..."}`.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3458` | HTTP listen port |
| `OP_MODEL` | `deepseek/deepseek-v4-pro` | `provider/model` format |
| `OP_AGENT` | `build` | Agent name |
| `OP_WORKDIR` | `process.cwd()` | Working directory passed as `--dir` to opencode |

## Session Model

opencode sessions are stored on disk by the opencode CLI. Both `opencode run --session` and kimaki's Discord threads write to the same session storage. This means:

- Sessions created in opencode-web appear in kimaki's session list and vice versa
- Messages sent from either interface accumulate in the same conversation
- Deleting a session removes it from both

Session IDs are stored in `localStorage` on the browser side. The header shows the session title (from the export data).

## Frontend Structure

Single HTML file (`public/index.html`), no build step.

**Key DOM elements:**
- `#output` — message container
- `#input` / `#sendBtn` — input area
- `#info` / `#pathInfo` / `#ctxInfo` — header status (title, path, context %)
- `#sidebar` / `#sidebarTree` — file tree panel
- `#sessionMenu` — session list dropdown
- `#filePreview` — inline file viewer

**Event flow:**
1. User types → `send()` → `POST /api/send` → SSE reader loop
2. Each SSE event is parsed and dispatched by type
3. Text events append to `.msg.assistant > .content`
4. Tool use events create `.msg.tool` elements inserted before the assistant div
5. `done` event ends the loop, re-enables send button

**CSS conventions:** Minimal classes prefixed by semantic role. Light theme (white backgrounds, `#4f46e5` accent). Sidebar slides in from right.

## Known Issues

### Response sometimes doesn't render until page refresh

**Symptom:** After sending a message, tool calls appear but the final text response never fills the reply box. The send button re-enables but no text is visible. Refreshing the page shows the complete response — the data was saved correctly, just not streamed to the UI.

**Likely cause:** `opencode run` occasionally exits without emitting a final `text` event. The stream ends (`stdout.on("end")` fires) but no text delta was ever sent. The fallback (last tool output display) doesn't always trigger because the tool output may be empty or the stream ends between steps.

**Workaround:** Refresh the page. All data is persisted in the opencode session on disk.

**Possible fixes to investigate:**
- Parse `step_finish` with `reason: "stop"` and synthesize a text event from the session export
- Add a client-side timeout that reloads the session if no text arrives within N seconds
- Use `opencode run --continue` mode instead of `--session` to avoid cold-start context switching

### Cold start latency per message

Each `opencode run` invocation starts an ephemeral server, adding 2-5s latency. Larger sessions take longer due to history loading.
