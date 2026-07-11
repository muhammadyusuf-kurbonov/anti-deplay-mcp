import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TaskStore } from "./task-store";

export class MCPServer {
  private server: Server;

  constructor(private store: TaskStore) {
    this.server = new Server(
      { name: "anti-deplay", version: "0.1.0" },
      { capabilities: { tools: {}, resources: {} } },
    );
    this.registerHandlers();
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "tasks_create",
          description: "Create a new task",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              dueDate: { type: "string", description: "ISO 8601 date (e.g., 2026-07-12)" },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              recurring: { type: "string", enum: ["daily", "weekly", "monthly"] },
            },
            required: ["title", "dueDate"],
          },
        },
        {
          name: "tasks_list",
          description: "List tasks, optionally filtered",
          inputSchema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["pending", "done", "delayed"] },
              priority: { type: "string", enum: ["low", "medium", "high"] },
            },
          },
        },
        {
          name: "tasks_update",
          description: "Update a task's fields",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              dueDate: { type: "string" },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              recurring: { type: "string", enum: ["daily", "weekly", "monthly"] },
            },
            required: ["id"],
          },
        },
        {
          name: "tasks_delete",
          description: "Delete a task",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
        {
          name: "delay_task",
          description: "Delay a task by 1-7 days. Shows delay count as pressure.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              days: { type: "number", minimum: 1, maximum: 7 },
            },
            required: ["id", "days"],
          },
        },
        {
          name: "tasks_mark_done",
          description: "Mark a task as done. If recurring, auto-creates the next instance.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      switch (name) {
        case "tasks_create": {
          const t = this.store.create(args as any);
          return { content: [{ type: "text", text: JSON.stringify(t, null, 2) }] };
        }
        case "tasks_list": {
          const tasks = this.store.list(args as any);
          return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
        }
        case "tasks_update": {
          const { id, ...fields } = args as any;
          const result = this.store.update(id, fields);
          if (!result) return { content: [{ type: "text", text: "Task not found" }], isError: true };
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "tasks_delete": {
          const ok = this.store.delete((args as any).id);
          return { content: [{ type: "text", text: ok ? "Deleted" : "Not found" }] };
        }
        case "delay_task": {
          const { id, days } = args as any;
          const result = this.store.delay(id, days);
          if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
          return { content: [{ type: "text", text: `${result.message}\n${JSON.stringify(result.task, null, 2)}` }] };
        }
        case "tasks_mark_done": {
          const result = this.store.markDone((args as any).id);
          if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        default:
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "tasks://list",
          name: "All tasks",
          description: "List of all tasks in the store",
          mimeType: "application/json",
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (uri === "tasks://list") {
        const tasks = this.store.list();
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(tasks, null, 2) }] };
      }
      const match = uri.match(/^tasks:\/\/(.+)$/);
      if (match) {
        const task = this.store.getById(match[1]);
        if (!task) return { contents: [{ uri, mimeType: "application/json", text: "Not found" }] };
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(task, null, 2) }] };
      }
      return { contents: [{ uri, mimeType: "application/json", text: "Unknown resource" }] };
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
