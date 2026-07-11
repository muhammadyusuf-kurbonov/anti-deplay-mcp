# anti-delay-mcp

Anti-procrastination task manager with CLI, TUI, and MCP server interfaces over a shared SQLite store.

## Quick start

```bash
bun run src/index.ts              # TUI (default, no args)
bun run src/index.ts serve         # MCP server (stdio transport)
bun run src/index.ts task add "..." --due 2026-07-15  # CLI
bunx tsc --noEmit                  # typecheck
```

No `package.json` scripts — run source files directly via `bun run`. No test framework or lint configured.

## Runtime

- **Bun** 1.x, not Node. All commands use `bun` / `bunx`. TypeScript runs directly without a build step.
- `tsc` is available for typechecking only (output never used — `dist/` is stale).
- `bun build` uses Bun's own bundler, not `tsc`.

## Architecture

```
src/index.ts         → dispatches to TUI / CLI / MCP server by argv
src/task-store.ts    → SQLite CRUD via bun:sqlite (WAL mode)
src/cli.ts           → CLI: add, list, update, delete, delay, done, report
src/mcp-server.ts    → MCP SDK stdio server (7 tools, 2 resources)
src/tui.ts           → terminal UI via raw ANSI escape codes
```

Single package, no monorepo. One runtime dependency: `@modelcontextprotocol/sdk`.

## Database

Path: `$XDG_DATA_HOME/anti-delay/tasks.db` → `~/.local/share/anti-delay/tasks.db` → `/tmp/anti-delay/tasks.db`.

No migrations — schema is `CREATE TABLE IF NOT EXISTS` on every startup. Schema has columns: `id, title, description, dueDate, priority, status (pending/done/delayed), delayCount, recurring (daily/weekly/monthly/null), createdAt, updatedAt`.

## Conventions

- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters`.
- MCP tool names are snake_case with `anti_delay_` prefix.
- CLI subcommand is `task` (dispatched as `args[0] === "task"`, stripped before forwarding).
- Task delay is specified in hours (1–168), stored as days (ceil(hours/24)).
- All interfaces accept `TaskStore` in the constructor.
- No auth, no multi-user, no rate limiting.

## Gotchas

- Help text prints `anti-deploy` (typo) instead of `anti-delay` in `src/index.ts:39-40`.
- No `.gitignore` — `node_modules/` is present and would be tracked if committed.
- Telegram bot is designed (`docs/superpowers/specs/`) but not implemented — no `telegram` command in dispatcher.
