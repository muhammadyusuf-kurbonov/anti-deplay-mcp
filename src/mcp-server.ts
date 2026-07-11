import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TaskStore } from "./task-store";

export class MCPServer {
  private server: McpServer;

  constructor(private store: TaskStore) {
    this.server = new McpServer({
      name: "anti-delay-mcp-server",
      version: "0.1.0",
    });
    this.registerTools();
    this.registerResources();
  }

  private registerTools(): void {
    const AddTaskSchema = z.object({
      title: z.string().min(1).max(200).describe("Task title"),
      description: z.string().max(1000).optional().describe("Task description"),
      dueDate: z.string().describe("Due date in YYYY-MM-DD format"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
      recurring: z.enum(["daily", "weekly", "monthly"]).optional().describe("Recurring schedule"),
    }).strict();

    this.server.registerTool(
      "anti_delay_add_task",
      {
        title: "Add Task",
        description: `Create a new anti-procrastination task.

Args:
  - title (string): Task title (required)
  - description (string, optional): Task description
  - dueDate (string): Due date in YYYY-MM-DD format (required)
  - priority ('low' | 'medium' | 'high', optional): Task priority (default: medium)
  - recurring ('daily' | 'weekly' | 'monthly', optional): Recurring schedule

Returns: The created task object with id, title, dueDate, priority, status, etc.`,
        inputSchema: AddTaskSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const task = this.store.create(params);
          return {
            content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );

    const ListTasksSchema = z.object({
      status: z.enum(["pending", "done", "delayed"]).optional().describe("Filter by status"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Filter by priority"),
    }).strict();

    this.server.registerTool(
      "anti_delay_list_tasks",
      {
        title: "List Tasks",
        description: `List all anti-procrastination tasks with optional filters.

Args:
  - status ('pending' | 'done' | 'delayed', optional): Filter by status
  - priority ('low' | 'medium' | 'high', optional): Filter by priority

Returns: Array of task objects sorted by creation date (newest first).`,
        inputSchema: ListTasksSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (params) => {
        try {
          const tasks = this.store.list(params);
          return {
            content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );

    const UpdateTaskSchema = z.object({
      id: z.string().describe("Task ID to update"),
      title: z.string().min(1).max(200).optional().describe("New title"),
      description: z.string().max(1000).optional().describe("New description"),
      dueDate: z.string().optional().describe("New due date in YYYY-MM-DD format"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
      recurring: z.enum(["daily", "weekly", "monthly"]).nullable().optional().describe("New recurring schedule"),
    }).strict();

    this.server.registerTool(
      "anti_delay_update_task",
      {
        title: "Update Task",
        description: `Update an existing task's fields. Only provided fields are updated.

Args:
  - id (string): Task ID to update (required)
  - title (string, optional): New title
  - description (string, optional): New description
  - dueDate (string, optional): New due date in YYYY-MM-DD format
  - priority ('low' | 'medium' | 'high', optional): New priority
  - recurring ('daily' | 'weekly' | 'monthly' | null, optional): Set recurring schedule or null to remove

Returns: The updated task object, or error if task not found.`,
        inputSchema: UpdateTaskSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const { id, ...updates } = params;
          const task = this.store.update(id, updates);
          if (!task) {
            return {
              content: [{ type: "text", text: `Error: Task not found: ${id}` }],
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );

    const DeleteTaskSchema = z.object({
      id: z.string().describe("Task ID to delete"),
    }).strict();

    this.server.registerTool(
      "anti_delay_delete_task",
      {
        title: "Delete Task",
        description: `Permanently delete a task by ID.

Args:
  - id (string): Task ID to delete (required)

Returns: Success confirmation or error if task not found.`,
        inputSchema: DeleteTaskSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const deleted = this.store.delete(params.id);
          if (!deleted) {
            return {
              content: [{ type: "text", text: `Error: Task not found: ${params.id}` }],
            };
          }
          return {
            content: [{ type: "text", text: `Task ${params.id} deleted` }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );

    const DelayTaskSchema = z.object({
      id: z.string().describe("Task ID to delay"),
      days: z.number().int().min(1).max(7).describe("Number of days to delay (1-7)"),
    }).strict();

    this.server.registerTool(
      "anti_delay_delay_task",
      {
        title: "Delay Task",
        description: `Postpone a task by 1-7 days. The task status changes to 'delayed' and delayCount increments.

Args:
  - id (string): Task ID to delay (required)
  - days (number): Days to postpone, between 1-7 (required)

Returns: The updated task with new dueDate and incremented delayCount.`,
        inputSchema: DelayTaskSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const result = this.store.delay(params.id, params.days);
          if ("error" in result) {
            return {
              content: [{ type: "text", text: `Error: ${result.error}` }],
            };
          }
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ task: result.task, message: result.message }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );

    const MarkDoneSchema = z.object({
      id: z.string().describe("Task ID to mark as done"),
    }).strict();

    this.server.registerTool(
      "anti_delay_mark_done",
      {
        title: "Mark Task Done",
        description: `Mark a task as completed. If the task is recurring, a new task instance is auto-created for the next period.

Args:
  - id (string): Task ID to mark done (required)

Returns: The completed task. If recurring, also returns the next instance.`,
        inputSchema: MarkDoneSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const result = this.store.markDone(params.id);
          if (!result.ok) {
            return {
              content: [{ type: "text", text: `Error: ${result.error}` }],
            };
          }
          const output: Record<string, unknown> = { task: result.task };
          if (result.next) {
            output.next = result.next;
          }
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );

    this.server.registerTool(
      "anti_delay_generate_report",
      {
        title: "Generate Report",
        description: `Generate a report of all pending tasks with delay counts, sorted by due date (most urgent first).

This is designed for AI agent cron calls. Returns structured data about tasks needing attention.

Returns: Object with pending[] (sorted by dueDate ASC) and total.`,
        inputSchema: z.object({}).strict(),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () => {
        try {
          const report = this.store.report();
          return {
            content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    );
  }

  private registerResources(): void {
    this.server.resource(
      "All tasks",
      "tasks://list",
      async (uri) => ({
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify(this.store.list(), null, 2),
        }],
      }),
    );

    this.server.resource(
      "Task by ID",
      new ResourceTemplate("tasks://{id}", { list: undefined }),
      async (uri, params) => {
        const id = String(params.id);
        const task = this.store.getById(id);
        if (!task) {
          throw new Error(`Task not found: ${id}`);
        }
        return {
          contents: [{
            uri: uri.toString(),
            text: JSON.stringify(task, null, 2),
          }],
        };
      },
    );
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
