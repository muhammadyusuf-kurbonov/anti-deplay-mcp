import { TaskStore, Task } from "./task-store";
import * as blessed from "blessed";

export class TUI {
  private store: TaskStore;
  private screen: blessed.Widgets.Screen;
  private list: blessed.Widgets.BoxElement;
  private header: blessed.Widgets.BoxElement;
  private footer: blessed.Widgets.BoxElement;
  private debugPanel?: blessed.Widgets.BoxElement;
  private tasks: Task[] = [];
  private modalActive = false;
  private closeModal: (() => void) | null = null;
  private logs: string[] = [];
  private readonly MAX_LOGS = 50;
  private selectedIdx = 0;
  private showAll = false;
  private readonly debug: boolean;

  constructor(store: TaskStore) {
    this.store = store;
    this.debug = !!process.env.ANTI_DELAY_DEBUG;

    this.screen = blessed.screen({
      smartCSR: true,
      title: "anti-delay",
    });

    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { bold: true, fg: "cyan" },
    });

    this.list = blessed.box({
      parent: this.screen,
      top: 1,
      left: 0,
      width: this.debug ? "100%-30" : "100%",
      height: "100%-2",
    });

    if (this.debug) {
      this.debugPanel = blessed.box({
        parent: this.screen,
        top: 1,
        right: 0,
        width: 30,
        height: "100%-2",
        border: { type: "line" },
        label: " Debug ",
        style: { border: { fg: "yellow" }, fg: "green" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "yellow" } },
      });
    }

    this.footer = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { fg: "white", dim: true },
    });

    this.screen.key(["q", "C-c"], () => {
      this.log("q: quit");
      if (!this.modalActive) this.quit();
    });
    this.screen.key("d", () => {
      this.log("d: delay");
      if (!this.modalActive) this.delayModal();
    });
    this.screen.key("a", () => {
      this.log("a: add");
      if (!this.modalActive) this.addTaskModal();
    });
    this.screen.key("s", () => {
      this.showAll = !this.showAll;
      this.log(`s: showAll=${this.showAll}`);
      if (!this.modalActive) {
        this.loadTasks();
        this.render();
      }
    });
    this.screen.key("r", () => {
      this.log("r: refresh");
      if (!this.modalActive) {
        this.loadTasks();
        this.render();
      }
    });
    this.screen.key("escape", () => {
      this.log("esc");
      if (this.closeModal) {
        this.closeModal();
      }
    });

    if (this.debug) {
      this.screen.on("keypress", (_ch, key) => {
        if (key) this.log(`key:${key.name}`);
      });
    }

    this.screen.on("keypress", (_ch, key) => {
      if (!key || this.modalActive) return;
      if (key.name === "space") {
        this.markDone();
      } else if ((key.name === "up" || key.name === "k") && this.selectedIdx > 0) {
        this.selectedIdx--;
        this.render();
      } else if ((key.name === "down" || key.name === "j") && this.selectedIdx < this.tasks.length - 1) {
        this.selectedIdx++;
        this.render();
      }
    });

    this.screen.on("resize", () => this.render());
  }

  async run(): Promise<void> {
    if (!process.stdin.isTTY) {
      console.error("TUI requires a TTY");
      process.exit(1);
    }
    this.loadTasks();
    this.render();
  }

  private log(msg: string): void {
    if (!this.debug) return;
    this.logs.push(msg);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs = this.logs.slice(-this.MAX_LOGS);
    }
    this.debugPanel!.setContent(this.logs.join("\n"));
    this.debugPanel!.setScrollPerc(100);
    this.screen.render();
  }

  private selectedIndex(): number {
    return this.selectedIdx;
  }

  private loadTasks(): void {
    this.tasks = this.showAll
      ? this.store.list()
      : this.store.report().pending;
    if (this.selectedIdx >= this.tasks.length) {
      this.selectedIdx = Math.max(0, this.tasks.length - 1);
    }
  }

  private render(): void {
    const mode = this.showAll ? "all" : "pending";
    const count = this.tasks.length;
    const titleText = " anti-delay ";
    this.header.setContent(
      `${titleText}${" ".repeat(Math.max(0, this.screen.cols - titleText.length - 20))}${mode}: ${count}`,
    );

    const STRIKE = "\x1b[9m";
    const RESET = "\x1b[0m";
    const lines = this.tasks.map((t, i) => {
      let flag = "";
      if (t.delayCount >= 3) flag = "⚠";
      else if (t.delayCount > 0) flag = `~${t.delayCount}x`;

      const title =
        t.title.length > 38 ? t.title.slice(0, 37) + "…" : t.title.padEnd(38);
      const prefix = i === this.selectedIdx ? "▸" : " ";
      if (t.status === "done") {
        return `${prefix} \u2713 ${STRIKE}${title}${RESET}`;
      }
      return `${prefix} [${t.status}] ${title} Due: ${t.dueDate}${flag ? " " + flag : ""}`;
    });

    if (lines.length === 0) {
      lines.push(" No pending tasks. Good work.");
    }

    this.list.setContent(lines.join("\n"));
    if (this.debug) {
      this.debugPanel!.setContent(this.logs.join("\n"));
      this.debugPanel!.setScrollPerc(100);
    }
    this.footer.setContent(
      " a:add  d:delay  space:done  s:all  ↑↓:navigate  r:refresh  q:quit ",
    );
    this.screen.render();
  }

  private modalCleanup(): void {
    this.modalActive = false;
    this.closeModal = null;
    this.loadTasks();
    this.render();
  }

  private addTaskModal(): void {
    this.modalActive = true;

    const today = new Date().toISOString().split("T")[0];
    const box = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 52,
      height: 9,
      border: { type: "line" },
      label: " Add Task ",
      style: { border: { fg: "cyan" } },
    });

    blessed.text({ parent: box, top: 0, left: 2, content: "Title:" });
    const titleInput = blessed.textbox({
      parent: box,
      top: 1,
      left: 2,
      width: 44,
      height: 1,
      inputOnFocus: true,
    });

    blessed.text({
      parent: box,
      top: 3,
      left: 2,
      content: `Due: ${today}  Priority: medium`,
      style: { dim: true },
    });

    const submitBtn = blessed.button({
      parent: box,
      top: 6,
      left: 6,
      width: 14,
      height: 1,
      content: " Save ",
      align: "center",
      keys: true,
      style: {
        bold: true,
        fg: "white",
        bg: "blue",
        focus: { bg: "green" },
      },
    });

    const cancelBtn = blessed.button({
      parent: box,
      top: 6,
      left: 26,
      width: 14,
      height: 1,
      content: " Cancel ",
      align: "center",
      keys: true,
      style: {
        bold: true,
        fg: "white",
        bg: "red",
        focus: { bg: "green" },
      },
    });

    const cleanup = () => {
      box.destroy();
      this.modalCleanup();
    };
    this.closeModal = cleanup;

    const submit = () => {
      const title = titleInput.value?.trim();
      if (!title) return;
      this.store.create({
        title,
        dueDate: today,
        priority: "medium",
      });
      cleanup();
    };

    titleInput.key("enter", submit);
    submitBtn.on("press", submit);
    cancelBtn.on("press", cleanup);

    titleInput.focus();
    this.screen.render();
  }

  private markDone(): void {
    const task = this.tasks[this.selectedIndex()];
    if (!task) return;
    this.store.markDone(task.id);
    this.loadTasks();
    this.render();
  }

  private delayModal(): void {
    const task = this.tasks[this.selectedIndex()];
    if (!task) return;

    this.modalActive = true;

    const box = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 40,
      height: 7,
      border: { type: "line" },
      label: ` Delay: ${task.title.slice(0, 18)} `,
      style: { border: { fg: "cyan" } },
    });

    blessed.text({ parent: box, top: 0, left: 2, content: "Hours (1-168):" });
    const input = blessed.textbox({
      parent: box,
      top: 1,
      left: 2,
      width: 32,
      height: 1,
      inputOnFocus: true,
    });

    const submitBtn = blessed.button({
      parent: box,
      top: 4,
      left: 4,
      width: 12,
      height: 1,
      content: " Submit ",
      align: "center",
      keys: true,
      style: {
        bold: true,
        fg: "white",
        bg: "blue",
        focus: { bg: "green" },
      },
    });

    const cancelBtn = blessed.button({
      parent: box,
      top: 4,
      left: 20,
      width: 12,
      height: 1,
      content: " Cancel ",
      align: "center",
      keys: true,
      style: {
        bold: true,
        fg: "white",
        bg: "red",
        focus: { bg: "green" },
      },
    });

    const cleanup = () => {
      box.destroy();
      this.modalCleanup();
    };
    this.closeModal = cleanup;

    input.focus();

    const submit = () => {
      const num = parseInt(input.value, 10);
      if (isNaN(num) || num < 1 || num > 168) return;
      this.store.delay(task.id, num);
      cleanup();
    };

    input.key("enter", submit);
    submitBtn.on("press", submit);
    cancelBtn.on("press", cleanup);

    this.screen.render();
  }

  private quit(): void {
    this.screen.destroy();
    process.exit(0);
  }
}
