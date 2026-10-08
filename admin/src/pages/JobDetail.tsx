import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api, post } from "@/lib/api";
import { ago, credits, dateTime, duration, int, label, ms, num, shortId } from "@/lib/format";
import type { JobDetail as JobDetailData, JobEvents } from "@/types";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBox,
  JobStatusBadge,
  JsonBlock,
  KV,
  Row,
  Loading,
  Muted,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Table,
  Td,
  type Tone,
} from "@/components/ui";
import { JobLinks } from "./Jobs";

const TOOL_TONE: Record<string, Tone> = { SUCCESS: "good", FAILED: "critical", RUNNING: "info", PENDING: "warning", SKIPPED: "neutral" };

const seconds = (from: string | null, to: string | null) =>
  from && to ? (new Date(to).getTime() - new Date(from).getTime()) / 1000 : null;

export default function JobDetail() {
  const { id = "" } = useParams();
  const { data, error, loading, fetchedAt, reload } = useApi<JobDetailData>(`/jobs/${id}`);

  return (
    <>
      <PageHeader
        title={`Job ${shortId(id)}`}
        subtitle={<span className="font-mono text-xs">{id}</span>}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload()}
      >
        {data && (data.job.status === "QUEUED" || data.job.status === "RUNNING") && (
          <ConfirmButton
            label="Kill job"
            title="Force-terminate this job?"
            description="The user's run stops now and its credit hold settles."
            typeToConfirm={shortId(id)}
            onConfirm={async () => {
              const r = await post<{ killed: boolean }>(`/jobs/${id}/kill`);
              return r.killed ? "Job terminated." : "It had already finished.";
            }}
            onDone={() => reload()}
          />
        )}
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && <Body d={data} />}
    </>
  );
}

function Body({ d }: { d: JobDetailData }) {
  const { job } = d;
  const toolCalls = d.timeline.flatMap((m) => m.toolCalls);
  const failedTools = toolCalls.filter((t) => t.status === "FAILED").length;

  return (
    <>
      <StatGrid>
        <Stat label="Status" value={<JobStatusBadge status={job.status} />} sub={label(job.finishReason)} />
        <Stat label="Waited" value={duration(seconds(job.queuedAt, job.startedAt))} sub="queued → started" />
        <Stat label="Ran for" value={duration(seconds(job.startedAt, job.completedAt))} sub={job.completedAt ? `ended ${ago(job.completedAt)}` : "still running"} />
        <Stat label="Turns" value={int(job.currentTurn)} sub={`attempt ${job.attemptNumber} of ${job.maxAttempts}`} />
        <Stat label="Tokens" value={num(job.inputTokens + job.outputTokens)} sub={`${num(job.inputTokens)} in · ${num(job.outputTokens)} out`} />
        <Stat
          label="Tool calls"
          value={int(toolCalls.length)}
          tone={failedTools ? "warning" : undefined}
          sub={`${failedTools} failed · ${credits(job.credits)} credits`}
        />
      </StatGrid>

      {job.error && (
        <div className="mt-3">
          <ErrorBox message={job.error} />
        </div>
      )}

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <Card title="Job">
          <KV>
            <Row k="Project"><Link className="text-accent hover:underline" to={`/projects/${job.project.id}`}>{job.project.name}</Link></Row>
            <Row k="User"><Link className="font-mono text-xs text-accent hover:underline" to={`/users/${job.project.userId}`}>{job.project.userId}</Link></Row>
            <Row k="Kind">{`${label(job.type)} · ${label(job.effort)} effort`}</Row>
            <Row k="Model">{job.model ?? "—"}</Row>
            <Row k="Sandbox"><span className="font-mono text-xs">{job.sandboxId ?? "—"}</span></Row>
            <Row k="Queued">{dateTime(job.queuedAt)}</Row>
            <Row k="Last heartbeat">{job.lastHeartbeatAt ? `${dateTime(job.lastHeartbeatAt)} (${ago(job.lastHeartbeatAt)})` : "—"}</Row>
          </KV>
          <div className="mt-3">
            <JobLinks userId={job.project.userId} projectId={job.project.id} />
          </div>
        </Card>
        <Card title="Live state and credit hold">
          {d.live ? (
            <KV>
              <Row k="Phase"><span className="font-mono text-accent">{d.live.phase}</span></Row>
              <Row k="Last event">{ago(d.live.lastEventAt)}</Row>
              <Row k="Events">{int(d.live.eventCount)}</Row>
              <Row k="Tool calls">{int(d.live.toolCallCount)}</Row>
            </KV>
          ) : (
            <Muted>Not resident in this process. It finished, or the process running it is gone.</Muted>
          )}
          <div className="mt-4 border-t border-line pt-4">
            {d.hold ? (
              <KV>
                <Row k="Hold"><Badge tone={d.hold.status === "ACTIVE" ? "warning" : "neutral"} icon={d.hold.status === "ACTIVE"}>{label(d.hold.status)}</Badge></Row>
                <Row k="Reserved">{`${credits(Number(d.hold.amount) / 1e6)} credits`}</Row>
                <Row k="Consumed">{`${credits(Number(d.hold.consumed) / 1e6)} credits`}</Row>
                <Row k="Settled">{d.hold.settledAt ? dateTime(d.hold.settledAt) : "—"}</Row>
              </KV>
            ) : (
              <Muted>No credit hold.</Muted>
            )}
          </div>
        </Card>
      </div>

      {d.contentRedacted && (
        <p className="mt-4 text-xs text-fg-3">
          The user's content (prompt, messages, tool input and output) is hidden. ADMIN_ALLOW_CONTENT is off on the server.
        </p>
      )}
      {job.prompt && (
        <div className="mt-4">
          <JsonBlock value={job.prompt} summary="Prompt" />
        </div>
      )}

      <Insights insights={job.insights} />

      <Section title="Timeline" description={`${d.timeline.length} messages`}>
        <Table head={["#", "Message", "Tool calls", "Tokens", "At"]} empty="No messages recorded.">
          {d.timeline.map((m) => (
            <tr key={m.id}>
              <Td num className="text-fg-3">{m.sequence}</Td>
              <Td className="text-xs">
                <span className="font-medium">{label(m.role)}</span> <span className="text-fg-3">{label(m.type)}</span>
                {m.content !== null && (
                  <div className="mt-1 max-w-xl">
                    <JsonBlock value={m.content} summary="Content" />
                  </div>
                )}
              </Td>
              <Td>
                <div className="flex flex-col gap-1">
                  {m.toolCalls.map((t) => (
                    <div key={t.toolCallId} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={TOOL_TONE[t.status] ?? "neutral"}>{t.toolName}</Badge>
                      <span className="num text-fg-3">{ms(t.durationMs)}</span>
                      {t.error && <span className="max-w-md truncate text-critical-text" title={t.error}>{t.error}</span>}
                    </div>
                  ))}
                </div>
              </Td>
              <Td num className="text-xs">{m.inputTokens + m.outputTokens > 0 ? num(m.inputTokens + m.outputTokens) : ""}</Td>
              <Td className="text-xs whitespace-nowrap text-fg-3">{dateTime(m.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Token usage by turn">
          <Table head={["Model", "In", "Out", "At"]} empty="No usage recorded.">
            {d.usage.map((u, i) => (
              <tr key={i}>
                <Td mono>{u.model}</Td>
                <Td num>{num(u.inputTokens)}</Td>
                <Td num>{num(u.outputTokens)}</Td>
                <Td className="text-xs text-fg-3">{dateTime(u.recordedAt)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Context checkpoints">
          <Table head={["Up to #", "Before", "After", "At"]} empty="Context was never compacted.">
            {d.checkpoints.map((c) => (
              <tr key={c.upToSequence}>
                <Td num>{c.upToSequence}</Td>
                <Td num>{num(c.tokensBefore)}</Td>
                <Td num>{num(c.tokensAfter)}</Td>
                <Td className="text-xs text-fg-3">{dateTime(c.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>

      <EventReplay jobId={job.id} />
    </>
  );
}

/** The frames the user's browser received. Fetched on demand only — it can be large. */
function EventReplay({ jobId }: { jobId: string }) {
  const [events, setEvents] = useState<JobEvents["events"]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setEvents((await api<JobEvents>(`/jobs/${jobId}/events`)).events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const counts = events?.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {});

  return (
    <Section
      title="Stream replay"
      description="Exactly what the user's browser received. Kept in memory for about an hour after the run."
      action={<Button onClick={load} disabled={busy}>{busy ? "Loading…" : events ? "Reload" : "Load events"}</Button>}
    >
      {error && <ErrorBox message={error} />}
      {events && events.length === 0 && <Muted>No buffered events. The run is older than the replay window.</Muted>}
      {events && events.length > 0 && counts && (
        <Card>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, n]) => (
                <Badge key={type} icon={false}>
                  {type} <span className="num">{n}</span>
                </Badge>
              ))}
          </div>
          <JsonBlock value={events} summary={`${events.length} events`} />
        </Card>
      )}
    </Section>
  );
}

/** What the run did beyond its columns: cache, summaries, the look, the reviews. */
function Insights({ insights }: { insights: JobDetailData["job"]["insights"] }) {
  if (!insights) {
    return (
      <Section title="Run insights" description="Not kept for runs from before this was added.">
        <Muted>Nothing recorded.</Muted>
      </Section>
    );
  }
  const { cache, summaries, design, reviews, render, endedNotCompiling } = insights;
  return (
    <Section title="Run insights" description="Recorded by the worker; no model call.">
      <StatGrid>
        <Stat
          label="Cache hits"
          value={cache ? `${cache.cachedPct}%` : "—"}
          sub={cache ? `${num(cache.cachedTokens)} of ${num(cache.inputTokens)} input tokens, ${cache.turns} turns` : "no turns finished"}
        />
        <Stat label="Summaries" value={summaries ?? 0} sub="context summarised this run" />
        <Stat
          label="Look"
          value={design ? label(design.style) : "—"}
          sub={design ? `${design.accent}, ${design.mode}, by ${design.source}` : "none chosen this run"}
        />
        <Stat label="Design reviews" value={reviews?.length ?? 0} sub={reviews?.map((r) => r.verdict).join(", ") || "none"} />
        <Stat
          label="Render check"
          value={render ? "Sent back" : endedNotCompiling ? "Not compiling" : "—"}
          sub={
            render
              ? `app was ${label(render.sentBack)} when the run first said done${endedNotCompiling ? "; still not compiling at the end" : ""}`
              : endedNotCompiling
                ? "the run ended on an app that does not compile"
                : "no fault found when the run finished"
          }
        />
      </StatGrid>
      {design?.read && <p className="mt-3 text-sm text-fg-2">Read as: {design.read}</p>}
      {reviews && reviews.length > 0 && (
        <div className="mt-3">
          <Table head={["Verdict", "Screens", "Steps", "Reference", "Capture", "Model", "Routes"]} empty="">
            {reviews.map((r, i) => (
              <tr key={i}>
                <Td>{label(r.verdict)}</Td>
                <Td num>{r.screens}</Td>
                <Td num>{r.steps}</Td>
                <Td>{r.reference ? "yes" : "no"}</Td>
                <Td num>{ms(r.captureMs)}</Td>
                <Td num>{ms(r.modelMs)}</Td>
                <Td mono>{r.routes.join(" ")}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}
