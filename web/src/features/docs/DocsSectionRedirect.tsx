import { Navigate, useParams } from "react-router-dom";

import { DocsNotFound } from "./DocsNotFound";
import { findSection } from "./navTree";

/**
 * `/docs/:section` → the section's first page (§3).
 *
 * A section is a grouping, not a page, so there is nothing to render at its own
 * address. Sending the visitor to the first page is more useful than a table of
 * contents they would immediately click through.
 */
export function DocsSectionRedirect() {
  const { section = "" } = useParams();
  const found = findSection(section);
  const first = found?.pages[0];

  if (!first) return <DocsNotFound />;
  return <Navigate to={first.path} replace />;
}

export default DocsSectionRedirect;
