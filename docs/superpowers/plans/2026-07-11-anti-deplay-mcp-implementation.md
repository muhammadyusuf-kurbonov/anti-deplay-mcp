# anti-deplay MCP + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server + CLI for the Hermes anti-procrastination system with SQLite-backed task CRUD and delay_task (max 7 days).

**Architecture:** Single package, dual entry point. `src/index.ts` dispatches on argv: CLI commands or MCP server mode (`serve`). `src/task-store.ts` is the shared SQLite layer via `bun:sqlite`. `src/cli.ts` formats output, `src/mcp-server.ts` exposes tools/resources via `@modelcontextprotocol/sdk`.

**Tech Stack:** Bun, TypeScript, bun:sqlite, @modelcontextprotocol/sdk

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts` (stub)

- [ ] **Step 1: Init project via `bun init`**

```bash
cd /home/muhammadyusuf-kurbonov/Projects/MyProjects/anti-deplay-mcp
bun init -y
```

Expected: creates `package.json`, `tsconfig.json`, `index.ts` in current dir.

- [ ] **Step 2: Write package.json with proper config**

```json
{
  "name": "anti-deplay",
  "version": "0.1.0",
  "module": "src/index.ts",
  "type": "module",
  "bin": {
    "anti-deplay": "./src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.8.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

Install: `bun install`

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write stub src/index.ts**

```typescript
import { argv } from "bun";

function main() {
  const args = argv.slice(2);
  if (args[0] === "serve") {
    console.log("MCP server mode: not yet implemented");
  } else {
    console.log("CLI mode: not yet implemented");
  }
}

main();
```

- [ ] **Step 5: Verify stub runs**

```bash
bun run src/index.ts --help
```
Expected: prints "CLI mode: not yet implemented"

- [ ] **Step 6: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold bun project"
```

---

### Task 2: TaskStore — SQLite CRUD layer

**Files:**
- Create: `src/task-store.ts`
- Used by: `src/cli.ts`, `src/mcp-server.ts`

- [ ] **Step 1: Write TaskStore with schema and all methods**

 ```typescript
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export interface Task {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "done" | "delayed";
  delayCount: number;
  recurring: "daily" | "weekly" | "monthly" | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateTaskInput = {
  title: string;
  description?: string;
  dueDate: string;
  priority?: "low" | "medium" | "high";
  recurring?: "daily" | "weekly" | "monthly";
};

export type UpdateTaskInput = Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>;

export type MarkDoneResult =
  | { ok: true; task: Task; next?: Task }
  | { ok: false; error: string };

export class TaskStore {
  private db: Database;

  constructor(dbPath?: string) {
    const dir = dbPath ?? getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const fullPath = join(dir, "tasks.db");
    this.db = new Database(fullPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        dueDate TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','delayed')),
        delayCount INTEGER NOT NULL DEFAULT 0,
        recurring TEXT CHECK(recurring IN ('daily','weekly','monthly', NULL)),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
  }

  create(input: CreateTaskInput): Task {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: input.title,
      description: input.description ?? "",
      dueDate: input.dueDate,
      priority: input.priority ?? "medium",
      status: "pending",
      delayCount: 0,
      recurring: input.recurring ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.run(
      `INSERT INTO tasks (id, title, description, dueDate, priority, status, delayCount, recurring, createdAt, updatedAt)
       VALUES ($id, $title, $description, $dueDate, $priority, $status, $delayCount, $recurring, $createdAt, $updatedAt)`,
      task
    );
    return task;
  }

  list(filters?: { status?: string; priority?: string }): Task[] {
    let sql = "SELECT * FROM tasks";
    const conditions: string[] = [];
    const params: Record<string, string> = {};
    if (filters?.status) { conditions.push("status = $status"); params.$status = filters.status; }
    if (filters?.priority) { conditions.push("priority = $priority"); params.$priority = filters.priority; }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY createdAt DESC";
    return this.db.query(sql).all(params) as Task[];
  }

  getById(id: string): Task | null {
    return this.db.query("SELECT * FROM tasks WHERE id = $id").get({ $id: id }) as Task | null;
  }

  update(id: string, input: UpdateTaskInput): Task | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const merged = { ...existing, ...input, updatedAt: now };
    this.db.run(
      `UPDATE tasks SET title=$title, description=$description, dueDate=$dueDate, priority=$priority,
       status=$status, delayCount=$delayCount, recurring=$recurring, updatedAt=$updatedAt
       WHERE id=$id`,
      { $id: id, $title: merged.title, $description: merged.description, $dueDate: merged.dueDate,
        $priority: merged.priority, $status: merged.status, $delayCount: merged.delayCount,
        $recurring: merged.recurring, $updatedAt: now }
    );
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.run("DELETE FROM tasks WHERE id = $id", { $id: id });
    return result.changes > 0;
  }

  delay(id: string, days: number): { task: Task; message: string } | { error: string } {
    const task = this.getById(id);
    if (!task) return { error: "Task not found" };
    if (task.status === "done") return { error: "Cannot delay a completed task" };
    if (days < 1 || days > 7) return { error: "Days must be between 1 and 7" };

    const current = new Date(task.dueDate);
    current.setDate(current.getDate() + days);
    const newDueDate = current.toISOString().split("T")[0];
    const newDelayCount = task.delayCount + 1;
    const now = new Date().toISOString();

    this.db.run(
      `UPDATE tasks SET dueDate=$due, status='delayed', delayCount=$count, updatedAt=$now WHERE id=$id`,
      { $id: id, $due: newDueDate, $count: newDelayCount, $now: now }
    );

    const updated = this.getById(id)!;
    const message = `Delayed to ${newDueDate}. You've delayed this task ${newDelayCount} time${newDelayCount > 1 ? "s" : ""}.`;
    return { task: updated, message };
  }

  markDone(id: string): MarkDoneResult {
    const task = this.getById(id);
    if (!task) return { ok: false, error: "Task not found" };

    const now = new Date().toISOString();
    this.db.run("UPDATE tasks SET status='done', updatedAt=$now WHERE id=$id",
      { $id: id, $now: now });

    const updated = this.getById(id)!;

    if (task.recurring) {
      const nextDate = this.advanceDate(task.dueDate, task.recurring);
      const next = this.create({
        title: task.title,
        description: task.description,
        dueDate: nextDate,
        priority: task.priority,
        recurring: task.recurring,
      });
      return { ok: true, task: updated, next };
    }

    return { ok: true, task: updated };
  }

  private advanceDate(from: string, period: string): string {
    const d = new Date(from);
    switch (period) {
      case "daily": d.setDate(d.getDate() + 1); break;
      case "weekly": d.setDate(d.getDate() + 7); break;
      case "monthly": d.setMonth(d.getMonth() + 1); break;
    }
    return d.toISOString().split("T")[0];
  }

  close() {
    this.db.close();
  }
}

function getDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const home = process.env.HOME;
  if (xdg) return `${xdg}/anti-deplay`;
  if (home) return `${home}/.local/share/anti-deplay`;
  return "/tmp/anti-deplay";
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun build src/task-store.ts --outdir /dev/null
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/task-store.ts && git commit -m "feat: add TaskStore with SQLite CRUD"
```

---

### Task 3: CLI layer

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Implement CLI module**

```typescript
import { TaskStore, Task, CreateTaskInput } from "./task-store";

export class CLI {
  constructor(private store: TaskStore) {}

  run(args: string[]) {
    if (args.length === 0) {
      this.help();
      return;
    }

    const sub = args[0];
    switch (sub) {
      case "add":    return this.add(args.slice(1));
      case "list":   return this.list(args.slice(1));
      case "update": return this.update(args.slice(1));
      case "delete": return this.deleteTask(args.slice(1));
      case "delay":  return this.delay(args.slice(1));
      case "done":   return this.done(args.slice(1));
      default:
        console.error(`Unknown command: ${sub}`);
        this.help();
        process.exit(1);
    }
  }

  private help() {
    console.log(`
anti-deplay — anti-procrastination task manager

Usage:
  anti-deplay task add <title> [--due <date>] [--priority <low|medium|high>] [--recurring <daily|weekly|monthly>]
  anti-deplay task list [--status <pending|done|delayed>] [--priority <...>]
  anti-deplay task update <id> [--title <...>] [--due <...>] [--priority <...>]
  anti-deplay task delete <id>
  anti-deplay task delay <id> --days <1-7>
  anti-deplay task done <id>
  anti-deplay serve
    `.trim());
  }

  private add(args: string[]) {
    if (args.length === 0) {
      console.error("Usage: anti-deplay task add <title> [--due <date>] [--priority <...>] [--recurring <...>]");
      process.exit(1);
    }
    const title = args[0];
    const due = this.getFlag(args, "--due") ?? new Date().toISOString().split("T")[0];
    const priority = this.getFlag(args, "--priority") as "low" | "medium" | "high" | undefined;
    const recurring = this.getFlag(args, "--recurring") as "daily" | "weekly" | "monthly" | undefined;

    const task = this.store.create({ title, dueDate: due, priority, recurring });
    console.log(`Created task: ${task.id}`);
    this.printTask(task);
  }

  private list(args: string[]) {
    const status = this.getFlag(args, "--status");
    const priority = this.getFlag(args, "--priority");
    const tasks = this.store.list({ status, priority });
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    for (const t of tasks) this.printTask(t);
  }

  private update(args: string[]) {
    if (args.length === 0) {
      console.error("Usage: anti-deplay task update <id> [--title <...>] [--due <...>] [--priority <...>]");
      process.exit(1);
    }
    const id = args[0];
    const input: any = {};
    const title = this.getFlag(args, "--title");
    if (title) input.title = title;
    const due = this.getFlag(args, "--due");
    if (due) input.dueDate = due;
    const priority = this.getFlag(args, "--priority");
    if (priority) input.priority = priority;

    const result = this.store.update(id, input);
    if (!result) { console.error("Task not found"); process.exit(1); }
    console.log("Updated task:");
    this.printTask(result);
  }

  private deleteTask(args: string[]) {
    if (args.length === 0) {
      console.error("Usage: anti-deplay task delete <id>");
      process.exit(1);
    }
    const ok = this.store.delete(args[0]);
    console.log(ok ? "Deleted." : "Task not found.");
  }

  private delay(args: string[]) {
    if (args.length === 0) {
      console.error("Usage: anti-deplay task delay <id> --days <1-7>");
      process.exit(1);
    }
    const id = args[0];
    const days = parseInt(this.getFlag(args, "--days") ?? "0", 10);
    const result = this.store.delay(id, days);
    if ("error" in result) { console.error(result.error); process.exit(1); }
    console.log(result.message);
    this.printTask(result.task);
  }

  private done(args: string[]) {
    if (args.length === 0) {
      console.error("Usage: anti-deplay task done <id>");
      process.exit(1);
    }
    const result = this.store.markDone(args[0]);
    if (!result.ok) { console.error(result.error); process.exit(1); }
    console.log("Task marked done.");
  }

  private getFlag(args: string[], name: string): string | undefined {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return undefined;
  }

  private printTask(t: Task) {
    console.log(`  [${t.status}] ${t.id.slice(0, 8)}: ${t.title}`);
    console.log(`    Due: ${t.dueDate} | Priority: ${t.priority}${t.recurring ? ` | Recurring: ${t.recurring}` : ""}`);
    if (t.delayCount > 0) console.log(`    Delayed ${t.delayCount} time${t.delayCount > 1 ? "s" : ""}`);
    console.log();
  }
}
```

- [ ] **Step 2: Verify compiles**

```bash
bun build src/cli.ts --outdir /dev/null
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts && git commit -m "feat: add CLI layer"
```

---

### Task 4: MCP Server

**Files:**
- Create: `src/mcp-server.ts`

- [ ] **Step 1: Implement MCP server module**

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TaskStore } from "./task-store";

export class MCPServer {
  private server: Server;

  constructor(private store: TaskStore) {
    this.server = new Server(
      { name: "anti-deplay", version: "0.1.0" },
      { capabilities: { tools: {}, resources: {} } }
    );
    this.registerHandlers();
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "tasks_create",
          description: "Create a new task",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              dueDate: { type: "string", description: "ISO 8601 date (e.g., 2026-07-12)" },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              recurring: { type: "string", enum: ["daily", "weekly", "monthly"] },
            },
            required: ["title", "dueDate"],
          },
        },
        {
          name: "tasks_list",
          description: "List tasks, optionally filtered",
          inputSchema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["pending", "done", "delayed"] },
              priority: { type: "string", enum: ["low", "medium", "high"] },
            },
          },
        },
        {
          name: "tasks_update",
          description: "Update a task's fields",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              dueDate: { type: "string" },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              recurring: { type: "string", enum: ["daily", "weekly", "monthly", null] },
            },
            required: ["id"],
          },
        },
        {
          name: "tasks_delete",
          description: "Delete a task",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
        {
          name: "delay_task",
          description: "Delay a task by 1-7 days. Shows delay count as pressure.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              days: { type: "number", minimum: 1, maximum: 7 },
            },
            required: ["id", "days"],
          },
        },
        {
          name: "tasks_mark_done",
          description: "Mark a task as done. If recurring, auto-creates the next instance.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      switch (name) {
        case "tasks_create": {
          const t = this.store.create(args as any);
          return { content: [{ type: "text", text: JSON.stringify(t, null, 2) }] };
        }
        case "tasks_list": {
          const tasks = this.store.list(args as any);
          return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
        }
        case "tasks_update": {
          const { id, ...fields } = args as any;
          const result = this.store.update(id, fields);
          if (!result) return { content: [{ type: "text", text: "Task not found" }], isError: true };
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "tasks_delete": {
          const ok = this.store.delete((args as any).id);
          return { content: [{ type: "text", text: ok ? "Deleted" : "Not found" }] };
        }
        case "delay_task": {
          const { id, days } = args as any;
          const result = this.store.delay(id, days);
          if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
          return { content: [{ type: "text", text: `${result.message}\n${JSON.stringify(result.task, null, 2)}` }] };
        }
        case "tasks_mark_done": {
          const result = this.store.markDone((args as any).id);
          if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        default:
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "tasks://list",
          name: "All tasks",
          description: "List of all tasks in the store",
          mimeType: "application/json",
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (uri === "tasks://list") {
        const tasks = this.store.list();
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(tasks, null, 2) }] };
      }
      const match = uri.match(/^tasks:\/\/(.+)$/);
      if (match) {
        const task = this.store.getById(match[1]);
        if (!task) return { contents: [{ uri, mimeType: "application/json", text: "Not found" }] };
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(task, null, 2) }] };
      }
      return { contents: [{ uri, mimeType: "application/json", text: "Unknown resource" }] };
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
```

- [ ] **Step 2: Verify compiles**

```bash
bun build src/mcp-server.ts --outdir /dev/null
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/mcp-server.ts && git commit -m "feat: add MCP server with tools and resources"
```

---

### Task 5: Wire up entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite src/index.ts to dispatch commands**

```typescript
#!/usr/bin/env bun
import { argv, exit } from "bun";
import { TaskStore } from "./task-store";
import { CLI } from "./cli";
import { MCPServer } from "./mcp-server";

function main() {
  const args = argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: anti-deplay <command> [options]");
    console.log("  anti-deplay task <action> ...   Manage tasks");
    console.log("  anti-deplay serve               Start MCP server");
    exit(1);
  }

  const store = new TaskStore();

  if (args[0] === "serve") {
    const server = new MCPServer(store);
    server.start().catch((err) => {
      console.error("MCP server error:", err);
      exit(1);
    });
  } else if (args[0] === "task") {
    const cli = new CLI(store);
    cli.run(args.slice(1));
  } else {
    console.error(`Unknown command: ${args[0]}`);
    exit(1);
  }
}

main();
```

- [ ] **Step 2: Make executable and verify**

```bash
chmod +x src/index.ts
bun run src/index.ts
```
Expected: prints usage message

```bash
bun run src/index.ts serve
```
Expected: hangs (MCP server waiting on stdin) — kill with Ctrl+C

- [ ] **Step 3: Commit**

```bash
git add src/index.ts && git commit -m "feat: wire up entry point with CLI and MCP dispatch"
```

---

### Task 6: Verify full flow

- [ ] **Step 1: Test CLI create + list + delay + done**

```bash
# Create a task
bun run src/index.ts task add "Write report" --due 2026-07-15 --priority high

# List tasks
bun run src/index.ts task list

# Delay it
bun run src/index.ts task delay <id-from-above> --days 3

# Mark done
bun run src/index.ts task done <id-from-above>

# List filtered
bun run src/index.ts task list --status done
```

Expected: each command works, delay shows count

- [ ] **Step 2: Final commit**

```bash
git add -A && git commit -m "feat: complete anti-deplay MVP"
```
