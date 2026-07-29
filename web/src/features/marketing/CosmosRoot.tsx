import { Outlet } from "react-router-dom";

import {
  CosmosBackdrop,
  CosmosProvider,
} from "@/src/features/marketing/motion/CosmosBackdrop";

/**
 * The layout route every public surface nests under.
 *
 * Its whole job is to mount the starfield exactly once. If `MarketingShell` and
 * `DocsShell` each mounted their own, clicking "Docs" would reseed the canvas
 * and the entire sky would jump — the one thing a shared background must never
 * do. Mounted here, the shells only *describe* the sky they want (via
 * `useCosmosScene`) and the same stars carry across the navigation.
 *
 * Deliberately not mounted above `/app`: the builder already ships its own
 * `SparkleParticles` field, and stacking a second canvas behind it would be
 * both visual noise and a frame-budget regression in the product. Marketing and
 * docs are the surfaces that share this sky.
 */
export function CosmosRoot() {
  return (
    <CosmosProvider>
      <CosmosBackdrop />
      <Outlet />
    </CosmosProvider>
  );
}

export default CosmosRoot;
