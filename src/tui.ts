import { TaskStore, Task } from "./task-store";

const ESC = "\x1b";
const CSI = `${ESC}[`;

function hideCursor(): void {
  process.stdout.write(`${CSI}?25l`);
}

function showCursor(): void {
  process.stdout.write(`${CSI}?25h`);
}

function clearScreen(): void {
  process.stdout.write(`${CSI}2J${CSI}H`);
}

function moveTo(row: number, col: number): void {
  process.stdout.write(`${CSI}${row};${col}H`);
}

function write(text: string): void {
  process.stdout.write(text);
}

function clearLine(): void {
  process.stdout.write(`${CSI}2K`);
}

function setBold(): void {
  process.stdout.write(`${CSI}1m`);
}

function setDim(): void {
  process.stdout.write(`${CSI}2m`);
}

function setRed(): void {
  process.stdout.write(`${CSI}31m`);
}



function setCyan(): void {
  process.stdout.write(`${CSI}36m`);
}

function resetStyle(): void {
  process.stdout.write(`${CSI}0m`);
}

function invertColors(): void {
  process.stdout.write(`${CSI}7m`);
}

export class TUI {
  private store: TaskStore;
  private tasks: Task[] = [];
  private selected = 0;
  private running = true;
  private statusMessage = "";
  private inputBuffer = "";

  constructor(store: TaskStore) {
    this.store = store;
  }

  async run(): Promise<void> {
    if (!process.stdin.isTTY) {
      console.error("TUI requires a TTY");
      process.exit(1);
    }

    hideCursor();
    this.loadTasks();
    this.render();
    this.listen();
  }

  private loadTasks(): void {
    const report = this.store.report();
    this.tasks = report.pending;
    if (this.selected >= this.tasks.length) {
      this.selected = Math.max(0, this.tasks.length - 1);
    }
  }

  private render(): void {
    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;

    clearScreen();

    this.drawHeader(rows, cols);
    this.drawTaskList(rows, cols);
    this.drawFooter(rows, cols);
    if (this.statusMessage) {
      moveTo(rows, 1);
      clearLine();
      setDim();
      write(` ${this.statusMessage}`);
      resetStyle();
      setTimeout(() => {
        this.statusMessage = "";
        this.render();
      }, 3000);
    }
  }

  private drawHeader(_rows: number, cols: number): void {
    setBold();
    setCyan();
    const title = " anti-delay ";
    const pending = this.tasks.length;
    write(`┌${"─".repeat(cols - 2)}┐`);
    moveTo(1, 2);
    write(`${title}${" ".repeat(cols - title.length - 8)}Pending: ${pending}`);
    resetStyle();
  }

  private drawTaskList(rows: number, _cols: number): void {
    const tableTop = 2;
    const tasksToShow = this.tasks.slice(0, Math.max(1, rows - 4));

    for (let i = 0; i < tasksToShow.length; i++) {
      const row = tableTop + 1 + i;
      moveTo(row, 1);
      clearLine();

      const t = tasksToShow[i];
      const selected = i === this.selected;

      if (selected) {
        invertColors();
      }

      let flag = "";
      if (t.delayCount >= 3) {
        flag = " ⚠";
      } else if (t.delayCount > 0) {
        flag = ` ~${t.delayCount}x`;
      }

      write(` ${selected ? "▸" : " "} [${t.status}] ${t.title}${flag}`);
      moveTo(row, Math.max(40, _cols - 30));
      write(`Due: ${t.dueDate}`);

      if (selected) {
        resetStyle();
      }
      resetStyle();
    }

    if (this.tasks.length === 0) {
      moveTo(tableTop + 2, 3);
      setDim();
      write("No pending tasks. Good work.");
      resetStyle();
    }
  }

  private drawFooter(rows: number, _cols: number): void {
    moveTo(rows, 1);
    clearLine();
    setDim();
    write(` d:delay hours  space:done  ↑↓:navigate  r:refresh  q:quit `);
    resetStyle();
  }

  private listen(): void {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk: string) => {
      if (!this.running) return;

      const seq = this.inputBuffer + chunk;
      this.inputBuffer = "";

      if (seq === "q" || seq === "\x03") {
        this.quit();
        return;
      }

      if (seq === "\x1b[A" || seq === "k") {
        this.selected = Math.max(0, this.selected - 1);
        this.render();
        return;
      }

      if (seq === "\x1b[B" || seq === "j") {
        this.selected = Math.min(this.tasks.length - 1, this.selected + 1);
        this.render();
        return;
      }

      if (seq === "r") {
        this.statusMessage = "Refreshed.";
        this.loadTasks();
        this.render();
        return;
      }

      if (seq === " ") {
        this.markDone();
        return;
      }

      if (seq === "d") {
        this.statusMessage = "";
        this.delayModal();
        return;
      }

      if (seq.startsWith("\x1b")) {
        this.inputBuffer = seq;
      }
    });
  }

  private async markDone(): Promise<void> {
    const task = this.tasks[this.selected];
    if (!task) return;

    const result = this.store.markDone(task.id);
    if (!result.ok) {
      this.statusMessage = `Error: ${result.error}`;
      this.render();
      return;
    }
    this.statusMessage = `"${task.title}" done.${result.next ? " Next instance created." : ""}`;
    this.loadTasks();
    this.render();
  }

  private async delayModal(): Promise<void> {
    const task = this.tasks[this.selected];
    if (!task) return;

    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    const modalH = 5;
    const modalW = 46;
    const top = Math.floor((rows - modalH) / 2);
    const left = Math.floor((cols - modalW) / 2);

    process.stdin.removeAllListeners("data");

    let input = "";
    let error = "";

    const drawBox = () => {
      for (let r = top; r < top + modalH && r < rows; r++) {
        moveTo(r, left);
        clearLine();
        if (r === top) {
          setBold();
          setCyan();
          write(`┌${"─".repeat(modalW - 2)}┐`);
        } else if (r === top + 1) {
          setBold();
          write(`│ ${`Delay "${task.title.slice(0, 30)}"`}${" ".repeat(Math.max(0, modalW - 38 - 4))} │`);
        } else if (r === top + 2) {
          write(`│ ${" ".repeat(modalW - 4)} │`);
        } else if (r === top + 3) {
          write(`│ Hours (1-168): ${input}${" ".repeat(Math.max(0, modalW - 18 - input.length - 2))} │`);
        } else if (r === top + 4) {
          write(`│ ${" ".repeat(modalW - 4)} │`);
        }
        resetStyle();
      }
      if (error) {
        moveTo(top + modalH + 1, left + 2);
        setRed();
        write(error);
        resetStyle();
      }
      moveTo(top + 3, left + 18 + input.length + 1);
    };

    drawBox();
    showCursor();

    const modalHandler = (chunk: string) => {
      const key = chunk;

      if (key === "\r" || key === "\n") {
        const num = parseInt(input, 10);
        if (isNaN(num) || num < 1 || num > 168) {
          error = "Enter a number between 1 and 168";
          drawBox();
          return;
        }
        cleanup();
        const result = this.store.delay(task.id, num);
        if ("error" in result) {
          this.statusMessage = `Error: ${result.error}`;
        } else {
          this.statusMessage = result.message;
        }
        this.loadTasks();
        this.render();
        return;
      }

      if (key === "\x1b" || key === "\x03") {
        cleanup();
        this.statusMessage = "Cancelled.";
        this.render();
        return;
      }

      if (key === "\x7f" || key === "\b") {
        input = input.slice(0, -1);
        error = "";
        drawBox();
        return;
      }

      if (key.length === 1 && key >= "0" && key <= "9" && input.length < 3) {
        input += key;
        error = "";
        drawBox();
      }
    };

    process.stdin.on("data", modalHandler);

    const cleanup = () => {
      hideCursor();
      process.stdin.removeListener("data", modalHandler);
      process.stdin.removeAllListeners("data");
      this.listen();
    };
  }

  private quit(): void {
    this.running = false;
    process.stdin.removeAllListeners("data");
    process.stdin.setRawMode(false);
    process.stdin.pause();
    clearScreen();
    showCursor();
    moveTo(1, 1);
    process.exit(0);
  }
}
