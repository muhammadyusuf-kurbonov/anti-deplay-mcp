import { Bot } from "grammy";
import { schedule } from "node-cron";
import { TaskStore } from "./task-store";

export class TelegramBot {
  private bot: Bot;
  private store: TaskStore;
  private cronExpr: string;
  private cronJob: ReturnType<typeof schedule> | null = null;

  constructor(store: TaskStore, token: string, cronExpr: string) {
    this.store = store;
    this.cronExpr = cronExpr;
    this.bot = new Bot(token);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command("start", async (ctx) => {
      const report = this.store.report();
      if (report.total === 0) {
        await ctx.reply("No pending tasks. Good work! 🎉");
        return;
      }
      const lines = [`📋 Pending tasks: ${report.total}`];
      for (const t of report.pending) {
        const overdue = t.dueDate < new Date().toISOString().split("T")[0] ? " ⛔ OVERDUE" : "";
        let line = `${t.title}${overdue}`;
        line += ` | Due: ${t.dueDate} | ${t.priority}`;
        if (t.delayCount > 0) line += ` | Delayed ${t.delayCount}x`;
        lines.push(line);
      }
      await ctx.reply(lines.join("\n"));
    });
  }

  private startCron(): void {
    const chatIdStr = process.env.TELEGRAM_CHAT_ID;
    if (!chatIdStr) {
      console.log("TELEGRAM_CHAT_ID not set — cron disabled.");
      return;
    }
    const chatId = parseInt(chatIdStr, 10);
    if (isNaN(chatId)) {
      console.log("Invalid TELEGRAM_CHAT_ID — cron disabled.");
      return;
    }

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

        await this.bot.api.sendMessage(chatId, lines.join("\n"));
      } catch (e) {
        console.error("Cron error:", e);
      }
    });
  }

  async start(): Promise<void> {
    this.startCron();
    this.bot.start();
  }

  stop(): void {
    if (this.cronJob) this.cronJob.stop();
    this.bot.stop();
  }
}
