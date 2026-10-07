import type OpenAI from "openai";
import { DOC_NAMES } from "../docs";

type ChatCompletionToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

export type Tool =
  | (typeof TOOL_DEFINITIONS)[number]["function"]["name"]
  | (typeof BASE_APP_TOOLS)[number]["function"]["name"];

export const silentTools = new Set<Tool>([
  "report_progress",
  "create_plan",
  "update_todo",
  "add_todos",
  "ask_user",
  "request_secret",
]);

export const subAgentTools = new Set<Tool>([
  "dispatch_explorer",
  "dispatch_debugger",
  "dispatch_verifier",
  "dispatch_design_reviewer",
  // "dispatch_implementer",
]);

/**
 * `provision_sandbox` for a generation-2 project. There is one base image, so
 * there is no `template` to pick; the agent loop swaps this in for the entry in
 * `TOOL_DEFINITIONS` below (same name, so the executor and `Tool` are
 * unaffected).
 */
export const PROVISION_SANDBOX_BASE_TOOL = {
  type: "function",
  function: {
    name: "provision_sandbox",
    description:
      "Call this to get a sandbox to work in. Without it you cannot call create_file, read_file, edit_file, run_command and the like. For a new app it creates the app from tau's base and gives it a design of its own — a style, colours, typefaces — as the user chose it when they started the project, and otherwise chosen from the `brief` you pass, then returns the app's memory, its design and a map of its files. For an existing app it reconnects to the app as it is; `brief` is ignored.",
    parameters: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description:
            "For a new app: two or three sentences on what you are about to build, who it is for, and how it should feel. Include anything the user said about the look — a colour, light or dark, a mood, a style. tau designs the app from this, so be specific about the subject.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
} as const;

/**
 * Tools only a generation-2 project gets, appended to its tool list by the
 * agent loop. Kept out of `TOOL_DEFINITIONS` so generation-1 projects, whose
 * stack is fixed at creation, are sent exactly the tool list they always were.
 */
export const BASE_APP_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_backend",
      description:
        "Give this app a server: a Hono API in `server/index.ts`, reachable from the frontend at `/api/*`. Call it once, before writing any API route, when the app genuinely needs server-side logic. It sets everything up in place — installs what is needed and starts the server, with no rebuild — and returns the guide for writing routes. Safe to call again: on an app that already has a backend it changes nothing and returns the guide. You do NOT need it before `enable_ai`, `request_secret` or `add_database`; they add the backend themselves.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "One short sentence on what the server is for (e.g. 'proxy the weather API so the key stays private').",
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
      name: "add_database",
      description:
        "Give this app a real database: Postgres (PGlite) with Drizzle, in `server/db/`. Call it once, before writing any table or query, when data must be stored on the server — multiple users, accounts, or anything that has to outlive one browser. It adds the backend first if the app has none, sets everything up in place with no rebuild, and returns the guide for defining tables and writing queries. Safe to call again: on an app that already has a database it changes nothing and returns the guide. Do NOT use it for data that can live in the browser — React state or localStorage is the right tool for that.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "One short sentence on what needs storing on the server (e.g. 'bookings shared between all visitors').",
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
      name: "dispatch_design_reviewer",
      description:
        "Have the app looked at. You write markup and never see it rendered; this renders the screens you name at desktop and phone width, shows the screenshots to a reviewer that can see, and returns what it finds wrong: broken or overflowing layout, a phone layout that does not work, departures from the app's design, generic defaults, placeholder content, unreadable text. Each finding is marked [broken] (fix it) or [polish] (optional). Call it after you build or reshape a screen and fix what is broken; you may then call it once more for the same screens to confirm. A screen gets those two looks in a run and no more. It reviews what is on screen when it loads — a page behind a login or a button press is not seen, and an embedded map or video may not render for it. It does not edit files.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description:
              "The routes to review, e.g. ['/', '/pricing']. At most 4 in one call. Defaults to ['/'].",
          },
          focus: {
            type: "string",
            description:
              "Optional: anything you want looked at in particular, e.g. 'the pricing table on a phone'.",
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
      name: "read_doc",
      description:
        "Read one of tau's guides: the exact way a part of this app's stack is used here — API routes, database tables, AI calls, API keys, the theme, images, GitHub. Your instructions list the guides and say when to read each. Read the guide before writing code in its area, and follow it over what you remember. Needs no sandbox. A guide that is already in the conversation does not need reading again.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: DOC_NAMES,
            description: "Which guide to read.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
] as const;

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
      description:
        "Read a file in the sandbox. A file that fits is returned whole. A long one is returned a page at a time: you get the first 600 lines with the line range and total, and read on by passing `offset`. To look at one part of a big file, find the line with `grep` first, then read just that range.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path of the file relative to the project root.",
          },
          offset: {
            type: "number",
            description:
              "Line number to start reading from (1-based). Omit to start at the top.",
          },
          limit: {
            type: "number",
            description:
              "How many lines to read. Omit to read as much as fits (up to 600 lines).",
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
      name: "grep",
      description:
        "Search file contents in the project for a regular expression. Returns matching lines as `path:line:text`. Use this to find where something is defined or used instead of opening files one by one, and instead of running grep through run_command. Skips node_modules, build output and anything gitignored. Also works on a saved command log (pass its `logPath` as `path`).",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Regular expression to search for, e.g. 'useQuery\\(' or 'function handleSubmit'.",
          },
          path: {
            type: "string",
            description:
              "File or directory to search, relative to the project root. Defaults to the whole project.",
          },
          glob: {
            type: "string",
            description:
              "Only search files matching this glob, e.g. '*.tsx' or '*.css'.",
          },
          ignoreCase: {
            type: "boolean",
            description: "Match case-insensitively. Defaults to false.",
          },
          context: {
            type: "number",
            description:
              "Lines of context to show around each match (0-5). Defaults to 0.",
          },
        },
        required: ["pattern"],
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
        "Run a shell command inside the sandbox. Long-running or slow-starting commands (dev servers, background workers) are detected automatically and run in the background, but you can also set `background` explicitly instead of relying on that detection. Long output is cut in the middle and saved in full to a file whose `logPath` is returned; read, grep or tail that file for the rest.",
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
        "Read the trailing lines of a command's captured output log — the `logPath` returned by run_command when it started something in the background, or when a command's output was too long to return whole.",
      parameters: {
        type: "object",
        properties: {
          logPath: {
            type: "string",
            description:
              "The logPath returned by a prior run_command call.",
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
        "Call this to provision a sandbox with boilerplate files. Without this, you won't be able to call create_file, read_file, edit_file etc. Pass `template` to pick the stack that fits the request — this choice is locked in for the project once files are scaffolded, so choose deliberately on this first call. For an existing project (files already scaffolded) `template` is ignored and the project's original stack is reused.",
      parameters: {
        type: "object",
        properties: {
          template: {
            type: "string",
            enum: ["frontend", "fullstack", "fullstack-db"],
            description:
              "Which sandbox stack to boot. 'frontend' = Vite + React + shadcn only, no server or database (static/client-side apps: landing pages, calculators, tools, anything satisfiable with React state + localStorage). 'fullstack' = frontend + a Hono API but NO database baked in (needs custom server logic / endpoints but not persistent multi-user data). 'fullstack-db' = frontend + Hono API + a pre-wired PGlite/Drizzle database (multi-user data, auth, or any 'real'/server-side persistence). Default to 'frontend' for simple UIs; only escalate to 'fullstack'/'fullstack-db' when the request genuinely needs a backend. Defaults to 'fullstack' if omitted.",
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
      name: "web_search",
      description:
        "Search the web for up-to-date information — library docs, API references, error messages, current best practices, or anything outside your training data. Does not require a sandbox.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
          max_results: {
            type: "number",
            description: "Max number of results to return. Defaults to 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_images",
      description:
        "Find real, usable image URLs for a query — each returned with an AI description of what it actually depicts (e.g. 'front-facing photo of a silver Diet Coke can, transparent background' vs 'red Coca-Cola vector logo'). Use this to source assets (product photos, backgrounds, icons, hero images) instead of guessing at download URLs from web_search text results. Read each result's description to pick the right one — the correct subject, a photo vs a logo, and a transparent background when you need a cutout. Then verify resolution with image_dimensions and save the winner into the project with download_asset. Does not require a sandbox.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to find, described precisely. Include the subject plus qualifiers that matter for the use, e.g. 'Diet Coke can transparent PNG front view' or 'mountain landscape wide 4k'.",
          },
          max_results: {
            type: "number",
            description:
              "Max number of images to return (1-10). Defaults to 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "image_dimensions",
      description:
        "Return { width, height, format, fileSize } for an image URL without downloading the whole file. Use it to confirm a candidate asset is high-resolution enough for its use (e.g. a fullscreen hero or parallax layer needs a large image) before committing to it. Does not require a sandbox.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The image URL to inspect.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "download_asset",
      description:
        "Download a remote asset (image, font, media) from a URL INTO the project so it persists. Use this instead of `run_command(\"curl -o …\")` for any asset you want to keep: a curl'd file lives only in the throwaway sandbox and is lost on the next rebuild, while this saves the bytes durably (they show in the file tree, survive reloads, and push to GitHub). Typical flow: search_images → pick by description → image_dimensions to confirm resolution → download_asset into public/. Requires a provisioned sandbox.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The direct URL of the asset to download.",
          },
          path: {
            type: "string",
            description:
              "Destination path relative to the project root, including filename and extension, e.g. 'public/coke-can.png'. Keep downloadable assets under 'public/'.",
          },
        },
        required: ["url", "path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enable_ai",
      description:
        "Turn on AI features for the app you are building, so it can call a language model at runtime (chatbots, summarizing, classifying, generating text, answering questions about the user's data). Call this BEFORE writing any code that talks to a model. It provisions the user's tau API key, injects it into the running app as environment variables, and returns the exact code recipe to follow — you never handle or see the key itself. The app calls tau's own AI endpoint and it is billed to the user's existing credits, so no API key or account of their own is needed. Requires a provisioned sandbox. On a frontend-only project it first adds a backend and returns `needsReprovision: true` — when that happens, tell the user their app is gaining a server, then call `provision_sandbox` and `enable_ai` again. Safe to call more than once.",
      parameters: {
        type: "object",
        properties: {
          purpose: {
            type: "string",
            description:
              "One short phrase describing what the app will use AI for, e.g. 'summarize meeting notes' or 'answer questions about uploaded recipes'. Recorded for the user's reference.",
          },
        },
        required: ["purpose"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_secret",
      description:
        "Ask the user for API keys or other credentials for a third-party service the app calls at runtime (Stripe, Resend, OpenWeather, Supabase, Twilio, …). The user enters them in a secure form outside the chat — you never see the values and they never appear in the conversation. Saved keys are encrypted by tau, injected into the running app as environment variables (read them with `process.env.NAME` in SERVER code only), and restored on every rebuild. This is the ONLY way to get a credential from the user: never ask for one with ask_user or in plain text, never hardcode one, never write one into a file. Do NOT use this for AI models — use enable_ai. Keys already saved for the project are not asked for again unless `replace` is true. Pauses until the user answers; they may skip a key. On a frontend-only project it first adds a backend and returns `needsReprovision: true` — then tell the user, call `provision_sandbox`, and call this again.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "One or two plain sentences shown to the user in the chat explaining what the keys are for, e.g. 'To take payments, your app needs your Stripe secret key.' No technical jargon.",
          },
          secrets: {
            type: "array",
            description: "The keys to ask for (at most 10).",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description:
                    "Environment variable name in UPPER_SNAKE_CASE, e.g. STRIPE_SECRET_KEY. Must not start with VITE_ or TAU_.",
                },
                label: {
                  type: "string",
                  description: "Human-friendly field label, e.g. 'Stripe secret key'.",
                },
                description: {
                  type: "string",
                  description:
                    "Where the user finds it, in one short sentence, e.g. 'Stripe Dashboard → Developers → API keys. Starts with sk_.'",
                },
                url: {
                  type: "string",
                  description:
                    "Optional https link to the page where the user can create or copy the key.",
                },
              },
              required: ["name", "label", "description"],
              additionalProperties: false,
            },
          },
          replace: {
            type: "boolean",
            description:
              "Ask again even for keys that are already saved — only when the user says a saved key is wrong or wants to change it.",
          },
        },
        required: ["reason", "secrets"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "push_to_github",
      description:
        "Push the project's current files to the user's connected GitHub account. Creates the repository automatically on the first push. Use this when the user asks to push, save, publish, or commit the project to GitHub, or to open a pull request. Does not require a sandbox — it commits the stored project files. If it returns a 'not connected' error, tell the user to click the GitHub button on the project page to connect their account first. The returned link is shown to the user.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Short commit message / pull request title describing this update, e.g. 'Add checkout flow'.",
          },
          description: {
            type: "string",
            description:
              "Optional longer description of the changes for the pull request body.",
          },
          branch: {
            type: "string",
            description:
              "Branch name for this change, related to the request — lowercase words separated by hyphens, e.g. 'add-checkout-flow' or 'fix-login-redirect'. It is namespaced under 'tau/' automatically. Used when opening a new pull request (mode 'new_pr'); ignored for 'update_pr' and 'direct'. Omit to auto-generate one from the title.",
          },
          mode: {
            type: "string",
            enum: ["new_pr", "update_pr", "direct"],
            description:
              "How to push. 'new_pr' (default): a fresh branch + new pull request. 'update_pr': add the commit to the existing Tau branch and its open PR (use for follow-up pushes so PRs don't pile up). 'direct': commit straight to the default branch with no PR. Omit to use the project's configured default.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_github_issue",
      description:
        "Open a GitHub issue on the project's linked repository. Use this when the user asks to file/create an issue, or to track a bug or follow-up task you couldn't complete. The project must already be linked to a repo (push to GitHub first). Returns the issue URL, which is shown to the user.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short issue title, e.g. 'Checkout total is wrong for discounted items'.",
          },
          description: {
            type: "string",
            description:
              "Issue body in Markdown — what's wrong, steps to reproduce, or the task to do.",
          },
        },
        required: ["title"],
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
