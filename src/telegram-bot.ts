import { Bot } from "grammy";
import { schedule } from "node-cron";
import { TaskStore } from "./task-store";
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
        `You'll receive periodic reports on pending tasks here.`
      );
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
    this.bot.start({
      onStart: () => {
        console.log("Telegram bot running. Registered chats:", this.chatIds.length);
      },
    });
  }

  stop(): void {
    if (this.cronJob) this.cronJob.stop();
    this.bot.stop();
  }
}
