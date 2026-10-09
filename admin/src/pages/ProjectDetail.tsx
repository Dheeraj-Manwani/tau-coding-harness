import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { post } from "@/lib/api";
import { ago, credits, dateTime, int, label, num, shortId } from "@/lib/format";
import type { ProjectDetail as ProjectDetailData } from "@/types";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBox,
  ExternalLink,
  IdLink,
  JobStatusBadge,
  KV,
  Row,
  Loading,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Table,
  Td,
  ToneIcon,
  inputClass,
} from "@/components/ui";
import { JobLinks } from "./Jobs";

const SANDBOX_TONE = { READY: "good", PROVISIONING: "warning", DEAD: "critical", HIBERNATED: "neutral", NONE: "neutral" } as const;

export default function ProjectDetail() {
  const { id = "" } = useParams();
  const { data, error, loading, fetchedAt, reload } = useApi<ProjectDetailData>(`/projects/${id}`);

  return (
    <>
      <PageHeader
        title={data?.project.name ?? `Project ${shortId(id)}`}
        subtitle={<span className="font-mono text-xs">{id}</span>}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload()}
      />
      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          <StatGrid>
            <Stat label="Files" value={int(data.fileCount)} />
            <Stat label="Messages" value={int(data.messageCount)} />
            <Stat label="Jobs (recent)" value={int(data.jobs.length)} sub={`${data.jobs.filter((j) => j.status === "FAILED").length} failed`} />
            <Stat label="Compactions" value={int(data.checkpoints.length)} />
            <Stat label="Updated" value={ago(data.project.updatedAt)} sub={`created ${ago(data.project.createdAt)}`} />
          </StatGrid>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card title="Project">
              <KV>
                <Row k="Owner"><Link className="font-mono text-xs text-accent hover:underline" to={`/users/${data.project.userId}`}>{data.project.userId}</Link></Row>
                <Row k="Template">{data.project.templateKey}</Row>
                <Row k="GitHub">{data.project.githubRepo ?? "—"}</Row>
                <Row k="Created">{dateTime(data.project.createdAt)}</Row>
              </KV>
              <div className="mt-3">
                <JobLinks projectId={data.project.id} />
              </div>
            </Card>
            <Card title="Sandbox">
              <KV>
                <Row k="Status"><Badge tone={SANDBOX_TONE[data.project.sandboxStatus as keyof typeof SANDBOX_TONE] ?? "neutral"}>{label(data.project.sandboxStatus)}</Badge></Row>
                <Row k="Id"><span className="font-mono text-xs">{data.project.sandboxId ?? "—"}</span></Row>
                <Row k="Expires">{data.project.sandboxExpiresAt ? `${dateTime(data.project.sandboxExpiresAt)} (${ago(data.project.sandboxExpiresAt)})` : "—"}</Row>
                <Row k="Preview">
                  {data.project.previewUrl ? <ExternalLink href={data.project.previewUrl}>Open live preview</ExternalLink> : <span className="text-fg-3">No live sandbox</span>}
                </Row>
              </KV>
              <Link to="/sandboxes" className="mt-3 inline-block text-xs text-accent hover:underline">
                Check against live E2B sandboxes
              </Link>
            </Card>
            <PublishedSiteCard project={data.project} onChange={() => reload()} />
          </div>

          <Section title="Recent jobs">
            <Table head={["Job", "Status", "Ended", "Effort", "Turns", "Credits", "Queued"]} empty="No jobs.">
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <Td>
                    <IdLink to={`/jobs/${j.id}`} id={j.id} />
                  </Td>
                  <Td>
                    <JobStatusBadge status={j.status} />
                  </Td>
                  <Td className="text-xs text-fg-2">{label(j.finishReason)}</Td>
                  <Td className="text-xs text-fg-2">{label(j.effort)}</Td>
                  <Td num>{j.currentTurn}</Td>
                  <Td num>{credits(j.credits)}</Td>
                  <Td className="text-xs text-fg-2">{ago(j.queuedAt)}</Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Context checkpoints" description="Each one is the agent compacting a long conversation">
            <Table head={["Up to message", "Tokens before", "Tokens after", "Saved", "At"]} empty="Never compacted.">
              {data.checkpoints.map((c) => (
                <tr key={c.upToSequence}>
                  <Td num>{c.upToSequence}</Td>
                  <Td num>{num(c.tokensBefore)}</Td>
                  <Td num>{num(c.tokensAfter)}</Td>
                  <Td num>{c.tokensBefore > 0 ? `${Math.round((1 - c.tokensAfter / c.tokensBefore) * 100)}%` : "—"}</Td>
                  <Td className="text-xs text-fg-3">{dateTime(c.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}
    </>
  );
}

/**
 * The project's public address and the one thing an operator does to it:
 * suspend it. Shown for a project that has never published too, so "is there
 * anything public here" has an answer either way.
 */
function PublishedSiteCard({ project, onChange }: { project: ProjectDetailData["project"]; onChange: () => void }) {
  const suspended = Boolean(project.siteSuspendedAt);
  const state = suspended
    ? ({ tone: "critical", text: "Suspended" } as const)
    : project.liveDeploymentId
      ? ({ tone: "good", text: "Live" } as const)
      : ({ tone: "neutral", text: project.slug ? "Offline" : "Never published" } as const);

  return (
    <Card
      title="Published site"
      action={
        project.slug &&
        (suspended ? (
          <ConfirmButton
            label="Lift suspension"
            title="Put this site back?"
            description="The address goes back to serving whatever build was live when it was suspended, and the owner can publish again. Nothing was deleted, so there is nothing to restore."
            variant="primary"
            closeOnSuccess
            onConfirm={async () => {
              await post(`/projects/${project.id}/site/unsuspend`);
            }}
            onDone={onChange}
          />
        ) : (
          <SuspendSiteButton projectId={project.id} onDone={onChange} />
        ))
      }
    >
      <KV>
        <Row k="Status"><Badge tone={state.tone}>{state.text}</Badge></Row>
        <Row k="Address">
          {project.siteUrl ? <ExternalLink href={project.siteUrl}>{project.slug}</ExternalLink> : <span className="text-fg-3">—</span>}
        </Row>
        {suspended && (
          <>
            <Row k="Suspended">{dateTime(project.siteSuspendedAt!)} ({ago(project.siteSuspendedAt!)})</Row>
            <Row k="Reason"><span className="break-words">{project.siteSuspendedReason ?? "—"}</span></Row>
          </>
        )}
      </KV>
    </Card>
  );
}

/** A dialog taking the reason, then POSTs the suspension. The reason is required: the owner reads it. */
function SuspendSiteButton({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const succeeded = useRef(false);

  const open = () => {
    setReason("");
    setError(undefined);
    succeeded.current = false;
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();

  const run = async () => {
    setBusy(true);
    try {
      await post(`/projects/${projectId}/site/suspend`, { reason: reason.trim() });
      succeeded.current = true;
      ref.current?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="danger" onClick={open} className="px-2 py-1 text-xs">
        Suspend site
      </Button>
      <dialog
        ref={ref}
        onClose={() => succeeded.current && onDone()}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-left text-sm font-normal whitespace-normal text-fg shadow-2xl"
      >
        <div className="p-5">
          <h3 className="text-base font-semibold">Suspend this site?</h3>
          <p className="mt-2 text-sm text-fg-2">
            Every page at its address shows "This site has been suspended" within seconds, and the owner can't publish or roll back until it is lifted. Nothing is deleted.
          </p>
          <label className="mt-4 block text-xs text-fg-2">
            Reason (the owner sees this in their Publish panel)
            <textarea
              className={`${inputClass} mt-1.5 w-full resize-y`}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              placeholder="e.g. This page imitates a bank's sign-in form."
            />
          </label>
          {error && (
            <div className="mt-4 flex items-start gap-2 text-sm text-critical-text" role="status">
              <ToneIcon tone="critical" className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="danger" disabled={!reason.trim() || busy} onClick={run}>
              {busy ? "Suspending…" : "Suspend site"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
