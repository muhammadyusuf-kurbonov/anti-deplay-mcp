#!/usr/bin/env bun
import { argv } from "bun";
import { TaskStore } from "./task-store";
import { CLI } from "./cli";
import { MCPServer } from "./mcp-server";
import { TUI } from "./tui";

function main() {
  const args = argv.slice(2);

  const store = new TaskStore();

  if (args.length === 0) {
    const tui = new TUI(store);
    tui.run().catch((err) => {
      console.error("TUI error:", err);
      process.exit(1);
    });
    return;
  }

  if (args[0] === "serve") {
    const server = new MCPServer(store);
    server.start().catch((err) => {
      console.error("MCP server error:", err);
      process.exit(1);
    });
  } else if (args[0] === "task") {
    const cli = new CLI(store);
    cli.run(args.slice(1));
  } else if (args[0] === "report") {
    const cli = new CLI(store);
    cli.run(["report"]);
  } else if (args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: anti-deplay [command] [options]");
    console.log("  (no args)                      Start TUI (default)");
    console.log("  anti-deplay task <action> ...  Manage tasks");
    console.log("  anti-deplay report             Generate task report for AI agent");
    console.log("  anti-deploy serve              Start MCP server");
    console.log("  anti-deploy --help             Show this help");
  } else {
    console.error(`Unknown command: ${args[0]}`);
    console.log("Use --help for usage info.");
    process.exit(1);
  }
}

main();
