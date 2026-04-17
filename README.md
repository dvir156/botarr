# Telegram Media Agent (Radarr + Sonarr + Plex)

Node.js (TypeScript) Telegram bot that uses a tool-calling LLM agent to query and control Radarr and Sonarr in natural language. **Plex is optional** (omit `PLEX_URL` and `PLEX_TOKEN` to disable duplicate checks via Plex).

## Features

- **Telegram:** allowlisted users, typing indicator, long replies split at 4096 characters, inline keyboard (1–10 + Cancel) after **release previews** and after **movie/series search disambiguation** lists (when the assistant message matches the expected numbered + link format), commands `/help`, `/status`, `/cancel`
- **Agent:** OpenAI Responses API or local OpenAI-compatible chat (Ollama, etc.), in-memory conversation context, pending picks (search row vs release) with cancel phrases
- **Integrations:** typed Axios clients, Zod-validated tool inputs, structured JSON logging
- **Startup:** validates LLM env (OpenAI key when using cloud API), loads Radarr/Sonarr (required) and optional Plex, **health-checks** configured services before the bot goes online

## Requirements

- Node.js 20+
- Radarr v3 API, Sonarr v3 API (Plex optional)
- Telegram bot token
- OpenAI API key **or** a local OpenAI-compatible LLM

## Setup

```bash
npm install
```

Copy [`.env.example`](.env.example) to `.env` and fill in values.

The npm package name is `telegram-media-agent`; the repository is often checked out as **botarr** — they refer to the same project.

### Preferences database

User settings from `/prefs` are stored in SQLite. Optional env var **`BOTARR_DB_PATH`** sets the database file (default: `./data/botarr.sqlite`). The parent directory is created if needed.

### Telegram users

Set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of numeric Telegram user IDs. Optionally set legacy `TELEGRAM_ALLOWED_USER_ID` for a single user (merged into the list).

### LLM

- **OpenAI (default):** `LLM_PROVIDER=openai_responses` (or omit) and set `OPENAI_API_KEY`. Set `LLM_MODEL` to your chosen model name.
- **Local:** e.g. Ollama:

  ```env
  LLM_PROVIDER=local_openai_compat
  LOCAL_LLM_BASE_URL=http://localhost:11434/v1
  LLM_MODEL=llama3.1
  ```

  `OPENAI_API_KEY` can be empty for local.

## Run

**Development**

```bash
npm run dev
```

**Production**

```bash
npm run build
npm start
```

**Tests**

```bash
npm test
```

## Usage

- Chat in plain English: e.g. “do I already have Interstellar?”, “download Dune 2 in 4K”, “Summer House S10E10”.
- After the bot shows a **numbered movie search list** (multiple TMDB links) or **TV search list** (multiple TheTVDB links), reply with a number or tap the **inline buttons**, then pick a release the same way on the next screen.
- After a **release list**, reply with a number `1`–`5` (or use the **inline buttons**), or say **cancel** / **never mind** to dismiss any pending list or release pick.
- **Commands:** `/help`, `/status` (reachability of Radarr, Sonarr, Plex), `/cancel` (same as sending “cancel” when a pick is pending).

## Security note

Access is controlled only by **`TELEGRAM_ALLOWED_USER_IDS`**. Anyone on that list can use the bot’s integrations and LLM. Do not point this bot at untrusted Telegram users without extra safeguards (rate limits, monitoring, separate credentials). See [SECURITY.md](SECURITY.md).

## Troubleshooting

| Issue | What to do |
|--------|------------|
| **409 Conflict** on `getUpdates` | Only one bot process may poll Telegram. Stop duplicate `npm run dev` / second instance. |
| **Bot “doesn’t see” messages in a group** | With BotFather **privacy mode ON**, the bot only sees commands and `@BotName` mentions. |
| **Startup fails: health check** | Verify `RADARR_URL` / `SONARR_URL` / `PLEX_URL` and API keys; ensure URLs are reachable from the machine running the bot. |
| **Unauthorized** | Your Telegram user id must appear in `TELEGRAM_ALLOWED_USER_IDS`. |
| **No buttons on a search list** | The bot only attaches keyboards when the assistant message looks like a **numbered list** with **at least two** TMDB movie links (movies) or **two** `thetvdb.com/?tab=series&id=` links (series). Ask again in one message if the model omitted links or used a different format. |
| **LLM says “too many tool steps”** | The model hit the tool-call step limit; try a shorter request or split it into two messages. |

## Project structure

```
src/
  index.ts                 # Delegates to app entry
  app/
    index.ts               # Env validation, health checks, starts the bot
  agents/
    mediaAgent.ts          # Orchestration (numeric pick, cancel, LLM loops)
    toolDefinitions.ts     # OpenAI tool schemas
    executeMediaTool.ts    # Tool dispatch + pending release state
    llm/                   # OpenAI Responses + local chat loops, output parsing
    prompts/
    conversationHistory.ts
    pendingActions.ts
  bot/
    telegram.ts            # Telegraf, keyboards, chunking, commands
    telegramChunks.ts
    runSerializedForUser.ts # Serialize agent work per Telegram user (in-memory state)
  clients/                 # Radarr, Sonarr, Plex, OpenAI, local LLM HTTP clients
  config/                  # env + logger
  preferences/             # SQLite prefs (/prefs_* commands)
  startup/
    healthCheck.ts         # Startup + /status pings
  tools/                   # Radarr, Sonarr, Plex tool implementations
  types/
  util/
    httpErrorMessage.ts    # User-facing HTTP errors
```

## Manual smoke test

1. Start the bot: `npm run dev`.
2. From an allowlisted account: “do I already have Interstellar?” — expect Plex check; **already available** if in library.
3. “download dune 2 4k” — Plex check, then Radarr flow; pick a release number or button when prompted.
