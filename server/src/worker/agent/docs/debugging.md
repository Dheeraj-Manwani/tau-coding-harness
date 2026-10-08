# Debugging a broken preview

The page answers `200` to `curl` whether or not the app in it works: it is an empty shell, and what appears in it is decided afterwards by JavaScript in a browser. So a type check and a `curl` can both pass on an app that shows the user nothing. `inspect_preview` is how you find out what the browser saw.

## Order to look in

1. **`inspect_preview` on the route that is wrong.** Read `status` first, then the lists.
2. **Type-check** (`bunx tsc -b`) when the status is `build_error` and the message does not name the cause.
3. **The server's log**, `.tau/logs/server.log`, when a request to `/api/...` failed and its `body` does not say why.
4. **The code**, last, and only the files the steps above named.

Fix one cause, then inspect again. Do not change several things between inspections: you will not know which one mattered.

## What each status means

- **`build_error`** — the dev server could not compile a file. `buildError` has its message, the file and the lines around the fault. Nothing else in the result matters until this is fixed. Usual causes: a syntax error, an import of a file or a package that is not there, an export that the file does not have.
- **`crashed`** — the code compiled and then threw while starting, so nothing was drawn. The first entry in `exceptions` is the cause; `at` is the file. Later entries are often the same fault seen again.
- **`blank`** — nothing was drawn and nothing was thrown. Look at what decides whether anything is drawn (below).
- **`rendered_with_errors`** — the screen is there, and something failed while it loaded. A failed `/api` request carries the server's answer in `body`. A `404` for a file under `public/` means the path is wrong or the file was never saved.
- **`unreachable`** — the page did not load at all. This is the dev server or the sandbox, not the app's code. Do not restart the dev server; check it answers with `curl`, and say so if it does not.
- **`rendered`** — the app loaded cleanly. If the user still reports a fault, it happens after something they did: inspect again with `steps` that do it.

## `crashed`, when the stack names no file of the app's

- **"Cannot read properties of undefined"** in the first render: data that has not arrived yet is being read as if it had. Give it a starting value, or render a loading state until it is there.
- **"X is not a function" / "does not provide an export named X"**: the installed version of a package does not have what was imported. Read the package's own `package.json` and exports before changing the import.
- **"Invalid hook call" or "Rendered more hooks than during the previous render"**: a hook is called inside a condition, a loop or after an early return.
- **"useX must be used within a Provider"**: a component is rendered outside the provider it needs. The providers are in `src/main.tsx`.
- **"Objects are not valid as a React child"**: an object or a Date is being put straight into the markup.
- **`process is not defined`**: frontend code reads `process.env`. In the browser it is `import.meta.env`, and only names starting `VITE_` exist there. A key never belongs in frontend code.

## `blank`, with nothing thrown

- The route: is there a `<Route>` for this path in `src/App.tsx`, above the catch-all?
- A component that returns `null` or an empty fragment: a condition that is never true, a list that is empty with no empty state.
- A screen that waits on a request and draws nothing until it answers: check `network` for a request that never finished, and give the screen a loading state.
- Everything drawn the same colour as the page: text in the background colour, a container with no height.

## Reaching a fault that needs a click

`steps` does things to the page before it is read: `{ "click": "Sign in" }`, `{ "fill": "Email", "with": "a@b.co" }`. Buttons are found by what they say, fields by their label or placeholder. A step that could not be done is listed in `stepsFailed`, and the result then describes the page as it loaded.

## Limits

- A run has a limited number of inspections, so do not use one to confirm what a type check already told you.
- Positions in a stack are in the file as the dev server compiled it. The file is right; the line can be a few off.
- It reports what happened, not how the screen looks. For that there is `dispatch_design_reviewer`.
