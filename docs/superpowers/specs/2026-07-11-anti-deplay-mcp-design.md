# anti-deplay MCP + CLI — Design Spec

## Overview

A local-first task management tool for the **Hermes** AI agent (anti-procrastination system). Provides a CLI for the human and an MCP server for the AI agent over the same SQLite-backed task store.

## Architecture

```
src/
  index.ts       — single entry point, dispatches on argv
  task-store.ts  — SQLite CRUD via bun:sqlite
  cli.ts         — CLI output formatting
  mcp-server.ts  — MCP server via @modelcontextprotocol/sdk
```

- **Storage:** SQLite via `bun:sqlite`, no external DB dependencies.
- **DB path:** `~/.local/share/anti-deplay/tasks.db` (XDG_DATA_HOME fallback).
- **One binary, two modes:**
  - `anti-deplay <command>` — CLI mode
  - `anti-deplay serve` — MCP server mode (stdio transport)

## Task Schema

```typescript
interface Task {
  id: string           // crypto.randomUUID()
  title: string
  description: string  // default ""
  dueDate: string      // ISO 8601
  priority: "low" | "medium" | "high"   // default "medium"
  status: "pending" | "done" | "delayed"
  delayCount: number   // unbounded — shown every delay as pressure
  recurring: "daily" | "weekly" | "monthly" | null
  createdAt: string    // ISO 8601
  updatedAt: string    // ISO 8601
}
```

## MCP Tools

| Tool | Input | Description |
|------|-------|-------------|
| `tasks_create` | `{ title, description?, dueDate, priority?, recurring? }` | Create task |
| `tasks_list` | `{ status?, priority? }` | List/filter tasks |
| `tasks_update` | `{ id, title?, description?, dueDate?, priority?, recurring? }` | Update fields |
| `tasks_delete` | `{ id }` | Delete task |
| `delay_task` | `{ id, days }` | Push dueDate forward by 1–7 days, ++delayCount, show count |

## MCP Resources

- `tasks://list` — all tasks
- `tasks://<id>` — single task

## CLI Commands

```
anti-deplay task add <title> [--due <date>] [--priority <...>] [--recurring <...>]
anti-deplay task list [--status <...>]
anti-deplay task update <id> [--title <...>] [--due <...>] [--priority <...>]
anti-deplay task delete <id>
anti-deplay task delay <id> --days <1-7>
anti-deplay task done <id>
anti-deplay serve
```

## Key Behaviors

### delay_task
- `days` must be 1–7 (validated).
- Sets new `dueDate = currentDueDate + days`; status → `"delayed"`.
- Increments `delayCount` and prints it (pressure: "you've delayed this 5 times").
- No limit on delay count.

### Recurring tasks
- **Done →** auto-create next instance with `dueDate` advanced by the period.
- **Delayed →** just pushes due date, no new instance created.

### Reminders
- **Not the app's responsibility.** The MCP server exposes overdue/pending tasks. **Hermes (the AI agent)** reads them and sends conversational reminders to the user. The CLI has no daemon/notification system.

## Dependencies

- `bun` (runtime, sqlite)
- `@modelcontextprotocol/sdk` (MCP)
- No other runtime deps.

## Non-goals

- No daemon, cron, or push notifications.
- No sync, auth, or multi-user.
- No web UI.
