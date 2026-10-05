import { Link, useLocation, useOutlet } from "react-router-dom";

import { UserMenu } from "@/src/components/UserMenu";
import { OutOfCreditsModal } from "@/src/features/billing/OutOfCreditsModal";
import { UpgradeModal } from "@/src/features/billing/UpgradeModal";
import { SettingsModal } from "@/src/features/settings/SettingsModal";
import { MotionIntroDialog } from "@/src/features/settings/MotionIntroDialog";
import { FeedbackModal } from "@/src/features/feedback/FeedbackModal";
import { SupportTauModal } from "@/src/features/support/SupportTauModal";
import { SiteFooter } from "@/src/components/SiteFooter";
import { APP_BILLING, APP_HOME } from "@/src/lib/routes";
import { cn } from "@/src/lib/utils";

/**
 * The authenticated product shell on app.tauai.pro. Extracted from the
 * former `App.tsx` when the router grew a public half; `MarketingShell` and
 * `DocsShell` are its siblings.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  // The project editor is a full-screen workspace: it hides the app navbar.
  const isProject = pathname.startsWith("/project/");
  const isHome = pathname === APP_HOME;
  // The buy-credits flow is a focused purchase decision - the watermark is a
  // flourish for pages someone lingers on, not one mid-checkout.
  const isBilling = pathname === APP_BILLING;

  return (
    <div className="flex h-[100svh] flex-col">
      {!isProject && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-50">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <Link
              to={APP_HOME}
              aria-label="tau home"
              className="pointer-events-auto flex items-center gap-2"
            >
              <span
                className={cn("logo-mark size-6", isHome && "logo-mark--white")}
                role="img"
                aria-label="tau"
              />
              {/* <span className="display-heading text-base text-silver-900">
                Tau
              </span> */}
            </Link>
            <div className="pointer-events-auto flex items-center gap-3">
              <UserMenu />
            </div>
          </div>
        </header>
      )}

      <main className="min-h-0 flex-1 overflow-auto">{outlet}</main>
      {!isProject && !isHome && <SiteFooter watermark={!isBilling} />}
      <OutOfCreditsModal />
      <UpgradeModal />
      <SettingsModal />
      <MotionIntroDialog />
      <FeedbackModal />
      <SupportTauModal />
    </div>
  );
}

export default AppShell;
