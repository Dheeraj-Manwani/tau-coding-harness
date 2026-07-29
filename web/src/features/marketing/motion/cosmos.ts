import { createContext, useContext, useEffect } from "react";

/**
 * The contract between the shared starfield and everything that wants to
 * influence it. Split out from `CosmosBackdrop.tsx` so that file exports only
 * components (and Fast Refresh keeps working across edits to either).
 */

// ── Imperative controls ─────────────────────────────────────────────────────

export interface CosmosControls {
  /**
   * Multiply star density. `1` is the resting field; the MAX-effort ramp uses
   * ~1.6. Animates over ~400ms rather than snapping.
   */
  setDensityBoost: (boost: number) => void;
  /** Elongate stars toward the vanishing point for `ms` total (ramp in/out included). */
  warp: (ms: number) => void;
  /** Pop particles outward from a viewport-space point. */
  burst: (x: number, y: number) => void;
}

const NOOP_CONTROLS: CosmosControls = {
  setDensityBoost: () => {},
  warp: () => {},
  burst: () => {},
};

export const CosmosContext = createContext<CosmosControls>(NOOP_CONTROLS);

/**
 * Commands the backdrop. Safe to call from anywhere inside `CosmosProvider`,
 * including before the canvas mounts and under reduced motion — in those cases
 * the calls are no-ops rather than errors, so callers never have to guard.
 */
export function useCosmos(): CosmosControls {
  return useContext(CosmosContext);
}

/**
 * Internal registration channel. The provider owns a stable control object that
 * consumers can capture in effects; the canvas plugs its live implementation in
 * when it mounts and unplugs on unmount.
 */
export const CosmosRegistryContext = createContext<{
  current: CosmosControls | null;
} | null>(null);

// ── Scene (how the sky is dressed on this surface) ──────────────────────────

/**
 * Marketing gets the full field; docs get the same sky at 40% density with
 * parallax off, because a page you are reading should not have a background
 * sliding under the text.
 *
 * This is context state rather than a `CosmosBackdrop` prop because the canvas
 * is mounted above the router outlet — the shell that knows which surface we're
 * on renders *below* it.
 */
export interface CosmosScene {
  density: number;
  parallax: boolean;
  /**
   * Occasional meteors across the upper viewport. Marketing only — a streak
   * crossing the page while someone is reading a reference table is exactly the
   * kind of thing §6 rules out.
   */
  shootingStars: boolean;
}

export const DEFAULT_SCENE: CosmosScene = {
  density: 1,
  parallax: true,
  shootingStars: true,
};

export const CosmosSceneContext = createContext<{
  scene: CosmosScene;
  setScene: (scene: CosmosScene) => void;
}>({ scene: DEFAULT_SCENE, setScene: () => {} });

/**
 * Declares the sky this surface wants. Call it from a shell; the default scene
 * is restored on unmount, so a shell never has to clean up after itself.
 */
export function useCosmosScene(scene: Partial<CosmosScene>): void {
  const { setScene } = useContext(CosmosSceneContext);
  const {
    density = DEFAULT_SCENE.density,
    parallax = DEFAULT_SCENE.parallax,
    shootingStars = DEFAULT_SCENE.shootingStars,
  } = scene;

  useEffect(() => {
    setScene({ density, parallax, shootingStars });
    return () => setScene(DEFAULT_SCENE);
  }, [setScene, density, parallax, shootingStars]);
}
