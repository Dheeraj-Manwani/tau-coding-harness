import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import BuyMeCoffee from "@/src/components/ui/buy-me-coffee";
import { XIcon } from "lucide-react";

function wasDismissed(key: string) {
  try { return localStorage.getItem(key) === "dismissed"; } catch { return false; }
}

function wasShown(key: string) {
  try {
    return sessionStorage.getItem(key) === "shown";
  } catch {
    return false;
  }
}

/** A dismissible support link, shown after the project's preview is ready. */
export function PreviewCoffee({ projectId, ready }: { projectId: string; ready: boolean }) {
  const storageKey = `tau:preview-coffee:${projectId}`;
  const dismissKey = `${storageKey}:dismissed`;
  const [dismissed, setDismissed] = useState(() => wasDismissed(dismissKey));
  const [shown, setShown] = useState(() => wasShown(storageKey));

  useEffect(() => {
    if (!ready || shown || dismissed) return;
    const timer = setTimeout(() => {
      setShown(true);
      try {
        sessionStorage.setItem(storageKey, "shown");
      } catch {
        // The in-memory state still prevents repeat prompts without storage.
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, shown, storageKey, dismissed]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(dismissKey, "dismissed"); } catch { /* Keep the in-memory dismissal. */ }
  };

  return (
    <>
      {shown && !dismissed && createPortal(
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40">
        <BuyMeCoffee
          classname="m-0 size-14 rounded-full bg-[#FFDD06] p-2 sm:p-2 lg:p-2 shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&>svg]:hidden motion-reduce:[&_*]:transition-none"
          iconClassName="h-10 w-9 border-0 bg-transparent p-0 group-hover:scale-100 group-hover:translate-y-0"
        />
        <button type="button" onClick={dismiss} aria-label="Dismiss coffee reminder" title="Dismiss coffee reminder" className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border bg-background text-foreground shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <XIcon className="size-3.5" />
        </button>
        </div>,
        document.body,
      )}
    </>
  );
}
