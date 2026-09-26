import { useEffect } from "react";

/**
 * Binds ⌘K / Ctrl-K to open the docs search.
 *
 * Lives apart from `DocsSearch` so that file exports only components and Fast
 * Refresh keeps working when either changes.
 */
export function useDocsSearchHotkey(open: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
}
