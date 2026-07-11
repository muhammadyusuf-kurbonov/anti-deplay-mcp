# anti-delay Telegram Bot — Design Spec

## Overview

A Telegram bot interface for the anti-delay task management system. Provides all task CRUD operations as bot commands and a cron-based report sender for pending/delayed tasks. Runs as a standalone long-polling process.

## Env Configuration

| Env Var | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `ANTI_delay_CRON` | No | `0 * * * *` | Cron expression for periodic report |
| `TELEGRAM_CHAT_ID` | No | — | Target chat ID for cron reports (if unset, uses `/start` registration) |

## Architecture

### New File: `src/telegram-bot.ts`

```
src/
  index.ts            — dispatches "telegram" command
  telegram-bot.ts     — Bot class, command handlers, cron
  task-store.ts       — shared (unchanged)
  cli.ts              — unchanged
  mcp-server.ts       — unchanged
  tui.ts              — unchanged
```

### Bot Class

```typescript
class TelegramBot {
  constructor(store: TaskStore, token: string, cronExpr: string)
  start(): Promise<void>  // registers commands, starts polling + cron
}
```

### Chat Registration

- `/start` — registers the chat ID for cron reports
- Chat IDs stored in a simple JSON file at `~/.local/share/anti-delay/chat-ids.json`
- Multiple chats supported

## Bot Commands

| Command | Arguments | Behavior |
|---|---|---|
| `/start` | — | Welcome message, registers chat for cron |
| `/add_task` | (interactive) | Step-by-step: title → dueDate → priority → recurring → confirm |
| `/list` | `status? priority?` | Lists tasks as formatted message with filter buttons |
| `/get_task` | `id` | Shows single task details |
| `/update_task` | (interactive) | Step-by-step field selection and editing |
| `/delete` | `id` | Deletes task with confirmation |
| `/delay` | `id hours` | Delays task, shows delay count |
| `/done` | `id` | Marks done; shows next instance if recurring |
| `/report` | — | Generates inline report of pending/delayed tasks |

### Command Formatting

- Task lists show: `[status] title — Due: YYYY-MM-DD | Priority | Delayed Nx`
- Tasks with `delayCount >= 3` get a warning indicator
- Confirmation prompts use inline keyboard buttons

## Cron Report

- Parses `ANTI_delay_CRON` via `node-cron`
- On each tick, calls `store.report()` to get pending tasks
- Formats a message with:
  - Total pending count
  - Each task: title, due date, delay count
  - Tasks overdue (past due date) highlighted
- Sends to all registered chat IDs
- On error (e.g., bot blocked by user), removes that chat ID from registry

## Dependencies Added

- `grammy` — Telegram Bot API framework
- `node-cron` — cron expression parsing and scheduling

## Entry Point

```bash
anti-delay telegram   # starts the bot
```

Implementation in `src/index.ts`:
```
} else if (args[0] === "telegram") {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.error("TELEGRAM_BOT_TOKEN required"); process.exit(1); }
  const cronExpr = process.env.ANTI_delay_CRON || "0 * * * *";
  const bot = new TelegramBot(store, token, cronExpr);
  bot.start();
```

## Error Handling

- All bot handlers wrapped in try/catch, errors sent as "Something went wrong" messages
- Bot stops gracefully on SIGINT/SIGTERM (stop cron, stop polling)
- Cron errors logged to stderr, don't crash the process

## Non-goals

- No webhook support (long-polling only)
- No user authentication (single-user tool)
- No interactive task creation beyond inline keyboard wizards
