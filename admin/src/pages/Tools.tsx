import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, patch, post } from "@/lib/api";
import { ago, credits, dateTime, int } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { PromoCodeResult, PromoCodeRow, ReapResult, ReconcileAccountResult, ReconcileJobResult } from "@/types";
import { Badge, Button, Card, ConfirmButton, ErrorBox, JsonBlock, Loading, Section, Table, Td, inputClass, type Tone } from "@/components/ui";

/** Incident and support tools. Each one is a single, explicit request. Nothing here runs on its own. */
export default function Tools() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Tools</h1>
        <p className="mt-1 text-sm text-fg-2">Repairs for jobs and credits, and promo codes. For margins, see Costs.</p>
      </header>

      <Section title="Jobs and holds">
        <div className="grid gap-3 md:grid-cols-2">
          <ToolCard
            title="Reap stuck jobs"
            body="Terminates jobs whose heartbeat went cold and settles their credit holds. The hourly sweep does this too. Run it now if a user's project is refusing prompts."
          >
            <ConfirmButton
              label="Reap stuck jobs"
              variant="default"
              title="Reap stuck jobs now?"
              description="Every QUEUED/RUNNING job with a cold heartbeat is marked failed and its hold settled."
              onConfirm={async () => {
                const r = await post<ReapResult>("/jobs/reconcile-stuck");
                return `Reaped ${r.reaped} job(s)${r.errors.length ? `, ${r.errors.length} error(s): ${r.errors.join("; ")}` : "."}`;
              }}
            />
          </ToolCard>
          <ToolCard
            title="Sweep leaked holds"
            body="Settles ACTIVE credit holds whose job already finished. These leak concurrency slots and block users from starting a new build."
          >
            <ConfirmButton
              label="Sweep holds"
              variant="default"
              title="Settle every leaked hold?"
              description="Holds behind COMPLETED/FAILED/CANCELLED jobs are settled against what the job actually consumed."
              onConfirm={async () => {
                const r = await post<{ swept: number; errors: string[] }>("/reconcile/sweep");
                return `Settled ${r.swept} hold(s)${r.errors.length ? `, ${r.errors.length} error(s)` : "."}`;
              }}
            />
          </ToolCard>
        </div>
      </Section>

      <Section title="Credit integrity" description="Checks that stored balances match the ledger. Read-only.">
        <div className="grid gap-3 lg:grid-cols-3">
          <LookupCard
            title="Check one user"
            placeholder="User id"
            run={(id) => api<ReconcileAccountResult>(`/reconcile?userId=${encodeURIComponent(id)}`)}
            render={(r) => <DriftResult ok={r.ok} rows={[["Balance drift", r.grossDriftMicro], ["Reserved drift", r.reservedDriftMicro]]} raw={r} />}
          />
          <LookupCard
            title="Check one job"
            placeholder="Job id"
            run={(id) => api<ReconcileJobResult>(`/reconcile/job?jobId=${encodeURIComponent(id)}`)}
            render={(r) => <DriftResult ok={r.ok} rows={[["Charged", r.chargedMicro], ["Token cost", r.tokenCostMicro], ["Drift", r.driftMicro]]} raw={r} />}
          />
          <AllAccountsCheck />
        </div>
      </Section>

      <PromoCodes />
    </>
  );
}

function ToolCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <p className="mb-3 text-sm text-fg-2">{body}</p>
      {children}
    </Card>
  );
}

const microToCredits = (micro: string) => credits(Number(micro) / 1e6);

function DriftResult({ ok, rows, raw }: { ok: boolean; rows: Array<[string, string]>; raw: unknown }) {
  return (
    <div className="mt-3 space-y-2">
      <Badge tone={ok ? "good" : "critical"}>{ok ? "Consistent" : "Drift found"}</Badge>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-3">{k}</dt>
            <dd className="num">{microToCredits(v)} cr</dd>
          </div>
        ))}
      </dl>
      <JsonBlock value={raw} />
    </div>
  );
}

function LookupCard<T>({
  title,
  placeholder,
  run,
  render,
}: {
  title: string;
  placeholder: string;
  run: (id: string) => Promise<T>;
  render: (result: T) => ReactNode;
}) {
  const [id, setId] = useState("");
  const [state, setState] = useState<{ busy: boolean; result?: T; error?: string }>({ busy: false });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return;
    setState({ busy: true });
    try {
      setState({ busy: false, result: await run(id.trim()) });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Card title={title}>
      <form onSubmit={submit} className="flex gap-2">
        <input className={`${inputClass} min-w-0 flex-1 font-mono text-xs`} placeholder={placeholder} value={id} onChange={(e) => setId(e.target.value)} spellCheck={false} />
        <Button type="submit" disabled={state.busy}>
          {state.busy ? "…" : "Check"}
        </Button>
      </form>
      {state.error && <div className="mt-3"><ErrorBox message={state.error} /></div>}
      {state.result !== undefined && render(state.result)}
    </Card>
  );
}

function AllAccountsCheck() {
  const [state, setState] = useState<{ total: number; driftedCount: number; drifted: ReconcileAccountResult[] }>();
  return (
    <Card title="Check every account">
      <p className="mb-3 text-sm text-fg-2">Runs three queries per account. Fine at today's scale, but don't run it during a traffic spike.</p>
      <ConfirmButton
        label="Run full check"
        variant="default"
        title="Reconcile every billing account?"
        description="Read-only, but it runs three aggregate queries per account against the production database."
        onConfirm={async () => {
          const r = await api<{ total: number; driftedCount: number; drifted: ReconcileAccountResult[] }>("/reconcile/all");
          setState(r);
          return `${r.driftedCount} of ${r.total} account(s) drifted.`;
        }}
      />
      {state && state.drifted.length > 0 && (
        <div className="mt-3">
          <Table head={["User", "Balance drift", "Reserved drift"]}>
            {state.drifted.map((r) => (
              <tr key={r.userId}>
                <Td>
                  <Link to={`/users/${r.userId}`} className="font-mono text-xs text-accent hover:underline">
                    {r.userId.slice(0, 8)}
                  </Link>
                </Td>
                <Td num>{microToCredits(r.grossDriftMicro)}</Td>
                <Td num>{microToCredits(r.reservedDriftMicro)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {state && state.drifted.length === 0 && (
        <div className="mt-3">
          <Badge tone="good">All {int(state.total)} accounts consistent</Badge>
        </div>
      )}
    </Card>
  );
}

const PROMO_STATUS: Record<PromoCodeRow["status"], { tone: Tone; label: string }> = {
  active: { tone: "good", label: "Active" },
  used_up: { tone: "warning", label: "Used up" },
  expired: { tone: "neutral", label: "Expired" },
  inactive: { tone: "neutral", label: "Inactive" },
};

/** Create form + the existing codes. The table reloads after each create. */
function PromoCodes() {
  const { data, error, loading, reload } = useApi<PromoCodeRow[]>("/promo-codes");
  const active = data?.filter((c) => c.status === "active").length ?? 0;
  const redemptions = data?.reduce((n, c) => n + c.redeemedCount, 0) ?? 0;

  return (
    <Section
      title="Promo codes"
      description={data ? `${int(active)} active of ${int(data.length)} · ${int(redemptions)} redemptions in total` : undefined}
      action={<Button onClick={() => reload()} disabled={loading}>Refresh</Button>}
    >
      <PromoForm onCreated={() => reload()} />
      <div className="mt-3">
        {error && <ErrorBox message={error} onRetry={() => reload()} />}
        {!data && loading && <Loading label="Loading codes…" />}
        {data && (
          <Table
            head={["Code", "Status", "Credits", "Redeemed", "Per user", "Expires", "Created", "Note", ""]}
            empty="No promo codes yet. Create one above."
          >
            {data.map((c) => {
              const s = PROMO_STATUS[c.status];
              const cap = c.maxRedemptions;
              return (
                <tr key={c.id}>
                  <Td mono className="font-medium">{c.code}</Td>
                  <Td>
                    <Badge tone={s.tone} icon={s.tone !== "neutral"}>
                      {s.label}
                    </Badge>
                  </Td>
                  <Td num>{credits(c.credits)}</Td>
                  <Td num>
                    {int(c.redeemedCount)}
                    <span className="text-fg-3"> / {cap === null ? "∞" : int(cap)}</span>
                  </Td>
                  <Td num>{int(c.perUserLimit)}</Td>
                  <Td className="text-xs whitespace-nowrap text-fg-2" >
                    <span title={c.expiresAt ? dateTime(c.expiresAt) : undefined}>{c.expiresAt ? ago(c.expiresAt) : "Never"}</span>
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-fg-2">
                    <span title={dateTime(c.createdAt)}>{ago(c.createdAt)}</span>
                  </Td>
                  <Td className="max-w-[20rem] truncate text-xs text-fg-2">
                    <span title={c.description ?? undefined}>{c.description ?? "—"}</span>
                  </Td>
                  <Td className="text-right">
                    <ActiveToggle code={c} onDone={() => reload()} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        {data && data.length >= 200 && <p className="mt-2 text-xs text-fg-3">Showing the newest 200.</p>}
      </div>
    </Section>
  );
}

/**
 * Deactivate an active code, or reactivate an inactive one. Never a delete:
 * the redemption history (and with it the once-per-user guard) is kept.
 */
function ActiveToggle({ code: c, onDone }: { code: PromoCodeRow; onDone: () => void }) {
  const set = (isActive: boolean) => async () => {
    await patch<PromoCodeRow>(`/promo-codes/${c.id}`, { isActive });
  };

  if (c.isActive) {
    return (
      <ConfirmButton
        label="Deactivate"
        title={`Deactivate ${c.code}?`}
        description={
          <>
            It stops working immediately: nobody can redeem it from now on. Users keep the credits they already
            got, and its redemption history ({int(c.redeemedCount)} so far) is kept. You can reactivate it at
            any time.
          </>
        }
        confirmLabel="Deactivate code"
        closeOnSuccess
        onConfirm={set(false)}
        onDone={onDone}
      />
    );
  }

  // Reactivating can't revive a code that something else is stopping. The
  // server derives these with the same checks redeem() makes.
  const { expired, usedUp } = c;
  return (
    <ConfirmButton
      label="Reactivate"
      variant="default"
      title={`Reactivate ${c.code}?`}
      description={
        <>
          Users will be able to redeem it again. Anyone who already redeemed it still can't redeem it a second time.
          {expired && <> It has also passed its expiry date, so redemptions will still be refused.</>}
          {usedUp && <> It has also reached its redemption cap, so redemptions will still be refused.</>}
        </>
      }
      confirmLabel="Reactivate code"
      closeOnSuccess
      onConfirm={set(true)}
      onDone={onDone}
    />
  );
}

function PromoForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ code: "", credits: "", description: "", maxRedemptions: "", perUserLimit: "1", expiresAt: "" });
  const [state, setState] = useState<{ busy: boolean; result?: PromoCodeResult; error?: string }>({ busy: false });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const result = await post<PromoCodeResult>("/promo-codes", {
        code: form.code.trim(),
        credits: Number(form.credits),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}),
        perUserLimit: Number(form.perUserLimit || 1),
        // Date input → end of that day, local time.
        ...(form.expiresAt ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() } : {}),
      });
      setState({ busy: false, result });
      onCreated();
      setForm({ code: "", credits: "", description: "", maxRedemptions: "", perUserLimit: "1", expiresAt: "" });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const field = (labelText: string, input: ReactNode, hint?: string) => (
    <label className="block text-xs text-fg-2">
      {labelText}
      <div className="mt-1">{input}</div>
      {hint && <span className="mt-0.5 block text-fg-3">{hint}</span>}
    </label>
  );

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {field("Code", <input required maxLength={64} className={`${inputClass} w-full font-mono uppercase`} value={form.code} onChange={set("code")} placeholder="LAUNCH50" />, "Stored uppercase")}
        {field("Credits", <input required type="number" min="0.01" step="0.01" className={`${inputClass} w-full`} value={form.credits} onChange={set("credits")} />, "Added to the bonus pot, which never expires")}
        {field("Description", <input className={`${inputClass} w-full`} value={form.description} onChange={set("description")} placeholder="Internal note" />)}
        {field("Max redemptions", <input type="number" min="1" step="1" className={`${inputClass} w-full`} value={form.maxRedemptions} onChange={set("maxRedemptions")} placeholder="Unlimited" />)}
        {field("Per user", <input required type="number" min="1" step="1" className={`${inputClass} w-full`} value={form.perUserLimit} onChange={set("perUserLimit")} />)}
        {field("Expires", <input type="date" className={`${inputClass} w-full`} value={form.expiresAt} onChange={set("expiresAt")} />, "Optional. Expires at the end of that day.")}
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="primary" disabled={state.busy}>
            {state.busy ? "Creating…" : "Create promo code"}
          </Button>
          {state.result && (
            <Badge tone="good">
              Created <span className="font-mono">{state.result.code}</span>: {credits(state.result.credits)} credits
            </Badge>
          )}
        </div>
        {state.error && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorBox message={state.error} />
          </div>
        )}
      </form>
    </Card>
  );
}
