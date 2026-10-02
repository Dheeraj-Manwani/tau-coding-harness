import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, CriticalIcon, InfoIcon, RefreshIcon, WarnIcon } from "./icons";
import { time } from "@/lib/format";

// ── tone ─────────────────────────────────────────────────────────────────────

/**
 * State, not identity. Each tone is a reserved status colour that always
 * travels with its icon and a text label — colour never carries meaning alone.
 */
export type Tone = "good" | "warning" | "critical" | "info" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-good-text",
  warning: "text-warning-text",
  critical: "text-critical-text",
  info: "text-accent",
  neutral: "text-fg-2",
};

const TONE_CHIP: Record<Tone, string> = {
  good: "bg-good/12 text-good-text ring-good/30",
  warning: "bg-warning/15 text-warning-text ring-warning/40",
  critical: "bg-critical/12 text-critical-text ring-critical/35",
  info: "bg-accent-soft text-accent ring-accent/30",
  neutral: "bg-surface-2 text-fg-2 ring-line",
};

export function ToneIcon({ tone, className = "size-4 shrink-0" }: { tone: Tone; className?: string }) {
  if (tone === "good") return <CheckIcon className={className} />;
  if (tone === "warning") return <WarnIcon className={className} />;
  if (tone === "critical") return <CriticalIcon className={className} />;
  if (tone === "info") return <InfoIcon className={className} />;
  return null;
}

export function Badge({ tone = "neutral", children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CHIP[tone]}`}
    >
      {icon && <ToneIcon tone={tone} className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}

const JOB_TONE: Record<string, Tone> = {
  COMPLETED: "good",
  RUNNING: "info",
  QUEUED: "warning",
  FAILED: "critical",
  CANCELLED: "neutral",
};

export function JobStatusBadge({ status, stuck = false }: { status: string; stuck?: boolean }) {
  if (stuck) return <Badge tone="critical">Stuck</Badge>;
  return <Badge tone={JOB_TONE[status] ?? "neutral"}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

// ── layout ───────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  fetchedAt,
  loading,
  onRefresh,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  fetchedAt?: Date;
  loading?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-2">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {fetchedAt && <span className="text-xs text-fg-3">Loaded {time(fetchedAt)}</span>}
        {onRefresh && (
          <Button onClick={onRefresh} disabled={loading} aria-label="Refresh">
            <RefreshIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 mb-8 min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-xl border border-line bg-surface ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="text-xs font-medium text-fg-2">{title}</div>
          {action}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </div>
  );
}

// ── figures ──────────────────────────────────────────────────────────────────

/** Label · value · optional sub-line. A tone adds its icon and colours the value. */
export function Stat({
  label,
  value,
  sub,
  tone,
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-fg-2">
        {tone && tone !== "neutral" && <ToneIcon tone={tone} className={`size-3.5 ${TONE_TEXT[tone]}`} />}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tracking-tight ${tone ? TONE_TEXT[tone] : "text-fg"}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-fg-3">{sub}</div>}
    </>
  );
  const cls = "block min-w-0 rounded-xl border border-line bg-surface px-4 py-3";
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-accent/50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{children}</div>;
}

/**
 * A ratio against a limit. The fill carries severity (accent → warning →
 * critical); the track is a light step of the accent ramp so the bar reads as
 * one object at every fill level.
 */
export function Meter({
  label,
  ratio,
  detail,
  warnAt = 0.75,
  criticalAt = 0.9,
}: {
  label: string;
  ratio: number | null;
  detail?: ReactNode;
  warnAt?: number;
  criticalAt?: number;
}) {
  const r = ratio === null ? 0 : Math.min(1, Math.max(0, ratio));
  const tone: Tone = ratio === null ? "neutral" : r >= criticalAt ? "critical" : r >= warnAt ? "warning" : "info";
  const fill = tone === "critical" ? "bg-critical" : tone === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-fg-2">
          {(tone === "warning" || tone === "critical") && <ToneIcon tone={tone} className={`size-3.5 ${TONE_TEXT[tone]}`} />}
          {label}
        </span>
        <span className="num text-fg">{ratio === null ? "—" : `${Math.round(r * 100)}%`}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-accent-soft"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(r * 100)}
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${r * 100}%` }} />
      </div>
      {detail && <div className="mt-1 text-xs text-fg-3">{detail}</div>}
    </div>
  );
}

/** Two-column key/value list: `<KV><Row k="Plan">Pro</Row>…</KV>`. */
export function KV({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">{children}</dl>;
}

export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-3">{k}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </>
  );
}

// ── tables ───────────────────────────────────────────────────────────────────

export function Table({ head, children, empty = "Nothing here." }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2/60">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-xs font-medium whitespace-nowrap text-fg-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr:hover]:bg-surface-2/50">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-sm text-fg-3">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "", mono = false, num = false }: { children?: ReactNode; className?: string; mono?: boolean; num?: boolean }) {
  return (
    <td className={`px-3 py-2 align-top ${mono ? "font-mono text-xs" : ""} ${num ? "num text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}

export function IdLink({ to, id, length = 8 }: { to: string; id: string; length?: number }) {
  return (
    <Link to={to} className="font-mono text-xs text-accent hover:underline" title={id}>
      {id.slice(0, length)}
    </Link>
  );
}

// ── states ───────────────────────────────────────────────────────────────────

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-fg-3" role="status">
      <RefreshIcon className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-critical/40 bg-critical/8 px-4 py-3 text-sm" role="alert">
      <CriticalIcon className="size-4 text-critical-text" />
      <span className="min-w-0 flex-1 text-fg">{message}</span>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-3">{children}</p>;
}

/** Collapsible pretty-printed JSON — for payloads no table can do justice to. */
export function JsonBlock({ value, summary = "Raw JSON", open = false }: { value: unknown; summary?: string; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-line bg-surface-2/50">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-fg-2 hover:text-fg">{summary}</summary>
      <pre className="max-h-96 overflow-auto border-t border-line px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-fg-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

// ── controls ─────────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" };

export function Button({ variant = "default", className = "", ...props }: ButtonProps) {
  const styles = {
    default: "border-line bg-surface text-fg hover:border-fg-3",
    primary: "border-accent bg-accent text-white hover:opacity-90",
    danger: "border-critical/50 bg-surface text-critical-text hover:bg-critical/10",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none";

/**
 * A destructive action behind a dialog. With `typeToConfirm`, the operator has
 * to type the value (e.g. the first 8 chars of an id) — slows the 3 a.m. click.
 * `onConfirm` returns a line to show on success; a throw is shown as the error.
 */
export function ConfirmButton({
  label,
  title,
  description,
  typeToConfirm,
  variant = "danger",
  onConfirm,
  onDone,
}: {
  label: string;
  title: string;
  description: ReactNode;
  typeToConfirm?: string;
  variant?: "danger" | "default" | "primary";
  onConfirm: () => Promise<string | void>;
  onDone?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();

  const open = () => {
    setTyped("");
    setResult(undefined);
    ref.current?.showModal();
  };
  // `onDone` fires from the dialog's own close event, so Escape counts too.
  const close = () => ref.current?.close();
  const run = async () => {
    setBusy(true);
    try {
      const text = await onConfirm();
      setResult({ ok: true, text: text || "Done." });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  const armed = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <>
      <Button variant={variant} onClick={open} className="px-2 py-1 text-xs">
        {label}
      </Button>
      <dialog
        ref={ref}
        onClose={() => result?.ok && onDone?.()}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl"
      >
        <div className="p-5">
          <h3 className="text-base font-semibold">{title}</h3>
          <div className="mt-2 text-sm text-fg-2">{description}</div>
          {typeToConfirm && !result?.ok && (
            <label className="mt-4 block text-xs text-fg-2">
              Type <code className="rounded bg-surface-2 px-1 font-mono text-fg">{typeToConfirm}</code> to confirm
              <input
                className={`${inputClass} mt-1.5 w-full font-mono`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                spellCheck={false}
              />
            </label>
          )}
          {result && (
            <div className={`mt-4 flex items-start gap-2 text-sm ${result.ok ? "text-good-text" : "text-critical-text"}`} role="status">
              <ToneIcon tone={result.ok ? "good" : "critical"} className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{result.text}</span>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={close}>{result?.ok ? "Close" : "Cancel"}</Button>
            {!result?.ok && (
              <Button variant={variant === "default" ? "primary" : variant} disabled={!armed || busy} onClick={run}>
                {busy ? "Working…" : label}
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
