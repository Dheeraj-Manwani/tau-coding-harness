import type OpenAI from "openai";

type ChatCompletionToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

export type Tool = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];

export const silentTools = new Set<Tool>([
  "report_progress",
  "create_plan",
  "update_todo",
  "add_todos",
  "ask_user",
]);

export const subAgentTools = new Set<Tool>([
  "dispatch_explorer",
  "dispatch_debugger",
  "dispatch_verifier",
  // "dispatch_implementer",
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
      name: "list_dir",
      description:
        "List files and directories in the sandbox at the given path, without spending a run_command round-trip on `ls`.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to the project root. Defaults to the project root itself.",
          },
          depth: {
            type: "number",
            description:
              "How many directory levels deep to list. Defaults to 1 (immediate children only).",
          },
        },
        required: [],
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
      description:
        "Run a shell command inside the sandbox. Long-running or slow-starting commands (dev servers, background workers) are detected automatically and run in the background, but you can also set `background` explicitly instead of relying on that detection.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute.",
          },
          timeoutMs: {
            type: "number",
            description:
              "Max time to wait for a foreground command to finish, in milliseconds. Defaults to 60000. Ignored for background commands.",
          },
          background: {
            type: "boolean",
            description:
              "Run the command in the background instead of waiting for it to finish. Its stdout/stderr are captured to a log file whose path is returned so you can read it later (e.g. with tail_command_output). If omitted, this is inferred from the command text.",
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
      name: "tail_command_output",
      description:
        "Read the trailing lines of a background command's captured output log — the `logPath` returned by run_command when it started something in the background.",
      parameters: {
        type: "object",
        properties: {
          logPath: {
            type: "string",
            description:
              "The logPath returned by a prior background run_command call.",
          },
          lines: {
            type: "number",
            description: "Number of trailing lines to return. Defaults to 200.",
          },
        },
        required: ["logPath"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wait_for_port",
      description:
        "Poll a localhost port inside the sandbox until it responds or a timeout elapses. Use this after starting a server or background process instead of hand-rolling a sleep + curl loop.",
      parameters: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "The localhost port to poll.",
          },
          timeoutMs: {
            type: "number",
            description:
              "Max total time to keep polling, in milliseconds. Defaults to 30000.",
          },
        },
        required: ["port"],
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
            type: "array",
            items: { type: "string" },
            description:
              "Todo items for the plan. Each todo should describe a feature the user will see (e.g. 'Show product catalog', 'Add shopping cart page'). Never include technical terms like store, state, component, reducer, context, localStorage, API, or library names.",
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
      name: "add_todos",
      description:
        "Append new todo items to the current plan without replacing existing ones or their statuses. Use this when you discover more work mid-task instead of re-running create_plan, which would reset every todo back to pending.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: { type: "string" },
            description:
              "New todo items to add, in the same style as create_plan's todos.",
          },
        },
        required: ["todos"],
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
      name: "check_sandbox",
      description:
        "Cheap liveness check for the current sandbox — returns { alive: true|false }. Call this before trusting a sandbox with a batch of writes, e.g. right after reconnecting to an existing one or after a long idle gap.",
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
        "Dispatch a sub-agent in an isolated context to investigate a bug, error, or unexpected behavior. Use this the moment you're stuck on a repeated failure, not just after reading an error message — don't trial-and-error manually first. It reproduces the issue, reads logs/files, and runs commands to find the root cause, then returns a written explanation of what's wrong and a recommended fix. It does not edit any files — apply the fix yourself once you have its findings.",
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
  // {
  //   type: "function",
  //   function: {
  //     name: "dispatch_implementer",
  //     description:
  //       "Dispatch a sub-agent in an isolated context to implement a self-contained goal. Unlike the other sub-agents, it edits files: it has read tools to find existing conventions in the codebase itself (route paths, response shapes, naming) as well as write tools, so you don't have to pre-resolve every field and type before dispatching it. Use it to offload a well-scoped chunk of implementation instead of writing every line yourself; don't use it for anything touching shared files (App.tsx, src/main.tsx, .tau/CONTEXT.md) or spanning the whole app.",
  //     parameters: {
  //       type: "object",
  //       properties: {
  //         goal: {
  //           type: "string",
  //           description:
  //             "What to build, in plain terms, e.g. 'Add a POST /api/orders route that creates an order and returns its id' or 'Build a settings page with a dark mode toggle that persists to localStorage.'",
  //         },
  //         relevant_files: {
  //           type: "array",
  //           items: { type: "string" },
  //           description:
  //             "Optional: file paths already known to be relevant (e.g. a schema file, a similar existing route). Not required — the sub-agent can find what it needs itself.",
  //         },
  //       },
  //       required: ["goal"],
  //       additionalProperties: false,
  //     },
  //   },
  // },
] as const satisfies readonly ChatCompletionToolDef[];
