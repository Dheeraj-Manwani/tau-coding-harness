import { SparkleParticles } from "@/src/components/ui/star-particles";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";

const STAR_COLORS = ["#fafafa", "#d4d4d8", "#a1a1aa"];

/** Stars for the home and authentication pages, with a still calm-mode fallback. */
export function AmbientStars() {
  const reduceMotion = useReduceMotion();
  if (reduceMotion) {
    return <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" style={{
      backgroundImage: "radial-gradient(1px 1px at 20% 30%, #fafafa80 0%, transparent 100%), radial-gradient(1px 1px at 75% 15%, #d4d4d860 0%, transparent 100%), radial-gradient(1px 1px at 50% 80%, #fafafa50 0%, transparent 100%)",
      backgroundSize: "300px 250px",
    }} />;
  }
  return <SparkleParticles className="fixed inset-0 -z-10" particleColor={STAR_COLORS} baseDensity={70} maxParticleSize={1.4} maxOpacity={0.7} minParticleOpacity={0.4} maxSpeed={0.5} enableShootingStars />;
}
