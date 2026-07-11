import { Bot, InlineKeyboard } from "grammy";
import { schedule } from "node-cron";
import { TaskStore, Task } from "./task-store";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = (() => {
  const xdg = process.env.XDG_DATA_HOME;
  const home = process.env.HOME;
  if (xdg) return join(xdg, "anti-deplay");
  if (home) return join(home, ".local", "share", "anti-deplay");
  return "/tmp/anti-deplay";
})();

const CHAT_IDS_PATH = join(DATA_DIR, "chat-ids.json");

function loadChatIds(): number[] {
  try {
    if (existsSync(CHAT_IDS_PATH)) {
      return JSON.parse(readFileSync(CHAT_IDS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}

function saveChatIds(ids: number[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CHAT_IDS_PATH, JSON.stringify(ids, null, 2));
}

function formatTask(t: Task): string {
  let line = `[${t.status}] ${t.title}`;
  line += `\n  Due: ${t.dueDate} | Priority: ${t.priority}`;
  if (t.recurring) line += ` | Recurring: ${t.recurring}`;
  if (t.delayCount > 0) {
    line += `\n  Delayed ${t.delayCount} ${t.delayCount === 1 ? "time" : "times"}`;
    if (t.delayCount >= 3) line += " ⚠️";
  }
  return line;
}

function truncateId(id: string): string {
  return id.slice(0, 8);
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      const name = args[i].slice(1);
      const values: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        i++;
        values.push(args[i]);
      }
      flags.set(name, values.join(" "));
    }
  }
  return flags;
}

export class TelegramBot {
  private bot: Bot;
  private store: TaskStore;
  private cronExpr: string;
  private cronJob: ReturnType<typeof schedule> | null = null;
  private chatIds: number[];

  constructor(store: TaskStore, token: string, cronExpr: string) {
    this.store = store;
    this.cronExpr = cronExpr;
    this.chatIds = loadChatIds();
    this.bot = new Bot(token);
    this.setupHandlers();
  }

  private registerChat(chatId: number): void {
    if (!this.chatIds.includes(chatId)) {
      this.chatIds.push(chatId);
      saveChatIds(this.chatIds);
    }
  }

  private setupHandlers(): void {
    this.bot.command("start", async (ctx) => {
      this.registerChat(ctx.chat.id);
      await ctx.reply(
        `Welcome to anti-deplay! 🎯\n\n` +
        `Commands:\n` +
        `/add_task -title <title> -due <YYYY-MM-DD> [-priority low|medium|high] [-recurring daily|weekly|monthly]\n` +
        `/list [pending|done|delayed]\n` +
        `/get_task <id>\n` +
        `/update_task <id> [-title <...>] [-due <...>] [-priority <...>]\n` +
        `/delete <id>\n` +
        `/delay <id> <hours>\n` +
        `/done <id>\n` +
        `/report\n\n` +
        `You'll also receive periodic reports on pending tasks.`
      );
    });

    this.bot.command("add_task", async (ctx) => {
      this.registerChat(ctx.chat.id);
      const text = ctx.match?.trim();
      if (!text) {
        await ctx.reply("Usage: /add_task -title <title> -due <YYYY-MM-DD> [-priority low|medium|high] [-recurring daily|weekly|monthly]");
        return;
      }
      const args = text.split(/\s+/);
      const flags = parseFlags(args);
      const title = flags.get("title");
      const dueDate = flags.get("due");
      if (!title || !dueDate) {
        await ctx.reply("Error: -title and -due are required.");
        return;
      }
      const priority = flags.get("priority") as "low" | "medium" | "high" | undefined;
      const recurring = flags.get("recurring") as "daily" | "weekly" | "monthly" | undefined;
      try {
        const task = this.store.create({
          title: title.replace(/^"(.*)"$/, "$1"),
          dueDate,
          priority: priority && ["low", "medium", "high"].includes(priority) ? priority : undefined,
          recurring: recurring && ["daily", "weekly", "monthly"].includes(recurring) ? recurring : undefined,
        });
        await ctx.reply(`✅ Task created:\n${formatTask(task)}`);
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.command("list", async (ctx) => {
      const text = ctx.match?.trim();
      const parts = text ? text.split(/\s+/) : [];
      const statusArg = parts.find(p => ["pending", "done", "delayed"].includes(p));
      const priorityArg = parts.find(p => ["low", "medium", "high"].includes(p));
      try {
        const tasks = this.store.list({ status: statusArg, priority: priorityArg });
        if (tasks.length === 0) {
          await ctx.reply("No tasks found.");
          return;
        }
        const lines = tasks.map(t => `\`${truncateId(t.id)}\` ${formatTask(t)}`);
        const chunks = chunkArray(lines, 10);
        for (const chunk of chunks) {
          await ctx.reply(chunk.join("\n\n"), { parse_mode: "Markdown" });
        }
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.command("get_task", async (ctx) => {
      const id = ctx.match?.trim();
      if (!id) {
        await ctx.reply("Usage: /get_task <task_id>");
        return;
      }
      try {
        const task = this.store.getById(id);
        if (!task) {
          await ctx.reply(`Task not found: ${id}`);
          return;
        }
        await ctx.reply(formatTask(task));
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.command("update_task", async (ctx) => {
      const text = ctx.match?.trim();
      if (!text) {
        await ctx.reply("Usage: /update_task <id> [-title <...>] [-due <...>] [-priority <...>]");
        return;
      }
      const args = text.split(/\s+/);
      const id = args[0];
      const flags = parseFlags(args.slice(1));
      const updates: Record<string, unknown> = {};
      const title = flags.get("title");
      if (title) updates.title = title.replace(/^"(.*)"$/, "$1");
      const dueDate = flags.get("due");
      if (dueDate) updates.dueDate = dueDate;
      const priority = flags.get("priority");
      if (priority && ["low", "medium", "high"].includes(priority)) updates.priority = priority;
      if (Object.keys(updates).length === 0) {
        await ctx.reply("No fields to update. Provide at least one flag.");
        return;
      }
      try {
        const updated = this.store.update(id, updates);
        if (!updated) {
          await ctx.reply(`Task not found: ${id}`);
          return;
        }
        await ctx.reply(`✅ Updated:\n${formatTask(updated)}`);
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.command("delete", async (ctx) => {
      const id = ctx.match?.trim();
      if (!id) {
        await ctx.reply("Usage: /delete <task_id>");
        return;
      }
      const kb = new InlineKeyboard()
        .text("Yes, delete", `delete_confirm:${id}`)
        .text("Cancel", "delete_cancel");
      await ctx.reply(`Delete task ${truncateId(id)}?`, { reply_markup: kb });
    });

    this.bot.callbackQuery(/^delete_confirm:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      try {
        const ok = this.store.delete(id);
        await ctx.editMessageText(ok ? `✅ Task ${truncateId(id)} deleted.` : "Task not found.");
      } catch (e) {
        await ctx.editMessageText(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.callbackQuery("delete_cancel", async (ctx) => {
      await ctx.editMessageText("Cancelled.");
    });

    this.bot.command("delay", async (ctx) => {
      const parts = ctx.match?.trim().split(/\s+/);
      if (!parts || parts.length < 2) {
        await ctx.reply("Usage: /delay <task_id> <hours (1-168)>");
        return;
      }
      const [id, hoursStr] = parts;
      const hours = parseInt(hoursStr, 10);
      if (isNaN(hours) || hours < 1 || hours > 168) {
        await ctx.reply("Hours must be between 1 and 168.");
        return;
      }
      try {
        const result = this.store.delay(id, hours);
        if ("error" in result) {
          await ctx.reply(`Error: ${result.error}`);
        } else {
          await ctx.reply(result.message);
        }
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.command("done", async (ctx) => {
      const id = ctx.match?.trim();
      if (!id) {
        await ctx.reply("Usage: /done <task_id>");
        return;
      }
      try {
        const result = this.store.markDone(id);
        if (!result.ok) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        let msg = `✅ Task marked done!`;
        if (result.next) {
          msg += `\n\nNext recurring instance created:\n${formatTask(result.next)}`;
        }
        await ctx.reply(msg);
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.command("report", async (ctx) => {
      try {
        const report = this.store.report();
        if (report.total === 0) {
          await ctx.reply("No pending tasks. Good work! 🎉");
          return;
        }
        const lines = [`📋 Pending tasks: ${report.total}`];
        for (const t of report.pending) {
          const overdue = t.dueDate < new Date().toISOString().split("T")[0] ? " ⛔ OVERDUE" : "";
          let line = `\`${truncateId(t.id)}\` ${t.title}${overdue}`;
          line += `\n  Due: ${t.dueDate} | Priority: ${t.priority}`;
          if (t.delayCount > 0) {
            const warn = t.delayCount >= 3 ? " ⚠️" : "";
            line += `\n  Delayed ${t.delayCount}x${warn}`;
          }
          lines.push(line);
        }
        const chunks = chunkArray(lines, 10);
        for (const chunk of chunks) {
          await ctx.reply(chunk.join("\n\n"), { parse_mode: "Markdown" });
        }
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  private startCron(): void {
    this.cronJob = schedule(this.cronExpr, async () => {
      try {
        const report = this.store.report();
        if (report.total === 0) return;

        const lines = [`📋 Cron Report: ${report.total} pending tasks`];
        for (const t of report.pending) {
          const overdue = t.dueDate < new Date().toISOString().split("T")[0] ? " ⛔" : "";
          let line = `${t.title}${overdue}`;
          line += ` | Due: ${t.dueDate} | ${t.priority}`;
          if (t.delayCount > 0) line += ` | Delayed ${t.delayCount}x`;
          lines.push(line);
        }

        const text = lines.join("\n");
        const failedChats: number[] = [];
        for (const chatId of this.chatIds) {
          try {
            await this.bot.api.sendMessage(chatId, text);
          } catch {
            failedChats.push(chatId);
          }
        }
        if (failedChats.length > 0) {
          this.chatIds = this.chatIds.filter(id => !failedChats.includes(id));
          saveChatIds(this.chatIds);
        }
      } catch (e) {
        console.error("Cron error:", e);
      }
    });
  }

  async start(): Promise<void> {
    this.startCron();
    console.log("Telegram bot started. Polling...");
    this.bot.start({
      onStart: () => {
        console.log("Bot is running. Registered chats:", this.chatIds.length);
      },
    });
  }

  stop(): void {
    if (this.cronJob) this.cronJob.stop();
    this.bot.stop();
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
