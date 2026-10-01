import { useEffect, useRef } from "react";
import { Confetti, type ConfettiRef } from "./ui/confetti";
import { SUCCESS_CELEBRATION_EVENT } from "@/src/lib/confetti";
import { useSettings } from "@/src/hooks/useSettings";

export function SuccessCelebration() {
  const ref = useRef<ConfettiRef>(null);
  const { reduceMotion } = useSettings();
  useEffect(() => {
    const celebrate = () => {
      if (reduceMotion) return;
      for (const x of [0.15, 0.85]) {
        void ref.current?.fire({ particleCount: 110, spread: 85, startVelocity: 55, ticks: 260, scalar: 1.2, angle: x < 0.5 ? 60 : 120, origin: { x, y: 0.7 } });
      }
    };
    window.addEventListener(SUCCESS_CELEBRATION_EVENT, celebrate);
    return () => window.removeEventListener(SUCCESS_CELEBRATION_EVENT, celebrate);
  }, [reduceMotion]);
  return <Confetti ref={ref} manualstart aria-hidden="true" className="pointer-events-none fixed inset-0 z-[2147483647] size-full" />;
}
