import { render } from "ink";
import { App, type BaseConfig } from "./app.tsx";

/**
 * Launch the full-screen tau TUI for an interactive session and resolve when
 * the user exits (Ctrl+C, `/exit`). `base` carries the resolved provider,
 * credential, model, mode, and cwd; the App attaches the reporter + interaction
 * UI itself. Caller must ensure stdin/stdout are TTYs.
 */
export async function launchTui(
  base: BaseConfig,
  initialPrompt?: string,
): Promise<void> {
  // exitOnCtrlC:false lets the App handle Ctrl+C itself, so it can tear down the
  // live region (input box + thinking line) before unmounting — see App's exit.
  const { waitUntilExit } = render(
    <App base={base} initialPrompt={initialPrompt} />,
    { exitOnCtrlC: false },
  );
  await waitUntilExit();
}
