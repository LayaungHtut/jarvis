# JARVIS — Autonomous Desktop AI Assistant

A Tony-Stark-style desktop assistant: a **SvelteKit** HUD talks to a **TypeScript agent core** over WebSocket, and the agent plans, approves, and executes tools (apps, files, terminal, browser, screenshots, memory) to perform tasks on your machine.

The whole project — frontend and agent — is one SvelteKit/TypeScript codebase. No Python backend.

---

## Screens

The HUD renders:

- **Conversation** — transcript of you and JARVIS.
- **Core orb** — live agent status (IDLE / LISTENING / THINKING / EXECUTING / SPEAKING / ERROR…).
- **Task** — current task plan, running step, recent tool calls, errors.
- **System** — CPU, memory, disk, uptime, active window telemetry.
- **Event stream** — scrolling log of everything the agent does.
- **Permission modal** — grants/denies high-risk actions (write, delete, terminal).
- **MIC** — records your voice and sends it to the backend for transcription.

---

## Getting started

### Prerequisites

- **Node.js 24+** (uses `node:sqlite` — no native dependencies) and npm.
- An LLM provider (at least one of):
  - **OpenRouter** — set `OPENROUTER_API_KEY`.
  - **Local** — any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp) via `LOCAL_LLM_URL`.
  - **None** — the built-in deterministic `Planner` handles common intents (open apps, list windows, file read/write, system info, search).

### Install

```sh
npm install
cp .env.example .env   # then edit as needed
```

### Run (both servers)

```sh
npm run dev:all
```

This starts:

- the **agent backend** (`server/index.ts`) on `ws://127.0.0.1:8765/ws`
- the **SvelteKit dev server** on `http://localhost:5173`

Open http://localhost:5173 and start commanding.

You can also run them separately:

```sh
npm run server     # backend only (port 8765)
npm run dev        # frontend only (port 5173), proxies /ws + /api to 8765
```

### Verify

```sh
npm run check        # frontend typecheck (svelte-check)
npm run check:server # backend typecheck (tsc)
npm run lint         # prettier + eslint
npm run test         # unit (vitest) + e2e (playwright)
npm run build        # production build
```

---

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable                  | Default                                          | Purpose                                     |
| ------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `JARVIS_PORT`             | `8765`                                           | Agent WebSocket + REST port                 |
| `JARVIS_HOST`             | `127.0.0.1`                                      | Bind address                                |
| `JARVIS_DATA_DIR`         | `data`                                           | SQLite memory, logs, screenshots            |
| `JARVIS_WORKSPACE`        | repo root                                        | Filesystem-tool sandbox root                |
| `JARVIS_PERMISSIONS`      | `low:true,medium:true,high:false,critical:false` | Auto-approve per level                      |
| `OPENROUTER_API_KEY`      | —                                                | Cloud LLM provider (account 1)              |
| `OPENROUTER_API_KEY_2..4` | —                                                | Optional extra accounts for the model chain |
| `LOCAL_LLM_URL`           | `http://127.0.0.1:11434`                         | Local OpenAI-compatible endpoint            |
| `LOCAL_LLM_MODEL`         | `qwen2.5:7b`                                     | Default local model                         |
| `JARVIS_WAKE_WORD`        | `jarvis`                                         | Wake word (Stage 1 state machine)           |
| `JARVIS_STT_PROVIDER`     | `none`                                           | `none` \| `whisper-cli` \| `openai`         |
| `WHISPER_BIN`             | `whisper`                                        | Path to whisper CLI for `whisper-cli` STT   |
| `OPENAI_API_KEY`          | —                                                | Required for `openai` STT                   |
| `JARVIS_TTS_PROVIDER`     | `windows`                                        | `windows` (System.Speech) \| `none`         |

### Model chain (multi-account)

Tool-using commands run through a **planner → executor → critic → optimizer**
chain, where each role is a separate OpenRouter account whose key lives in
`OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_2`, `OPENROUTER_API_KEY_3`,
`OPENROUTER_API_KEY_4`. Billing and rate limits are per key, so spreading the
chain across accounts avoids throttling a single one. If a role's account key is
missing the router falls back to the first configured key; with no OpenRouter
keys at all it degrades to the local provider.

Role → model → account routing is configured in `config/models.yaml` (defaults
are also baked into `server/config/models.ts`):

```yaml
chain:
  planner: { account: 1, model: openai/gpt-4o-mini }
  executor: { account: 2, model: anthropic/claude-3.5-haiku }
  critic: { account: 3, model: deepseek/deepseek-chat }
  optimizer: { account: 4, model: qwen/qwen-2.5-72b-instruct }
```

During each run the agent broadcasts `CHAIN_ACTIVITY` events (role, account,
model, phase: `plan`/`execute`/`critique`/`optimize`) on the wire so the HUD can
show which model is doing what.

### Permissions

The agent requests confirmation **before** medium+ actions unless the level is auto-approved.

```sh
# approve lows and mediums automatically, ask for high/critical
JARVIS_PERMISSIONS="low:true,medium:true,high:false,critical:false"
```

---

## Architecture

```
┌──────────────┐   WebSocket (ws://:8765/ws)   ┌──────────────────────────────┐
│  SvelteKit   │ ──────── commands ──────────► │  JarvisServer (server/ws)     │
│   HUD (src)  │ ◄─── events + snapshots ───── │   ├─ EventBus                 │
│  runes store │                               │   ├─ Agent (plan→execute→…)   │
│  ws client   │                               │   ├─ ToolRegistry + tools     │
└──────────────┘                               │   ├─ Router (LLM providers)   │
                                               │   ├─ Memory (node:sqlite)     │
                                               │   ├─ PermissionGate           │
                                               │   └─ VoiceEngine (STT/TTS)    │
                                               └──────────────────────────────┘
```

### Agent lifecycle

1. **Understand** — `Agent.runLoop` asks the deterministic `Planner` for a plan; if that only yields a chat reply and an LLM is configured, it escalates to the LLM for a richer multi-step plan.
2. **Execute** — the `Executor` runs each step through the tool registry, enforcing the permission gate and the 12-iteration / 5-minute budget.
3. **Recover** — a failed step is re-attempted: when an LLM is configured, it analyzes the failure (tool + error + prior calls) and decides to **retry** with corrected arguments, **workaround** with a different tool, or **give up**. Without an LLM it falls back to one blind retry.
4. **Complete** — the agent writes the result to the conversation, memory, and audit log, then returns to idle.

### Tools

| Tool                                    | Level      | Notes                                 |
| --------------------------------------- | ---------- | ------------------------------------- |
| `open_application`                      | low        | launch apps by friendly name          |
| `list_windows` / `get_active_window`    | low        | PowerShell WMI                        |
| `open_url` / `search_web`               | low        | default browser                       |
| `read_page`                             | medium     | headless Playwright read              |
| `system_info`                           | low        | CPU/RAM/disk/uptime telemetry         |
| `read_file` / `list_dir`                | low        | workspace-sandboxed                   |
| `write_file`                            | medium     | workspace-sandboxed, asks permission  |
| `delete_file`                           | high       | workspace-sandboxed, asks permission  |
| `run_command`                           | high       | terminal, policy-gated                |
| `take_screenshot`                       | medium     | screen capture                        |
| `chat`                                  | low        | conversational replies                |
| `remember` / `recall` / `remember_task` | low        | SQLite/cloud memory (category-routed) |
| `opencode` / `opencode_available`       | medium/low | delegates coding to opencode          |

### Wire protocol

Everything is JSON over a single WebSocket.

**Client → server**

```jsonc
{ "type": "command", "text": "open notepad" }
{ "type": "stop" }
{ "type": "cancel_task", "task_id": "…" }
{ "type": "permission_response", "request_id": "…", "granted": true }
{ "type": "request_snapshot" }
{ "type": "voice_audio", "audio_b64": "…", "mime": "audio/webm" }
{ "type": "ping" }
```

**Server → client**

```jsonc
{ "type": "snapshot", "payload": { "status": "idle", "task": null, … } }
{ "type": "event", "event": "TOOL_STARTED", "payload": { … } }
```

Events include: `STATUS_CHANGED`, `TASK_UPDATED`, `CONVERSATION_UPDATED`, `PLAN_CREATED`, `TOOL_STARTED/COMPLETED/FAILED`, `PERMISSION_REQUESTED/RESOLVED`, `CHAIN_ACTIVITY`, `SPEECH_STARTED/FINISHED`, `VOICE_STATE_CHANGED`, `LOGGED`, `TRANSCRIPTION_READY`, `SYSTEM_INFO_UPDATED`, `TASK_COMPLETED/FAILED/CANCELLED`.

---

## Voice (Stage 1)

- **TTS** works out of the box on Windows (`System.Speech`). JARVIS speaks its
  final reply to every command; mute/unmute from the HUD (**VOICE** toggle) or
  the `set_voice` WS message, or set `JARVIS_TTS_PROVIDER=none` to disable by
  default.
- **STT** is optional: set `JARVIS_STT_PROVIDER=whisper-cli` (a `whisper` binary on PATH or `WHISPER_BIN`) or `openai` (+`OPENAI_API_KEY`).
- Hold the **MIC** button in the HUD and speak; the recording is sent to the backend (`voice_audio`), transcribed, and injected as a command.
- With STT disabled you still get the STATE MACHINE and a clear diagnostic in the event stream.

---

## Storage

- `data/memory.db` — SQLite long-term memory (facts, preferences, tasks, project context) via `node:sqlite`.
- `data/logs/audit.ndjson` — one JSON line per event/tool call, secrets redacted.

### Multi-database memory (optional)

JARVIS can spread long-term memory across remote databases. Memory entries are
grouped into **categories** (e.g. `identity`, `work`, `school`, `projects`,
`preferences`) and each category is **routed to one database** via
`JARVIS_MEMORY_ROUTES`; unlisted categories fall back to local SQLite. Reads
always search across every configured store.

Configure up to **two Supabase projects and two Neon databases**:

| Variable                        | Use                                                                    |
| ------------------------------- | ---------------------------------------------------------------------- |
| `JARVIS_MEMORY_ROUTES`          | `identity:supabase-1,work:supabase-2,school:neon-1,preferences:neon-2` |
| `SUPABASE_URL_1/2`              | Supabase REST endpoint per account                                     |
| `SUPABASE_SERVICE_ROLE_KEY_1/2` | Service-role key (bypasses RLS)                                        |
| `SUPABASE_DATABASE_URL_1/2`     | Postgres connection string per account (migrations only)               |
| `NEON_DATABASE_URL_1/2`         | Neon connection string per account (runtime + migrations)              |

Migrations live per database account and are applied with
`npm run migrate:memory`:

```
migrations/supabase/account-1/001_init.sql
migrations/supabase/account-2/001_init.sql
migrations/neon/account-1/001_init.sql
migrations/neon/account-2/001_init.sql
```

The runner tracks applied files in a `schema_migrations` table, so re-running is
idempotent.

```sh
# apply all configured cloud memory schemas
npm run migrate:memory
```

**Note:** if a cloud store is unreachable, JARVIS keeps working — writes to that
store fail with a tool-level error while local memory and other stores continue
to serve reads.

---

## Testing

```sh
npm run test:unit            # vitest (planner, permissions, memory) + browser component tests
npm run test:e2e             # playwright (needs: npx playwright install)
```

If `npx playwright install` can't reach `cdn.playwright.dev`, use a mirror:

```sh
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://registry.npmmirror.com/-/binary/playwright"; npx playwright install chromium
```

---

## Roadmap

- [x] WebSocket agent server, tool registry, agent loop, permission gate
- [x] Deterministic planner (+ optional LLM planning)
- [x] HUD: status orb, conversation, task, system, event stream, permissions
- [x] Mic capture + backend STT wiring
- [ ] Wake-word detection (Vosk/OpenWakeWord)
- [x] LLM-driven self-healing recovery pass
- [ ] Rule DSL + named permission profiles
- [ ] Standalone Tauri/Electron shell
