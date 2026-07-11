import { argv } from "bun";

function main() {
  const args = argv.slice(2);
  if (args[0] === "serve") {
    console.log("MCP server mode: not yet implemented");
  } else {
    console.log("CLI mode: not yet implemented");
  }
}

main();
