import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The one animation loop marketing and docs are allowed to use.
 *
 * Every decorative rAF loop on a public page has to stop when nobody is looking
 * at it, or a backgrounded tab quietly burns a laptop battery. Rather than
 * trusting each component to remember `visibilitychange`, that gating lives
 * here: the loop is bound to `active`, and it additionally suspends itself
 * whenever the document is hidden.
 *
 * Off-screen gating is the caller's half of the deal: pass `useIsVisible(ref)`
 * (below) into `active` for anything that isn't full-viewport.
 *
 * `callback` may change every render; only `active` restarts the loop.
 */
export function useRafLoop(
  callback: (deltaMs: number, now: number) => void,
  active: boolean,
): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!active) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = now - last;
      last = now;
      callbackRef.current(delta, now);
    };

    const start = () => {
      if (frame) return;
      // Reset the clock so the first frame after a resume doesn't report the
      // entire time the tab spent hidden as one enormous delta.
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibilityChange = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);
}

/**
 * Is this element anywhere near the viewport? Feed the result into
 * `useRafLoop`'s `active` so a section's animation costs nothing while it is
 * scrolled away. `rootMargin` starts the loop slightly before the element
 * arrives so the first visible frame is already settled.
 */
export function useIsVisible(
  ref: RefObject<Element | null>,
  rootMargin = "200px",
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return visible;
}
