import { TaskStore, Task } from "./task-store";

export class CLI {
  constructor(private store: TaskStore) {}

  run(args: string[]) {
    if (args.length === 0) {
      this.help();
      return;
    }
    switch (args[0]) {
      case "add":
        return this.add(args.slice(1));
      case "list":
        return this.list(args.slice(1));
      case "update":
        return this.update(args.slice(1));
      case "delete":
        return this.deleteTask(args.slice(1));
      case "delay":
        return this.delay(args.slice(1));
      case "done":
        return this.done(args.slice(1));
      case "report":
        return this.report();
      default:
        console.error(`Unknown command: ${args[0]}`);
        this.help();
        process.exit(1);
    }
  }

  private help() {
    console.log(
      [
        "anti-deplay — anti-procrastination task manager",
        "",
        "Usage:",
        "  anti-deplay task add <title> [--due <date>] [--priority <low|medium|high>] [--recurring <daily|weekly|monthly>]",
        "  anti-deplay task list [--status <pending|done|delayed>] [--priority <...>]",
        "  anti-deplay task update <id> [--title <...>] [--due <...>] [--priority <...>]",
        "  anti-deplay task delete <id>",
        "  anti-deplay task delay <id> --days <1-7>",
        "  anti-deplay task done <id>",
        "  anti-deplay report",
        "  anti-deplay serve",
      ].join("\n"),
    );
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
    console.log(`Created task: ${task.id.slice(0, 8)}`);
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
    const input: Record<string, unknown> = {};
    const title = this.getFlag(args, "--title");
    if (title) input.title = title;
    const due = this.getFlag(args, "--due");
    if (due) input.dueDate = due;
    const priority = this.getFlag(args, "--priority");
    if (priority) input.priority = priority;

    const result = this.store.update(id, input);
    if (!result) {
      console.error("Task not found");
      process.exit(1);
    }
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
    if ("error" in result) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(result.message);
    this.printTask(result.task);
  }

  private done(args: string[]) {
    if (args.length === 0) {
      console.error("Usage: anti-deplay task done <id>");
      process.exit(1);
    }
    const result = this.store.markDone(args[0]);
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
    console.log("Task marked done.");
  }

  private report() {
    const { pending, total } = this.store.report();
    console.log(`[ANTI-DEPLAY REPORT] ${new Date().toISOString().split("T")[0]}`);
    console.log(`Pending tasks: ${total}`);
    console.log();

    for (const t of pending) {
      const flagged = t.delayCount >= 3 ? " ⚠️" : "";
      console.log(`  [${t.status}] ${t.id.slice(0, 8)}: ${t.title}${flagged}`);
      console.log(`    Due: ${t.dueDate} | Priority: ${t.priority}`);
      if (t.delayCount > 0) {
        console.log(`    Delayed ${t.delayCount}x`);
      }
      console.log();
    }

    if (total === 0) {
      console.log("  No active tasks. Good work!");
    }
  }

  private getFlag(args: string[], name: string): string | undefined {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return undefined;
  }

  private printTask(t: Task) {
    console.log(`  [${t.status}] ${t.id.slice(0, 8)}: ${t.title}`);
    console.log(`    Due: ${t.dueDate} | Priority: ${t.priority}${t.recurring ? ` | Recurring: ${t.recurring}` : ""}`);
    if (t.delayCount > 0) {
      const times = t.delayCount === 1 ? "time" : "times";
      console.log(`    Delayed ${t.delayCount} ${times}`);
    }
    console.log();
  }
}
