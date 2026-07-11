import { TaskStore, Task } from "./task-store";
import * as blessed from "blessed";

export class TUI {
  private store: TaskStore;
  private screen: blessed.Widgets.Screen;
  private list: blessed.Widgets.ListElement;
  private header: blessed.Widgets.BoxElement;
  private footer: blessed.Widgets.BoxElement;
  private tasks: Task[] = [];
  private modalActive = false;
  private closeModal: (() => void) | null = null;

  constructor(store: TaskStore) {
    this.store = store;

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

    this.list = blessed.list({
      parent: this.screen,
      top: 1,
      left: 0,
      width: "100%",
      height: "100%-2",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { invert: true },
      },
    });

    this.footer = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { fg: "white", dim: true },
    });

    this.screen.key(["q", "C-c"], () => {
      if (!this.modalActive) this.quit();
    });
    this.screen.key(" ", () => {
      if (!this.modalActive) this.markDone();
    });
    this.screen.key("d", () => {
      if (!this.modalActive) this.delayModal();
    });
    this.screen.key("a", () => {
      if (!this.modalActive) this.addTaskModal();
    });
    this.screen.key("r", () => {
      if (!this.modalActive) {
        this.loadTasks();
        this.render();
      }
    });
    this.screen.key("escape", () => {
      if (this.closeModal) {
        this.closeModal();
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

  private selectedIndex(): number {
    return (this.list as any).selected as number;
  }

  private loadTasks(): void {
    this.tasks = this.store.report().pending;
    const sel = this.selectedIndex();
    if (sel >= this.tasks.length) {
      this.list.select(Math.max(0, this.tasks.length - 1));
    }
  }

  private render(): void {
    const pending = this.tasks.length;
    const titleText = " anti-delay ";
    this.header.setContent(
      `${titleText}${" ".repeat(Math.max(0, this.screen.cols - titleText.length - 20))}Pending: ${pending}`,
    );

    const items = this.tasks.map((t) => {
      let flag = "";
      if (t.delayCount >= 3) flag = "⚠";
      else if (t.delayCount > 0) flag = `~${t.delayCount}x`;

      const title =
        t.title.length > 38 ? t.title.slice(0, 37) + "…" : t.title.padEnd(38);
      return ` [${t.status}] ${title} Due: ${t.dueDate}${flag ? " " + flag : ""}`;
    });

    if (items.length === 0) {
      items.push(" No pending tasks. Good work.");
    }

    this.list.setItems(items);
    this.footer.setContent(
      " a:add  d:delay  space:done  ↑↓:navigate  r:refresh  q:quit ",
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

    const box = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 52,
      height: 11,
      border: { type: "line" },
      label: " Add New Task ",
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

    blessed.text({ parent: box, top: 2, left: 2, content: "Description:" });
    const descInput = blessed.textbox({
      parent: box,
      top: 3,
      left: 2,
      width: 44,
      height: 1,
      inputOnFocus: true,
    });

    blessed.text({ parent: box, top: 4, left: 2, content: "Due (YYYY-MM-DD):" });
    const dueInput = blessed.textbox({
      parent: box,
      top: 5,
      left: 2,
      width: 44,
      height: 1,
      inputOnFocus: true,
    });

    blessed.text({ parent: box, top: 6, left: 2, content: "Priority [medium]:" });
    const priorityInput = blessed.textbox({
      parent: box,
      top: 7,
      left: 2,
      width: 44,
      height: 1,
      inputOnFocus: true,
    });

    const submitBtn = blessed.button({
      parent: box,
      top: 9,
      left: 6,
      width: 14,
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
      top: 9,
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

    titleInput.focus();

    submitBtn.on("press", () => {
      const title = titleInput.value?.trim();
      const dueDate = dueInput.value?.trim();
      if (!title || !dueDate) return;
      this.store.create({
        title,
        description: descInput.value?.trim() || undefined,
        dueDate,
        priority: (priorityInput.value?.trim() ||
          "medium") as "low" | "medium" | "high",
      });
      cleanup();
    });

    cancelBtn.on("press", cleanup);

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

    submitBtn.on("press", () => {
      const num = parseInt(input.value, 10);
      if (isNaN(num) || num < 1 || num > 168) return;
      this.store.delay(task.id, num);
      cleanup();
    });

    cancelBtn.on("press", cleanup);

    this.screen.render();
  }

  private quit(): void {
    this.screen.destroy();
    process.exit(0);
  }
}
