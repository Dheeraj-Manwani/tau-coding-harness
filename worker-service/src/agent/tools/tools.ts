import type OpenAI from "openai";

type ChatCompletionToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

export type Tool = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];

export const silentTools = new Set<Tool>([
  "report_progress",
  "create_plan",
  "update_todo",
  "ask_user",
]);

export const subAgentTools = new Set<Tool>([
  "dispatch_explorer",
  "dispatch_debugger",
  "dispatch_verifier",
  "dispatch_implementer",
]);

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "create_file",
      description:
        "Create or overwrite a file in the sandbox at the given path with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path of the file relative to the project root.",
          },
          content: {
            type: "string",
            description: "Full content to write to the file.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path of the file relative to the project root.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit an existing file in the sandbox by replacing an exact occurrence of old_string with new_string. The old_string must match the file content exactly and be unique unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path of the file relative to the project root.",
          },
          old_string: {
            type: "string",
            description: "The exact text to replace.",
          },
          new_string: {
            type: "string",
            description: "The text to replace it with.",
          },
          replace_all: {
            type: "boolean",
            description:
              "Replace all occurrences of old_string instead of requiring a unique match. Defaults to false.",
          },
        },
        required: ["path", "old_string", "new_string"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file in the sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path of the file relative to the project root.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command inside the sandbox.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_progress",
      description:
        "Call once at the start of each new phase of work. The message is shown to the user as a status update.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "Short, friendly, present-tense description. Max 12 words, non-technical. E.g. 'Setting up the database now.' or 'Building the frontend components.'",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_plan",
      description:
        "Create a plan to implement the request - recommended for longer tasks.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Short name of the plan. Ex: Landing Page, Ecommerce App, etc",
          },
          description: {
            type: "string",
            description:
              "Description about the plan, what are you going to do for it, and any other relevant info",
          },
          todos: {
            type: "string",
            description:
              "Todo points for the plan separated by commas (,). Each todo should describe a feature the user will see (e.g. 'Show product catalog', 'Add shopping cart page'). Never include technical terms like store, state, component, reducer, context, localStorage, API, or library names.",
          },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_todo",
      description:
        "Update the status of a todo item in the current plan by its serial number. Call this immediately after completing each item — do not batch multiple updates at the end.",
      parameters: {
        type: "object",
        properties: {
          sno: {
            type: "number",
            description:
              "Serial number of the todo, which status needs to change",
          },
          status: {
            type: "string",
            description:
              "Updated status of the todo - one of 'done', 'skipped', 'pending' or 'blocked'. By default all todos are in pending status",
          },
        },
        required: ["sno", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Pause and ask the user a clarifying question before proceeding. Use when a key decision requires user input (e.g. preferred framework, color scheme, feature scope). The user can pick one of the provided options or type a free-form answer.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask the user.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description:
              "Suggested answer options shown as clickable chips. The user may also type a custom answer.",
          },
        },
        required: ["question", "options"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "provision_sandbox",
      description:
        "Call this to provision a sandbox with boilderplate files. Without this, you won't be able to call create_file, read_file, edit_file etc",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dispatch_explorer",
      description:
        "Dispatch a read-only sub-agent in an isolated context to investigate and explain how part of the existing app currently works (e.g. 'how is auth wired up', 'where is the cart total computed', 'what does the current schema look like'). It reads files and searches the codebase, then returns a short written summary — it never edits anything. Use this instead of manually opening many files yourself when orienting in an unfamiliar area of a larger app.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "A specific, scoped question about the current app to investigate, e.g. 'Explain how the checkout flow calculates totals and where that logic lives.'",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dispatch_debugger",
      description:
        "Dispatch a sub-agent in an isolated context to investigate a bug, error, or unexpected behavior. It reproduces the issue, reads logs/files, and runs commands to find the root cause, then returns a written explanation of what's wrong and a recommended fix. It does not edit any files — apply the fix yourself once you have its findings.",
      parameters: {
        type: "object",
        properties: {
          problem: {
            type: "string",
            description:
              "A clear description of the bug or error, including any error message or symptom observed, e.g. 'POST /api/orders returns 500 after adding the discount field.'",
          },
          known_context: {
            type: "string",
            description:
              "Optional: anything already known that might help, such as relevant file paths, recent changes, or when the issue started.",
          },
        },
        required: ["problem"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dispatch_verifier",
      description:
        "Dispatch a sub-agent in an isolated context to verify a scope of recent changes. It checks that the frontend compiles, runs relevant curl checks against changed API routes, and spot-checks the described behavior, then returns a pass/fail report with specifics on anything broken. It does not edit any files. Use this as your verification pass on larger or multi-file changes instead of manually re-deriving every check.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description:
              "What to verify, in plain terms, e.g. 'the new checkout flow' or 'every API route touched this turn'.",
          },
          checks: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of specific things to check, e.g. ['POST /api/orders returns 201 with a valid id', 'cart total updates after removing an item'].",
          },
        },
        required: ["scope"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dispatch_implementer",
      description:
        "Dispatch a sub-agent to implement a single, narrowly-scoped piece of the app — typically a set of API routes or a self-contained UI section — given an explicit contract you define upfront. The sub-agent writes files and runs commands autonomously, then returns a summary of what it built. Only call this after you have fully resolved the contract (route paths, request/response shapes, shared types) yourself — never delegate contract decisions to this agent. Do not use for anything that touches shared files like App.tsx, CONTEXT.md, or global type definitions; handle those yourself before or after dispatching.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "A precise, self-contained description of what to build, e.g. 'Add POST /api/cart/checkout and GET /api/cart/:id routes to server/index.ts using the existing Hono app and Drizzle setup.'",
          },
          contract: {
            type: "string",
            description:
              "The full agreed contract this agent must implement against — route paths, HTTP methods, request body fields and types, response payload fields and types, and any error cases. Must be resolved by the main agent before dispatching. Example: 'POST /api/cart/checkout — body: { cartId: string, couponCode?: string } — 201: { orderId: string, total: number } — 400: { error: string }'",
          },
          relevant_files: {
            type: "array",
            items: { type: "string" },
            description:
              "File paths the sub-agent should read before starting, e.g. ['server/index.ts', 'server/db/schema.ts']. Keep this list tight — only files actually needed to complete the task.",
          },
        },
        required: ["task", "contract"],
        additionalProperties: false,
      },
    },
  },
] as const satisfies readonly ChatCompletionToolDef[];
