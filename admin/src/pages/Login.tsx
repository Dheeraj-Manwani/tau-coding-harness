import { GOOGLE_SIGN_IN_URL } from "@/lib/api";
import { CriticalIcon, WarnIcon } from "@/components/icons";

const MESSAGES = {
  not_admin: { tone: "critical", text: "That Google account isn't an admin on tau." },
  revoked: { tone: "critical", text: "This account no longer has admin access." },
  expired: { tone: "warning", text: "Your session expired. Sign in again." },
  unreachable: { tone: "warning", text: "Can't reach the API. Check that the server is up." },
} as const;

/**
 * Google is the only way in. The link sends the browser through the server's
 * `/auth/google?client=admin`, which checks the ADMIN role, sets the
 * `/admin`-scoped cookie and lands back here — this page never touches a
 * credential.
 */
export default function Login({ reason }: { reason?: keyof typeof MESSAGES }) {
  // The server reports a non-admin via `?error=not_admin` on the way back.
  const fromUrl = new URLSearchParams(window.location.search).get("error");
  const key = fromUrl === "not_admin" ? "not_admin" : reason;
  const message = key ? MESSAGES[key] : undefined;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-lg font-bold text-white">τ</span>
          <div>
            <h1 className="text-base font-semibold tracking-tight">tau ops</h1>
            <p className="text-xs text-fg-3">Production console</p>
          </div>
        </div>

        {message && (
          <div
            role="alert"
            className={`mt-6 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
              message.tone === "critical" ? "bg-critical/10 text-critical-text" : "bg-warning/15 text-warning-text"
            }`}
          >
            {message.tone === "critical" ? (
              <CriticalIcon className="mt-0.5 size-4 shrink-0" />
            ) : (
              <WarnIcon className="mt-0.5 size-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <a
          href={GOOGLE_SIGN_IN_URL}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg transition hover:border-fg-3"
        >
          <GoogleMark />
          Sign in with Google
        </a>
        <p className="mt-4 text-xs leading-relaxed text-fg-3">
          Admin accounts only. The session lasts 8 hours and covers this console alone. It doesn't sign you in
          to the tau app.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
