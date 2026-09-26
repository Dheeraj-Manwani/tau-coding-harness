/**
 * The six things the workspace gives you that a black box would not (§4.6).
 *
 * Each is checked against the truth table in §9: all six are shipped today.
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
    title: "See the work unfold",
    copy: "Follow along as Tau thinks, makes changes, and moves through the plan. Leave and come back whenever you like. Your place is saved.",
    x: 14,
    y: 30,
  },
  {
    n: 2,
    title: "All your files",
    copy: "See every file Tau creates or changes, right as it happens.",
    x: 40,
    y: 14,
  },
  {
    n: 3,
    title: "Edit anything yourself",
    copy: "Open any file and make your own changes. They save automatically, and Tau works with them instead of writing over them.",
    x: 44,
    y: 66,
  },
  {
    n: 4,
    title: "Live preview",
    copy: "Try your app as Tau builds it. If the preview stops, one click brings it back.",
    x: 80,
    y: 34,
  },
  {
    n: 5,
    title: "Keep the conversation going",
    copy: "Ask for any change in your own words. You can stop Tau at any time, and you only pay for work it completed.",
    x: 16,
    y: 78,
  },
  {
    // Ask-user is a chat behaviour, so its pin belongs over the chat panel -
    // not, as it first sat, over the preview.
    n: 6,
    title: "No mystery guesses",
    copy: "When Tau needs your call, it pauses and asks you.",
    x: 24,
    y: 56,
  },
];
