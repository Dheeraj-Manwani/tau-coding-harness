"use client";

import { createContext, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import confetti, { type GlobalOptions, type CreateTypes, type Options } from "canvas-confetti";
import { Button } from "@/src/components/ui/button";

export type ConfettiRef = { fire: (options?: Options) => Promise<void> | void };
type Props = ComponentPropsWithoutRef<"canvas"> & {
  options?: Options;
  globalOptions?: GlobalOptions;
  manualstart?: boolean;
  children?: ReactNode;
};
const ConfettiContext = createContext<ConfettiRef | null>(null);

export const Confetti = forwardRef<ConfettiRef, Props>(({ options, globalOptions, manualstart = false, children, ...props }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<CreateTypes | null>(null);
  const optionsRef = useRef(options);
  const globalOptionsRef = useRef(globalOptions);
  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { globalOptionsRef.current = globalOptions; }, [globalOptions]);
  useEffect(() => {
    if (canvasRef.current && !instanceRef.current) {
      instanceRef.current = confetti.create(canvasRef.current, { resize: true, useWorker: true, ...globalOptionsRef.current });
    }
    return () => { instanceRef.current?.reset(); instanceRef.current = null; };
  }, []);
  const fire = useCallback(async (opts: Options = {}) => {
    await instanceRef.current?.({ disableForReducedMotion: true, ...optionsRef.current, ...opts });
  }, []);
  const api = useMemo<ConfettiRef>(() => ({ fire }), [fire]);
  useImperativeHandle(ref, () => api, [api]);
  useEffect(() => { if (!manualstart) void fire(); }, [manualstart, fire]);
  return <ConfettiContext.Provider value={api}><canvas ref={canvasRef} {...props} />{children}</ConfettiContext.Provider>;
});
Confetti.displayName = "Confetti";

export interface ConfettiButtonProps extends ComponentPropsWithoutRef<typeof Button> {
  options?: Options & GlobalOptions & { canvas?: HTMLCanvasElement };
}
export const ConfettiButton = forwardRef<HTMLButtonElement, ConfettiButtonProps>(({ options, children, onClick, ...props }, ref) => (
  <Button ref={ref} type="button" {...props} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const rect = event.currentTarget.getBoundingClientRect();
    void confetti({ zIndex: 9999, disableForReducedMotion: true, ...options, origin: { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight } });
  }}>{children}</Button>
));
ConfettiButton.displayName = "ConfettiButton";
