import { useState } from "react";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  StarIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { useDeployStatus } from "@/src/features/project/deploy";
import {
  domainStatusLabel,
  isWaiting,
  recordCheck,
  recordsInPlace,
  useAddDomain,
  useCheckDomain,
  useDomains,
  useRemoveDomain,
  useSetPrimary,
  type DnsRecord,
  type DomainView,
} from "@/src/features/project/domains";

/**
 * Tools -> Domains: connect a domain bought somewhere else.
 *
 * The owner types a name and is shown two records to add at their registrar.
 * Tau watches for them and moves the domain along; this pane shows where it
 * is, record by record, and what to do when it is stuck.
 */
export function DomainsPane({ projectId }: { projectId: string }) {
  const { data, isLoading } = useDomains(projectId);
  const { data: deploy } = useDeployStatus(projectId);
  const [input, setInput] = useState("");
  const add = useAddDomain(projectId);

  const published = !!deploy?.slug;
  const connect = () => {
    const hostname = input.trim();
    if (!hostname || add.isPending) return;
    add.mutate(hostname, { onSuccess: () => setInput("") });
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--silver-900)]">
            <GlobeIcon className="size-4" />
            Domains
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--silver-600)]">
            Show your app at a domain you own, like <span className="font-mono">www.example.com</span>. Tau gives you
            two records to add where you bought the domain, then watches for them.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="www.example.com"
            aria-label="Domain"
            spellCheck={false}
            autoCapitalize="none"
            disabled={!published}
            className="min-w-0 flex-1 rounded-lg border border-[var(--silver-200)] bg-[var(--space-surface)] px-3 py-2 text-sm text-[var(--silver-900)] outline-none placeholder:text-[var(--silver-600)] focus:border-brand disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!published || !input.trim() || add.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {add.isPending && <Loader2Icon className="size-3.5 animate-spin" />}
            Connect
          </button>
        </form>
        {deploy && !published && (
          <p className="-mt-3 text-xs text-amber-200">
            Publish your app once first, so there is something to show on the domain.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[var(--silver-600)]">
            <Loader2Icon className="size-4 animate-spin" />
            Loading…
          </div>
        ) : data && data.domains.length > 0 ? (
          <ul className="space-y-3">
            {data.domains.map((domain) => (
              <DomainCard key={domain.id} projectId={projectId} domain={domain} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--silver-200)] px-4 py-6 text-center text-xs text-[var(--silver-600)]">
            No domains connected yet.
          </p>
        )}

        <Guidance />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DomainView["status"] }) {
  const tone =
    status === "ACTIVE"
      ? "bg-green-500/10 text-green-400"
      : status === "FAILED"
        ? "bg-red-500/10 text-red-300"
        : "bg-amber-500/10 text-amber-300";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      {status === "ACTIVE" ? (
        <CheckCircle2Icon className="size-3" />
      ) : status === "FAILED" ? (
        <XCircleIcon className="size-3" />
      ) : (
        <Loader2Icon className="size-3 animate-spin" />
      )}
      {domainStatusLabel(status)}
    </span>
  );
}

function DomainCard({ projectId, domain }: { projectId: string; domain: DomainView }) {
  const check = useCheckDomain(projectId);
  const primary = useSetPrimary(projectId);
  const remove = useRemoveDomain(projectId);
  const [confirming, setConfirming] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  const waiting = isWaiting(domain.status);
  const active = domain.status === "ACTIVE";
  // Active domains need no records on screen; failed and waiting ones do.
  const recordsVisible = !active || showRecords;

  return (
    <li className="rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`https://${domain.hostname}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-mono text-sm font-medium text-[var(--silver-900)] underline-offset-2 hover:underline"
        >
          {domain.hostname}
        </a>
        <StatusBadge status={domain.status} />
        {domain.isPrimary && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
            <StarIcon className="size-3" />
            Primary
          </span>
        )}
      </div>

      {domain.status === "FAILED" && domain.error && (
        <p className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 p-2.5 text-xs leading-relaxed text-red-200">
          {domain.error}
        </p>
      )}

      {waiting && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--silver-600)]">
          {recordsInPlace(domain.dns)
            ? "Both records are in place. Tau is waiting for the certificate, which usually takes a few minutes."
            : "Add the two records below where you bought the domain. Changes can take from a few minutes to a few hours to spread."}
        </p>
      )}

      {recordsVisible && <RecordsTable domain={domain} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(waiting || domain.status === "FAILED") && (
          <button
            type="button"
            disabled={check.isPending}
            onClick={() => check.mutate(domain.id)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--silver-200)] px-2.5 py-1.5 text-xs font-medium text-[var(--silver-900)] transition-colors hover:bg-[var(--space-overlay)] disabled:opacity-50"
          >
            <RefreshCwIcon className={cn("size-3.5", check.isPending && "animate-spin")} />
            {domain.status === "FAILED" ? "Try again" : "Refresh"}
          </button>
        )}
        {active && (
          <>
            <button
              type="button"
              disabled={primary.isPending}
              onClick={() => primary.mutate({ domainId: domain.id, primary: !domain.isPrimary })}
              className="rounded-lg border border-[var(--silver-200)] px-2.5 py-1.5 text-xs font-medium text-[var(--silver-900)] transition-colors hover:bg-[var(--space-overlay)] disabled:opacity-50"
            >
              {domain.isPrimary ? "Stop being primary" : "Make primary"}
            </button>
            <button
              type="button"
              onClick={() => setShowRecords((v) => !v)}
              className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--silver-600)] hover:text-[var(--silver-900)]"
            >
              {showRecords ? "Hide records" : "Show records"}
            </button>
          </>
        )}
        <span className="flex-1" />
        {confirming ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="text-[var(--silver-600)]">
              {active ? "It will stop working." : "Remove it?"}
            </span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(domain.id)}
              className="rounded-md bg-red-500 px-2 py-1 font-medium text-white hover:bg-red-400 disabled:opacity-60"
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="px-1.5 py-1 text-[var(--silver-600)] hover:text-[var(--silver-900)]">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${domain.hostname}`}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--silver-600)] transition-colors hover:text-red-300"
          >
            <Trash2Icon className="size-3.5" />
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

function RecordsTable({ domain }: { domain: DomainView }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--silver-200)]">
      <table className="w-full text-left text-xs">
        <thead className="bg-[var(--space-overlay)] text-[11px] text-[var(--silver-600)]">
          <tr>
            <th className="px-3 py-1.5 font-medium">Type</th>
            <th className="px-3 py-1.5 font-medium">Name</th>
            <th className="px-3 py-1.5 font-medium">Value</th>
            <th className="px-3 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {domain.records.map((record) => (
            <RecordRow key={`${record.type}-${record.name}`} record={record} dns={domain.dns} />
          ))}
        </tbody>
      </table>
      {domain.kind === "root" && (
        <p className="border-t border-[var(--silver-200)] px-3 py-2 text-[11px] leading-relaxed text-[var(--silver-600)]">
          A root domain can't use a CNAME. Use an <strong>ALIAS</strong> (some registrars call it ANAME, or let you put a CNAME on <span className="font-mono">@</span>). If yours
          has none, connect <span className="font-mono">www</span> instead and switch on your registrar's "forward root to www".
        </p>
      )}
    </div>
  );
}

function CopyValue({ text, label }: { text: string; label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="min-w-0 break-all font-mono text-[11px] text-[var(--silver-900)]">{text}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
      >
        <CopyIcon className="size-3" />
      </button>
    </span>
  );
}

function RecordRow({ record, dns }: { record: DnsRecord; dns: DomainView["dns"] }) {
  const state = recordCheck(record, dns);
  return (
    <tr className="border-t border-[var(--silver-200)] align-top">
      <td className="px-3 py-2 font-mono text-[11px] text-[var(--silver-900)]">{record.type}</td>
      <td className="px-3 py-2">
        <CopyValue text={record.name} label="name" />
      </td>
      <td className="px-3 py-2">
        <CopyValue text={record.value} label="value" />
      </td>
      <td className="px-3 py-2 text-[11px]">
        {state === null ? null : state === "found" ? (
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle2Icon className="size-3" /> found
          </span>
        ) : state === "points elsewhere" ? (
          <span className="flex items-center gap-1 text-amber-300">
            <XCircleIcon className="size-3" /> points elsewhere
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[var(--silver-600)]">
            <CircleDashedIcon className="size-3" /> not found yet
          </span>
        )}
      </td>
    </tr>
  );
}

function Guidance() {
  return (
    <section className="space-y-2 rounded-xl border border-[var(--silver-200)] p-4 text-xs leading-relaxed text-[var(--silver-600)]">
      <h3 className="text-xs font-semibold text-[var(--silver-900)]">Good to know</h3>
      <ul className="list-disc space-y-1.5 pl-4">
        <li>DNS changes can take from a few minutes to a few hours. This page updates itself while it waits.</li>
        <li>
          Add the TXT record first. It proves the domain is yours, and tau won't connect the domain until it sees it.
        </li>
        <li>
          If you sign in to your app with a third-party service (Google, GitHub and so on), add the new address to its allowed callback URLs.
        </li>
        <li>With a <strong>primary</strong> domain, your tau address redirects to it.</li>
      </ul>
    </section>
  );
}
