/**
 * Project page tours: what each one says, and when one should start.
 *
 * Deliberately free of any tour-library import so ProjectPage can decide
 * whether a tour is due without pulling the library into its bundle; the
 * renderer (ProjectTour.tsx) is lazy-loaded only once one is.
 *
 *   workspace: the chat side. Runs the first time the split workspace appears.
 *   preview:   the preview toolbar and shipping. Runs once there is a live
 *              preview to point at, after the workspace tour.
 */
import type {
  TourId,
  TourRecord,
} from "@/src/features/settings/preferences";
import type { Tab } from "@/src/stores/useProjectStore";

/**
 * Bump a tour's version to show it again to everyone who has seen an older
 * one: for when the UI it describes changes enough that the old tour misleads.
 */
export const TOUR_VERSIONS: Record<TourId, number> = {
  workspace: 1,
  preview: 1,
};

/** How each tour is offered for replay (avatar menu, Settings). */
export const TOUR_INFO: Record<
  TourId,
  { label: string; short: string; summary: string }
> = {
  workspace: {
    label: "Workspace tour",
    short: "Workspace",
    summary: "Chat, effort and layout",
  },
  preview: {
    label: "Preview tour",
    short: "Preview",
    summary: "Browse, edit and ship",
  },
};

export const TOUR_IDS: TourId[] = ["workspace", "preview"];

export type TourPosition = "top" | "bottom" | "left" | "right" | "center";

export interface TourStepDef {
  /** Matches a `data-tour="..."` attribute on the element to highlight. */
  target: string;
  title: string;
  body: string;
  position?: TourPosition;
}

export const TOURS: Record<TourId, TourStepDef[]> = {
  workspace: [
    {
      target: "chat-thread",
      title: "Your conversation with tau",
      body: "Everything tau builds, and why, shows up here as it works. Scroll back anytime to see what changed.",
      position: "right",
    },
    {
      target: "composer",
      title: "Ask for changes",
      body: "Describe what you want in plain words. Drop in screenshots or files to show tau exactly what you mean.",
      position: "right",
    },
    {
      target: "effort",
      title: "Pick the effort",
      body: "Low is quick for small tweaks. High and Max think longer for bigger features and tricky bugs, and use more credits.",
      position: "top",
    },
    {
      target: "project-switcher",
      title: "Switch projects",
      body: "Jump to another project, or manage this one.",
      position: "bottom",
    },
    {
      target: "view-tabs",
      title: "Preview and code",
      body: "Flip between your live app and its source. You can edit files directly in Code.",
      position: "bottom",
    },
    {
      target: "collapse-chat",
      title: "Make room",
      body: "Collapse the chat to give your app the whole screen. Bring it back from the top-left corner.",
      position: "bottom",
    },
  ],
  preview: [
    {
      target: "url-bar",
      title: "Browse your app",
      body: "Type a path to jump to any page. Reload, or open the preview in its own tab.",
      position: "bottom",
    },
    {
      target: "select-element",
      title: "Point at anything",
      body: "Turn this on, then click any element in the preview to ask tau about it or tweak its style.",
      position: "bottom",
    },
    {
      target: "theme-editor",
      title: "Restyle everything at once",
      body: "Edit your app's theme in one place. Every element that uses it updates together.",
      position: "bottom",
    },
    {
      target: "device-switcher",
      title: "Check every screen size",
      body: "See how your app looks on mobile, tablet and desktop.",
      position: "bottom",
    },
    {
      target: "ship",
      title: "Ship it",
      body: "Push the code to GitHub, or deploy your app to a live URL.",
      position: "bottom",
    },
    {
      target: "account-menu",
      title: "You're all set",
      body: "Credits and settings live here. You can replay these tours anytime from Settings.",
      position: "bottom",
    },
  ],
};

export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`;
}

/**
 * Steps whose target is on screen right now. Some controls only exist in some
 * states (the element picker needs the in-preview runtime, a collapsed chat has
 * zero width), and a step pointing at nothing is worse than no step.
 */
export function availableSteps(
  id: TourId,
  root: ParentNode = document,
): TourStepDef[] {
  return TOURS[id].filter((step) => {
    const el = root.querySelector(tourSelector(step.target));
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export function isTourDue(id: TourId, record: TourRecord | undefined): boolean {
  return !record || record.version < TOUR_VERSIONS[id];
}

export interface TourGate {
  /** A replay the user asked for from Settings. */
  request: TourId | null;
  /** Viewport is wide enough for the workspace; tours skip small screens. */
  wide: boolean;
  layout: "loading" | "chat" | "workspace";
  hasSeenMotionIntro: boolean;
  tours: Partial<Record<TourId, TourRecord>>;
  /** Something needs the user's attention first (agent question, open panel). */
  blocked: boolean;
  isChatOpen: boolean;
  activeTab: Tab;
  /** A preview is loaded and its toolbar has settled. */
  previewReady: boolean;
}

/**
 * Which tour, if any, should start now. Pure, so every rule is testable.
 *
 * First runs wait for the full workspace, for the motion intro to be out of
 * the way (two popovers at once is noise), and for nothing to be asking the
 * user for attention. The preview tour always follows the workspace tour.
 */
export function pickTour(gate: TourGate): TourId | null {
  if (!gate.wide || gate.layout === "loading") return null;
  if (gate.request) return gate.request;

  if (gate.layout !== "workspace") return null;
  if (!gate.hasSeenMotionIntro || gate.blocked) return null;

  if (isTourDue("workspace", gate.tours.workspace)) {
    return gate.isChatOpen ? "workspace" : null;
  }
  if (
    isTourDue("preview", gate.tours.preview) &&
    gate.activeTab === "preview" &&
    gate.previewReady
  ) {
    return "preview";
  }
  return null;
}
