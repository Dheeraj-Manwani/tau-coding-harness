/**
 * A published app's own log lines, made safe to show (doc/PUBLISHING.md C14).
 *
 * The owner's app wrote them, so they can hold anything it printed: its stored
 * secrets, tau's gateway key, and the database connection string. All three are
 * masked before the text leaves the server, whether it goes to the Publish panel
 * or into a build log that "Fix with tau" reads.
 */
import { redactToolResult } from "@/worker/lib/redact";

const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"'<>]+/gi;

/** Masks connection strings by pattern. The secrets and gateway key are handled by {@link redactAppLogs}. */
export function maskConnectionStrings(text: string): string {
  return text.replace(DATABASE_URL_PATTERN, "postgres://***redacted***");
}

export async function redactAppLogs(projectId: string, text: string): Promise<string> {
  return maskConnectionStrings(await redactToolResult(projectId, text));
}
