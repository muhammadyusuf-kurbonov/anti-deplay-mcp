#!/usr/bin/env bun
import { argv } from "bun";
import { TaskStore } from "./task-store";
import { CLI } from "./cli";
import { MCPServer } from "./mcp-server";

function main() {
  const args = argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: anti-deplay <command> [options]");
    console.log("  anti-deplay task <action> ...   Manage tasks");
    console.log("  anti-deplay report              Generate task report for AI agent");
    console.log("  anti-deploy serve               Start MCP server");
    process.exit(1);
  }

  const store = new TaskStore();

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
  } else {
    console.error(`Unknown command: ${args[0]}`);
    process.exit(1);
  }
}

main();
