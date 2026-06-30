import type OpenAI from "openai";

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export const silentTools = new Set([
  "report_progress",
  "report_plan",
  "create_plan",
  "update_todo",
  "ask_user",
]);

export const TOOL_DEFINITIONS: Tool[] = [
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
];
