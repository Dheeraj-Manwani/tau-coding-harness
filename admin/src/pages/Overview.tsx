import { Link } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { ago, credits, duration, int, label, mb, money, ms, num, pct, shortId, time } from "@/lib/format";
import type { Anomaly, Check, DeepseekBalance, Overview as OverviewData, WindowMetrics } from "@/types";
import {
  Badge,
  Card,
  ErrorBox,
  IdLink,
  KV,
  Row,
  Loading,
  Meter,
  Muted,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Table,
  Td,
  ToneIcon,
  type Tone,
} from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";

const SEVERITY_TONE: Record<Anomaly["severity"], Tone> = { critical: "critical", warn: "warning", info: "info" };

/**
 * The whole production picture in one request. The server caches it for 30 s
 * and shares it across tabs; Refresh asks for a recompute (`fresh=1`, honoured
 * at most every 10 s). There is no polling — reload is the refresh button.
 */
export default function Overview() {
  const { data, error, loading, fetchedAt, reload } = useApi<OverviewData>("/overview");

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          data ? (
            <>
              Snapshot from {time(data.generatedAt)}
              {data.cacheAgeSeconds > 0 && ` (cached ${data.cacheAgeSeconds}s)`} · release{" "}
              <span className="font-mono">{data.runtime.process.release?.slice(0, 7) ?? "unknown"}</span>
            </>
          ) : (
            "Production at a glance"
          )
        }
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload({ fresh: true })}
      />
      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && <Body d={data} />}
    </>
  );
}

function Body({ d }: { d: OverviewData }) {
  const day = d.jobs.metrics.find((m) => m.window === "24h");
  return (
    <>
      <Anomalies list={d.anomalies} />
      <Providers d={d} />
      <Runtime d={d} />
      <Experience d={d} day={day} />
      <Traffic d={d} />
      <Business d={d} />
    </>
  );
}

// ── anomalies ────────────────────────────────────────────────────────────────

function Anomalies({ list }: { list: Anomaly[] }) {
  if (list.length === 0) {
    return (
      <div className="mb-8 flex items-center gap-2.5 rounded-xl border border-good/35 bg-good/8 px-4 py-3 text-sm">
        <ToneIcon tone="good" className="size-5 text-good-text" />
        <span className="font-medium text-good-text">All clear.</span>
        <span className="text-fg-2">No anomalies across jobs, providers, runtime, traffic or billing.</span>
      </div>
    );
  }
  const critical = list.filter((a) => a.severity === "critical").length;
  return (
    <Section
      title={`${list.length} anomal${list.length === 1 ? "y" : "ies"}`}
      description={critical ? `${critical} critical, worst first` : "Worst first"}
    >
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {list.map((a) => {
          const tone = SEVERITY_TONE[a.severity];
          return (
            <li key={a.key} className="flex items-start gap-3 px-4 py-2.5">
              <Badge tone={tone}>{a.severity === "warn" ? "Warning" : label(a.severity)}</Badge>
              <span className="min-w-0 flex-1 text-sm text-fg">{a.message}</span>
              <code className="hidden shrink-0 font-mono text-[11px] text-fg-3 sm:block">{a.key}</code>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ── providers ────────────────────────────────────────────────────────────────

function CheckState({ check }: { check: Check<unknown> }) {
  if (check.status === "unconfigured") return <Muted>Not configured.</Muted>;
  if (check.status === "error")
    return (
      <div className="flex items-start gap-1.5 text-sm text-critical-text">
        <ToneIcon tone="critical" className="mt-0.5 size-4 shrink-0" />
        <span className="break-words">{check.error}</span>
      </div>
    );
  return null;
}

function primary(b: DeepseekBalance) {
  return b.balances.reduce<DeepseekBalance["balances"][number] | null>(
    (best, cur) => (!best || cur.total > best.total ? cur : best),
    null,
  );
}

function Providers({ d }: { d: OverviewData }) {
  const { deepseek, kimi, tavily, e2b, deepseekLowBalance } = d.providers;
  const ds = deepseek.status === "ok" ? primary(deepseek.data) : null;
  const dsLow = ds ? ds.total < deepseekLowBalance : false;
  const dsTone: Tone = deepseek.status !== "ok" ? "warning" : !deepseek.data.available || dsLow ? "critical" : "good";

  const tav = tavily.status === "ok" ? tavily.data : null;
  const tavRatio = tav && tav.planUsage !== null && tav.planLimit ? tav.planUsage / tav.planLimit : null;

  return (
    <Section title="Money and quota" description="Provider accounts, checked at most every 5 minutes">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card
          title="DeepSeek balance"
          action={deepseek.status === "ok" && <span className="text-[11px] text-fg-3">checked {ago(deepseek.fetchedAt)}</span>}
          className="md:col-span-2 xl:col-span-1"
        >
          {deepseek.status === "ok" && ds ? (
            <>
              <div className={`text-5xl font-semibold tracking-tight ${dsTone === "critical" ? "text-critical-text" : "text-fg"}`}>
                {money(ds.total, ds.currency)}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-2">
                <Badge tone={dsTone}>{!deepseek.data.available ? "Unavailable" : dsLow ? "Low" : "Healthy"}</Badge>
                <span>
                  alert below {money(deepseekLowBalance, ds.currency)} · topped up {money(ds.toppedUp, ds.currency)} ·
                  granted {money(ds.granted, ds.currency)}
                </span>
              </div>
            </>
          ) : deepseek.status === "ok" ? (
            <Muted>No balance reported.</Muted>
          ) : (
            <CheckState check={deepseek} />
          )}
        </Card>

        <Card title="Kimi (attachments)">
          {kimi.status === "ok" ? (
            <>
              <div className="text-2xl font-semibold tracking-tight">{money(kimi.data.available, kimi.data.currency)}</div>
              <div className="mt-1 text-xs text-fg-3">
                cash {money(kimi.data.cash, kimi.data.currency)} · voucher {money(kimi.data.voucher, kimi.data.currency)}
              </div>
            </>
          ) : (
            <CheckState check={kimi} />
          )}
        </Card>

        <Card title="Tavily (web search)">
          {tav ? (
            <div className="space-y-3">
              <Meter
                label={`${tav.plan ?? "Plan"} credits`}
                ratio={tavRatio}
                warnAt={0.75}
                criticalAt={0.9}
                detail={`${int(tav.planUsage)} of ${int(tav.planLimit)} used`}
              />
              {tav.paygoLimit ? (
                <Meter label="Pay-as-you-go" ratio={(tav.paygoUsage ?? 0) / tav.paygoLimit} detail={`${int(tav.paygoUsage)} of ${int(tav.paygoLimit)}`} />
              ) : null}
            </div>
          ) : (
            <CheckState check={tavily} />
          )}
        </Card>

        <Card title="E2B sandboxes" action={<Link to="/sandboxes" className="text-xs text-accent hover:underline">Open</Link>}>
          {e2b.status === "ok" ? (
            <div className="grid grid-cols-3 gap-2">
              <MiniFigure label="Running" value={int(e2b.running)} />
              <MiniFigure label="Paused" value={int(e2b.paused)} />
              <MiniFigure label="Orphans" value={int(e2b.orphans)} tone={e2b.orphans ? "warning" : undefined} />
              {e2b.staleDbRows > 0 && (
                <p className="col-span-3 text-xs text-fg-3">{e2b.staleDbRows} stale READY rows in the DB</p>
              )}
            </div>
          ) : e2b.status === "unconfigured" ? (
            <Muted>Not configured.</Muted>
          ) : (
            <div className="flex items-start gap-1.5 text-sm text-critical-text">
              <ToneIcon tone="critical" className="mt-0.5 size-4 shrink-0" />
              {e2b.error}
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
}

function MiniFigure({ label: l, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-fg-2">
        {tone && <ToneIcon tone={tone} className="size-3.5 text-warning-text" />}
        {l}
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${tone === "warning" ? "text-warning-text" : ""}`}>{value}</div>
    </div>
  );
}

// ── runtime ──────────────────────────────────────────────────────────────────

function Runtime({ d }: { d: OverviewData }) {
  const { health, process: p, draining } = d.runtime;
  const lag = p.eventLoop.maxMs1m;
  const memLimit = p.container.limitMB;
  const memUsed = p.container.usedMB ?? p.memory.rssMB;
  const diskRatio = p.disk && p.disk.totalGB > 0 ? 1 - p.disk.freeGB / p.disk.totalGB : null;

  return (
    <Section title="Runtime" description={`${p.runtime} on ${p.platform} · pid ${p.pid} · ${p.cpus} CPU`}>
      <StatGrid>
        <Stat
          label="Health"
          value={draining ? "Draining" : health.ok ? "Healthy" : "Degraded"}
          tone={draining ? "warning" : health.ok ? "good" : "critical"}
          sub={`up ${duration(p.uptimeSeconds)}`}
        />
        <Stat label="Runner" value={`${health.active}/${health.concurrency}`} sub={`${health.residentJobs} resident jobs`} to="/jobs" />
        <Stat label="Queued" value={int(health.queueDepth)} tone={health.queueDepth > 0 ? "warning" : undefined} sub="waiting for a slot" />
        <Stat label="Stuck jobs" value={int(health.stuckJobs)} tone={health.stuckJobs ? "critical" : "good"} sub="cold heartbeat > 5m" to="/jobs" />
        <Stat label="Orphan holds" value={int(health.orphanHolds)} tone={health.orphanHolds ? "warning" : undefined} sub={`${health.activeHolds} active holds`} />
        <Stat
          label="Event loop"
          value={ms(lag)}
          tone={lag > 2000 ? "critical" : lag > 500 ? "warning" : undefined}
          sub={`worst 1m · ${ms(p.eventLoop.maxMs15m)} over 15m`}
        />
      </StatGrid>
      <Card className="mt-3">
        <div className="grid gap-5 md:grid-cols-3">
          <Meter
            label={memLimit ? "Container memory" : "Process memory (no limit)"}
            ratio={memLimit ? memUsed / memLimit : null}
            warnAt={0.75}
            criticalAt={0.85}
            detail={memLimit ? `${mb(memUsed)} of ${mb(memLimit)} · RSS ${mb(p.memory.rssMB)}` : `RSS ${mb(p.memory.rssMB)}`}
          />
          <Meter
            label="JS heap"
            ratio={p.memory.heapTotalMB > 0 ? p.memory.heapUsedMB / p.memory.heapTotalMB : null}
            warnAt={0.9}
            criticalAt={0.97}
            detail={`${mb(p.memory.heapUsedMB)} of ${mb(p.memory.heapTotalMB)} · external ${mb(p.memory.externalMB)}`}
          />
          <Meter
            label="Disk"
            ratio={diskRatio}
            warnAt={0.8}
            criticalAt={0.9}
            detail={p.disk ? `${p.disk.freeGB} GB free of ${p.disk.totalGB} GB · host load ${p.load.join(" / ")}` : "unavailable"}
          />
        </div>
      </Card>
    </Section>
  );
}

// ── user experience ──────────────────────────────────────────────────────────

/** Higher is worse: above `crit` is critical, above `warn` a warning. */
function rateTone(value: number | null, warn: number, crit: number): Tone | undefined {
  if (value === null) return undefined;
  if (value > crit) return "critical";
  if (value > warn) return "warning";
  return undefined;
}

function Experience({ d, day }: { d: OverviewData; day: WindowMetrics | undefined }) {
  const failRate = day?.successRate == null ? null : 1 - day.successRate;
  const finish = Object.entries(day?.finishReasons ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <Section title="User experience" description="What users felt in the last 24 hours">
      <StatGrid>
        <Stat label="Job success" value={pct(day?.successRate ?? null)} tone={rateTone(failRate, 0.05, 0.1)} sub={`${int(day?.jobs)} jobs · ${int(day?.failed)} failed`} />
        <Stat label="Queue wait p95" value={duration(day?.p95QueueWaitSeconds)} tone={rateTone(day?.p95QueueWaitSeconds ?? null, 30, 120)} sub={`p50 ${duration(day?.p50QueueWaitSeconds)}`} />
        <Stat label="Build time p95" value={duration(day?.p95DurationSeconds)} tone={rateTone(day?.p95DurationSeconds ?? null, 600, 900)} sub={`p50 ${duration(day?.p50DurationSeconds)}`} />
        <Stat label="Tool failures" value={pct(day?.toolFailureRate ?? null)} tone={rateTone(day?.toolFailureRate ?? null, 0.05, 0.1)} sub={`${int(day?.toolFailures)} of ${int(day?.toolCalls)} calls`} />
        <Stat label="API 5xx (1h)" value={pct(d.http.rate5xx)} tone={rateTone(d.http.rate5xx, 0.01, 0.02)} sub={`${int(d.http.byClass["5xx"])} of ${int(d.http.requests)}`} />
        <Stat label="API latency p95" value={ms(d.http.p95Ms)} tone={rateTone(d.http.p95Ms, 1000, 3000)} sub={`p50 ${ms(d.http.p50Ms)} · p99 ${ms(d.http.p99Ms)}`} />
      </StatGrid>

      <div className="mt-3">
        <Table
          head={["Window", "Jobs", "Success", "Build p50", "Build p95", "Wait p50", "Wait p95", "Turns", "Credits/job", "Tool fail", "Sandbox fail"]}
        >
          {d.jobs.metrics.map((m) => (
            <tr key={m.window}>
              <Td className="font-medium">{m.window}</Td>
              <Td num>{int(m.jobs)}</Td>
              <Td num>{pct(m.successRate)}</Td>
              <Td num>{duration(m.p50DurationSeconds)}</Td>
              <Td num>{duration(m.p95DurationSeconds)}</Td>
              <Td num>{duration(m.p50QueueWaitSeconds)}</Td>
              <Td num>{duration(m.p95QueueWaitSeconds)}</Td>
              <Td num>{m.avgTurns ?? "—"}</Td>
              <Td num>{credits(m.creditsPerJob)}</Td>
              <Td num>{pct(m.toolFailureRate)}</Td>
              <Td num>{pct(m.sandboxProvisionFailureRate)}</Td>
            </tr>
          ))}
        </Table>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[2fr_1fr]">
        <Card title="Recent failures (24h)" action={<Link to="/jobs?status=FAILED" className="text-xs text-accent hover:underline">All failed jobs</Link>} padded={false}>
          {d.jobs.recentFailures.length === 0 ? (
            <div className="p-4">
              <Muted>No failed jobs in the last 24 hours.</Muted>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {d.jobs.recentFailures.map((f) => (
                <li key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2">
                  <IdLink to={`/jobs/${f.id}`} id={f.id} />
                  <span className="text-xs text-fg-3">{ago(f.queuedAt)}</span>
                  <Badge tone="neutral" icon={false}>
                    {label(f.finishReason)}
                  </Badge>
                  <span className="text-xs text-fg-3">
                    {label(f.type)} · {label(f.effort)}
                  </span>
                  <Link to={`/users/${f.userId}`} className="font-mono text-xs text-fg-3 hover:text-accent">
                    user {shortId(f.userId)}
                  </Link>
                  {f.error && <p className="w-full truncate text-xs text-fg-2" title={f.error}>{f.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="How jobs ended (24h)">
          {finish.length === 0 ? (
            <Muted>No finished jobs.</Muted>
          ) : (
            <KV>
              {finish.map(([reason, count]) => (
                <Row key={reason} k={label(reason)}>
                  <span className="num">{int(count)}</span>
                </Row>
              ))}
            </KV>
          )}
          {day && day.topFailingTools.length > 0 && (
            <>
              <div className="mt-4 mb-2 text-xs font-medium text-fg-2">Most failing tools</div>
              <KV>
                {day.topFailingTools.map((t) => (
                  <Row key={t.tool} k={t.tool}>
                    <span className="num">{`${t.failures} / ${t.calls}`}</span>
                  </Row>
                ))}
              </KV>
            </>
          )}
        </Card>
      </div>
    </Section>
  );
}

// ── traffic & errors ─────────────────────────────────────────────────────────

function Traffic({ d }: { d: OverviewData }) {
  const routes = (rows: OverviewData["http"]["slowRoutes"], metric: "avg" | "5xx") => (
    <Table head={["Route", "Requests", metric === "avg" ? "Avg" : "5xx", "Max"]} empty="None in this window.">
      {rows.slice(0, 6).map((r) => (
        <tr key={r.route}>
          <Td mono className="max-w-[18rem] truncate">{r.route}</Td>
          <Td num>{int(r.count)}</Td>
          <Td num>{metric === "avg" ? ms(r.avgMs) : int(r.s5xx)}</Td>
          <Td num>{ms(r.maxMs)}</Td>
        </tr>
      ))}
    </Table>
  );

  return (
    <Section
      title="Traffic and errors"
      description={`Last ${d.http.windowMinutes} minutes · in-memory, since ${time(d.http.trackingSince)} (resets on deploy)`}
    >
      <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
        <Card title="API requests per minute" action={<span className="num text-xs text-fg-2">{int(d.http.requests)} total</span>}>
          <Sparkline values={d.http.perMinute} endsAt={new Date(d.generatedAt)} />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(["2xx", "3xx", "4xx", "5xx"] as const).map((c) => (
              <Badge key={c} tone={c === "5xx" && d.http.byClass[c] > 0 ? "critical" : "neutral"} icon={c === "5xx" && d.http.byClass[c] > 0}>
                {c} <span className="num">{int(d.http.byClass[c])}</span>
              </Badge>
            ))}
          </div>
        </Card>
        <Card
          title="Errors logged"
          action={<Link to="/errors" className="text-xs text-accent hover:underline">All errors</Link>}
          padded={false}
        >
          <div className="grid grid-cols-2 gap-3 border-b border-line p-4">
            <MiniFigure label="Last 15m" value={int(d.errors.last15m.errors)} tone={d.errors.last15m.errors > 20 ? "warning" : undefined} />
            <MiniFigure label="Last 60m" value={int(d.errors.last60m.errors)} />
          </div>
          {d.errors.topGroups.length === 0 ? (
            <div className="p-4">
              <Muted>No warnings or errors since the process started.</Muted>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {d.errors.topGroups.slice(0, 5).map((g) => (
                <li key={g.fingerprint} className="flex items-start gap-2 px-4 py-2 text-xs">
                  <Badge tone={g.level === "error" ? "critical" : "warning"}>{int(g.count)}</Badge>
                  <div className="min-w-0">
                    <div className="font-mono text-fg">{g.event}</div>
                    <div className="truncate text-fg-3" title={g.message}>{g.message || "—"} · {ago(g.lastSeen)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-medium text-fg-2">Slowest routes</h3>
          {routes(d.http.slowRoutes, "avg")}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-medium text-fg-2">Routes returning 5xx</h3>
          {routes(d.http.failingRoutes, "5xx")}
        </div>
      </div>
    </Section>
  );
}

// ── business ─────────────────────────────────────────────────────────────────

function Business({ d }: { d: OverviewData }) {
  const spent24h = -(
    (d.business.credits24h["DEBIT"]?.credits ?? 0) + (d.business.credits24h["GATEWAY_DEBIT"]?.credits ?? 0)
  );
  const activeSubs = d.business.subscriptions["ACTIVE"] ?? 0;
  const gatewayErrRate = d.gateway.h24.requests > 0 ? d.gateway.h24.errors / d.gateway.h24.requests : null;

  const counts = (record: Record<string, number>) => {
    const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
    return entries.length ? (
      <KV>
        {entries.map(([k, v]) => (
          <Row key={k} k={label(k)}>
            <span className="num">{int(v)}</span>
          </Row>
        ))}
      </KV>
    ) : (
      <Muted>None.</Muted>
    );
  };

  return (
    <Section title="Users and business">
      <StatGrid>
        <Stat label="Users" value={num(d.users.total)} sub={`+${int(d.users.signups24h)} today · +${int(d.users.signups7d)} this week`} to="/users" />
        <Stat label="Active builders" value={int(d.users.activeBuilders24h)} sub={`${int(d.users.activeBuilders7d)} in 7d`} />
        <Stat label="Pro accounts" value={int(d.business.plans["PRO"] ?? 0)} sub={`${int(activeSubs)} active subscriptions`} />
        <Stat label="Credits spent (24h)" value={credits(spent24h)} sub="builds + AI gateway" />
        <Stat
          label="AI gateway (24h)"
          value={num(d.gateway.h24.requests)}
          tone={rateTone(gatewayErrRate, 0.05, 0.1)}
          sub={`${pct(gatewayErrRate)} upstream errors · ${credits(d.gateway.h24.credits)} cr`}
          to="/gateway"
        />
        <Stat
          label="Payment webhooks"
          value={d.webhooks.backlog ? `${int(d.webhooks.backlog)} stuck` : "OK"}
          tone={d.webhooks.backlog ? "critical" : "good"}
          sub={`${int(d.webhooks.received24h)} received in 24h`}
        />
        <Stat label="Projects" value={num(d.projects.total)} sub={`+${int(d.projects.created24h)} today · ${int(d.projects.liveSites)} live sites`} />
        <Stat
          label="Feedback (7d)"
          value={d.feedback7d.avgRating === null ? "—" : `${d.feedback7d.avgRating.toFixed(1)} / 5`}
          sub={`${int(d.feedback7d.count)} responses`}
          to="/feedback"
        />
        <Stat label="Promo redemptions" value={int(d.business.promoRedemptions7d)} sub="last 7 days" />
      </StatGrid>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Publishes (24h)">{counts(d.deploys24h)}</Card>
        <Card title="Attachments (24h)">{counts(d.attachments24h)}</Card>
        <Card title="Subscriptions">{counts(d.business.subscriptions)}</Card>
        <Card title="Credit ledger (24h)">
          {Object.keys(d.business.credits24h).length ? (
            <KV>
              {Object.entries(d.business.credits24h).map(([type, v]) => (
                <Row key={type} k={label(type)}>
                  <span className="num">
                    {credits(v.credits)} <span className="text-fg-3">· {int(v.entries)}</span>
                  </span>
                </Row>
              ))}
            </KV>
          ) : (
            <Muted>No ledger activity.</Muted>
          )}
        </Card>
      </div>
    </Section>
  );
}
