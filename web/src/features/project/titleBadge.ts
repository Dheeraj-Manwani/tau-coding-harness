import { isUserAttentive } from "@/src/features/project/readyNotificationRouting";

/**
 * A "while you were away" marker in the tab title: `● Todo app is ready`.
 *
 * Survives the user being elsewhere (unlike a toast, which times out unseen)
 * and clears itself the moment they look at the tab again.
 */
let originalTitle: string | null = null;
let detach: (() => void) | null = null;

export function clearTitleBadge(): void {
  detach?.();
  detach = null;
  if (originalTitle !== null) {
    document.title = originalTitle;
    originalTitle = null;
  }
}

export function showTitleBadge(text: string): void {
  if (typeof document === "undefined") return;
  if (originalTitle === null) originalTitle = document.title;
  document.title = `● ${text}`;

  if (detach) return;
  const onReturn = () => {
    if (isUserAttentive()) clearTitleBadge();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  detach = () => {
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}
