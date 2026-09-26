import { cn } from "@/src/lib/utils";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";

const MAX_SHIMMER_GRADIENT =
  "linear-gradient(105deg, #3b82f6 0%, #3b82f6 30%, #93c5fd 48%, #ffffff 52%, #93c5fd 56%, #3b82f6 70%, #3b82f6 100%)";

export function MaxShimmerLabel({ className }: { className?: string }) {
  const reduceMotion = useReduceMotion();

  // Reduced motion: static label, no shimmer sweep.
  if (reduceMotion) {
    return <span className={cn("text-brand-light", className)}>Max</span>;
  }

  return (
    <>
      <style>{`
        @keyframes effort-max-shimmer {
          0%   { background-position: -250% center; }
          100% { background-position:  250% center; }
        }
      `}</style>
      <span
        className={cn("bg-clip-text text-transparent", className)}
        style={{
          backgroundImage: MAX_SHIMMER_GRADIENT,
          backgroundSize: "250% 100%",
          animation: "effort-max-shimmer 2.5s linear infinite",
        }}
      >
        Max
      </span>
    </>
  );
}
