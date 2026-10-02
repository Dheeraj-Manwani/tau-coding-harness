import { Outlet } from "react-router-dom";

import {
  CosmosProvider,
} from "@/src/features/marketing/motion/CosmosBackdrop";

/** Keeps illustration controls available while public pages use a plain background. */
export function CosmosRoot() {
  return (
    <CosmosProvider>
      <Outlet />
    </CosmosProvider>
  );
}

export default CosmosRoot;
