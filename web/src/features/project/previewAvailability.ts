export type PreviewSurface = "frame" | "empty" | "checking" | "stopped" | "restoring" | "failed";

/** A chat starting is not evidence that its persisted preview URL is alive. */
export function resolvePreviewSurface(input: {
  hasUrl: boolean;
  alive: boolean | undefined;
  streaming: boolean;
  restoring: boolean;
  restoreFailed: boolean;
  starting: boolean;
  checkFailed: boolean;
}): PreviewSurface {
  if (input.restoring || input.starting) return "restoring";
  if (input.restoreFailed) return "failed";
  if (!input.hasUrl) return "empty";
  if (input.alive === false) return input.streaming ? "restoring" : "stopped";
  if (input.alive === undefined) return input.checkFailed ? "failed" : "checking";
  return "frame";
}
