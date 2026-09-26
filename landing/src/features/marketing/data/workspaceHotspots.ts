/**
 * The six things the workspace gives you that a black box would not (§4.6).
 *
 * Each is checked against the truth table in §9 — all six are shipped today.
 * `x`/`y` are percentages of the mock, so the pins ride the layout at any size.
 */

export interface Hotspot {
  n: number;
  title: string;
  copy: string;
  /** Percent across the mock. */
  x: number;
  /** Percent down the mock. */
  y: number;
}

export const HOTSPOTS: Hotspot[] = [
  {
    n: 1,
    title: "Live chat stream",
    copy: "Tokens, tool calls, and file writes stream over SSE as they happen. Reload the page mid-build — it resumes exactly where it was.",
    x: 14,
    y: 30,
  },
  {
    n: 2,
    title: "Real file tree",
    copy: "Every file the agent creates or edits, as it lands.",
    x: 40,
    y: 14,
  },
  {
    n: 3,
    title: "A real editor",
    copy: "CodeMirror 6. Type in it. ⌘S, blur, or 2s idle autosaves to the sandbox and to storage — and the agent is told what you changed, so your edit survives its next turn.",
    x: 44,
    y: 66,
  },
  {
    n: 4,
    title: "Live preview",
    copy: "Your app running on a real URL. Restart it any time with Start preview.",
    x: 80,
    y: 34,
  },
  {
    n: 5,
    title: "Follow-ups & cancel",
    copy: "Keep talking to change anything. Hit cancel and it stops mid-turn — you're not charged for work that didn't happen.",
    x: 16,
    y: 78,
  },
  {
    // Ask-user is a chat behaviour, so its pin belongs over the chat panel —
    // not, as it first sat, over the preview.
    n: 6,
    title: "Ask-user",
    copy: "When the agent needs a decision it stops and asks, instead of guessing.",
    x: 24,
    y: 56,
  },
];
