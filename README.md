# opencode-web

Browser-based web UI for [opencode](https://github.com/anomalyco/opencode) agent.

## Architecture

```
Browser (SSE client)
    │
    ▼
server.js (Node HTTP + SSE proxy)
    │
    ▼
opencode.exe (spawned per request, --format json NDJSON output)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Web UI |
| `POST` | `/api/send` | Send message, returns SSE stream |
| `GET` | `/api/sessions` | List sessions from all project directories |
| `GET` | `/api/session/:id` | Export session history |
| `DELETE` | `/api/session/:id` | Delete session |
| `GET` | `/api/files/:path` | List files (recursive tree, max depth 3) |
| `GET` | `/api/file/:path` | Read file content (max 50KB) |

## Key Design Decisions

### Multi-project session listing

`/api/sessions` queries `opencode session list` from **both** the kimaki root project and the `Projects/` sub-project, then merges and deduplicates by session ID. This is necessary because `opencode session list` is project-scoped — sessions created with `--dir Projects/` get a different `projectID` from sessions created at the kimaki root.

### SSE heartbeat

Every 12 seconds, the server sends an SSE comment (`: hb\n\n`) to prevent HTTP idle timeouts in proxies and tunnels during multi-step tool calls where there may be long LLM processing pauses between events.

### Directory resolution

- All `opencode` spawns use `cwd: ROOT` (the kimaki project root) to ensure consistent project context for session management commands
- New sessions pass `--dir Projects/` so the agent operates in the Projects subdirectory
- Resume sessions pass `--dir <session-directory>` from the client to match the session's stored directory, avoiding a CWD mismatch that causes opencode to hang silently

## Configuration

`.env`:
```
PORT=3458
OP_WORKDIR=C:\Users\LukeC\.kimaki\projects\kimaki\opencode-web\Projects
OP_AGENT=build
```

## Known Issues

### Response sometimes doesn't render until page refresh

**Symptom:** After sending a message, tool calls appear but the final text response never fills the reply box. The send button re-enables but no text is visible. Refreshing the page shows the complete response — the data was saved correctly, just not streamed to the UI.

**Workaround:** Refresh the page. All data is persisted in the opencode session on disk.

### Cold start latency per message

Each `opencode run` invocation starts an ephemeral server, adding 2-5s latency. Larger sessions take longer due to history loading.
