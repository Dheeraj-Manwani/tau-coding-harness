import { useEffect, useState } from "react";

import { cn } from "@/src/lib/utils";

/**
 * A 4px vertical drag handle, à la VS Code's sidebar splitter. While dragging it
 * reports the pointer's clientX to the parent on every mouse move; the parent
 * converts that into a clamped panel width. Brightens to --blue-500 on hover/drag.
 */
export function ResizeHandle({
  onDrag,
  onDragStart,
  onDragEnd,
  danger = false,
  className,
}: {
  onDrag: (clientX: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** When true, colors the handle red to signal that releasing will close the panel. */
  danger?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const move = (e: MouseEvent) => onDrag(e.clientX);
    const up = () => {
      setActive(false);
      onDragEnd?.();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    // Lock the cursor / prevent text selection while dragging.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [active, onDrag, onDragEnd]);

  return (
    <div className={cn("group relative w-px shrink-0", className)}>
      {/* Hairline divider, brightens on hover/drag; turns red in snap-close zone. */}
      <div
        className={cn(
          "absolute inset-0 transition-colors",
          danger
            ? "bg-red-500"
            : active
              ? "bg-[var(--blue-500)]"
              : "bg-[var(--silver-200)] group-hover:bg-[var(--blue-500)]",
        )}
      />
      {/* Wide, invisible grab zone centered over the line for easy dragging. */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={() => {
          setActive(true);
          onDragStart?.();
        }}
        className="absolute inset-y-0 left-1/2 z-10 w-3 -translate-x-1/2 cursor-col-resize"
      />
    </div>
  );
}
