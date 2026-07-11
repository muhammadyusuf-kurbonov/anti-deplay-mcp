import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

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

export type UpdateTaskInput = Partial<
  Omit<Task, "id" | "createdAt" | "updatedAt">
>;

export type MarkDoneResult =
  | { ok: true; task: Task; next?: Task }
  | { ok: false; error: string };

export class TaskStore {
  private db: Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    if (dbPath) {
      this.dbPath = dbPath;
    } else {
      const dataHome =
        process.env.XDG_DATA_HOME ??
        join(process.env.HOME || "/tmp", ".local", "share");
      this.dbPath = join(dataHome, "anti-deplay", "tasks.db");
    }

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        dueDate TEXT NOT NULL,
        priority TEXT CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
        status TEXT CHECK(status IN ('pending', 'done', 'delayed')) DEFAULT 'pending',
        delayCount INTEGER DEFAULT 0,
        recurring TEXT CHECK(recurring IN ('daily', 'weekly', 'monthly')),
        createdAt TEXT,
        updatedAt TEXT
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
      {
        $id: task.id,
        $title: task.title,
        $description: task.description,
        $dueDate: task.dueDate,
        $priority: task.priority,
        $status: task.status,
        $delayCount: task.delayCount,
        $recurring: task.recurring,
        $createdAt: task.createdAt,
        $updatedAt: task.updatedAt,
      },
    );

    return task;
  }

  list(
    filters?: { status?: string; priority?: string },
  ): Task[] {
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    if (filters?.status) {
      conditions.push("status = $status");
      params.$status = filters.status;
    }

    if (filters?.priority) {
      conditions.push("priority = $priority");
      params.$priority = filters.priority;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM tasks ${where} ORDER BY createdAt DESC`;

    return this.db.query(sql).all(params) as Task[];
  }

  getById(id: string): Task | null {
    const row = this.db
      .query("SELECT * FROM tasks WHERE id = $id")
      .get({ $id: id }) as Task | undefined;
    return row ?? null;
  }

  update(id: string, input: UpdateTaskInput): Task | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: Record<string, unknown> = { $id: id };

    if (input.title !== undefined) {
      sets.push("title = $title");
      params.$title = input.title;
    }
    if (input.description !== undefined) {
      sets.push("description = $description");
      params.$description = input.description;
    }
    if (input.dueDate !== undefined) {
      sets.push("dueDate = $dueDate");
      params.$dueDate = input.dueDate;
    }
    if (input.priority !== undefined) {
      sets.push("priority = $priority");
      params.$priority = input.priority;
    }
    if (input.status !== undefined) {
      sets.push("status = $status");
      params.$status = input.status;
    }
    if (input.delayCount !== undefined) {
      sets.push("delayCount = $delayCount");
      params.$delayCount = input.delayCount;
    }
    if (input.recurring !== undefined) {
      sets.push("recurring = $recurring");
      params.$recurring = input.recurring;
    }

    const now = new Date().toISOString();
    sets.push("updatedAt = $updatedAt");
    params.$updatedAt = now;

    this.db.run(
      `UPDATE tasks SET ${sets.join(", ")} WHERE id = $id`,
      params,
    );

    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.run("DELETE FROM tasks WHERE id = $id", {
      $id: id,
    });
    return result.changes > 0;
  }

  delay(
    id: string,
    hours: number,
  ): { task: Task; message: string } | { error: string } {
    if (hours < 1 || hours > 168) {
      return { error: "Hours must be between 1 and 168 (7 days)" };
    }

    const task = this.getById(id);
    if (!task) {
      return { error: "Task not found" };
    }
    if (task.status === "done") {
      return { error: "Cannot delay a completed task" };
    }

    const days = Math.ceil(hours / 24);
    const currentDue = new Date(task.dueDate + "T00:00:00");
    currentDue.setDate(currentDue.getDate() + days);
    const newDueDate = currentDue.toISOString().split("T")[0];
    const newDelayCount = task.delayCount + 1;
    const now = new Date().toISOString();

    this.db.run(
      `UPDATE tasks SET dueDate = $dueDate, status = $status, delayCount = $delayCount, updatedAt = $updatedAt WHERE id = $id`,
      {
        $id: id,
        $dueDate: newDueDate,
        $status: "delayed",
        $delayCount: newDelayCount,
        $updatedAt: now,
      },
    );

    const updated = this.getById(id)!;
    return {
      task: updated,
      message: `Delayed to ${newDueDate} (${hours}h → ${days}d). You've delayed this task ${newDelayCount} times.`,
    };
  }

  markDone(id: string): MarkDoneResult {
    const task = this.getById(id);
    if (!task) {
      return { ok: false, error: "Task not found" };
    }

    const now = new Date().toISOString();
    this.db.run(
      "UPDATE tasks SET status = $status, updatedAt = $updatedAt WHERE id = $id",
      { $id: id, $status: "done", $updatedAt: now },
    );

    const updated = this.getById(id)!;

    if (task.recurring) {
      const nextDueDate = this.advanceDate(task.dueDate, task.recurring);
      const next = this.create({
        title: task.title,
        description: task.description,
        dueDate: nextDueDate,
        priority: task.priority as "low" | "medium" | "high",
        recurring: task.recurring as "daily" | "weekly" | "monthly",
      });
      return { ok: true, task: updated, next };
    }

    return { ok: true, task: updated };
  }

  private advanceDate(from: string, period: string): string {
    const date = new Date(from + "T00:00:00");

    switch (period) {
      case "daily":
        date.setDate(date.getDate() + 1);
        break;
      case "weekly":
        date.setDate(date.getDate() + 7);
        break;
      case "monthly":
        date.setMonth(date.getMonth() + 1);
        break;
    }

    return date.toISOString().split("T")[0];
  }

  report(): { pending: Task[]; total: number } {
    const pending = this.db
      .query("SELECT * FROM tasks WHERE status = 'pending' ORDER BY dueDate ASC")
      .all() as Task[];

    return { pending, total: pending.length };
  }

  close(): void {
    this.db.close();
  }
}
