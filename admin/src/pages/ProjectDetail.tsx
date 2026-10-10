import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { post } from "@/lib/api";
import { ago, bytes, credits, dateTime, int, label, num, shortId } from "@/lib/format";
import type { ProjectDetail as ProjectDetailData, StorageFilesPage } from "@/types";
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
  ReasonButton,
  Section,
  Stat,
  StatGrid,
  Table,
  Td,
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
            <StorageCard project={data.project} onChange={() => reload()} />
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

/** The reason is required: the owner reads it in their Publish panel. */
function SuspendSiteButton({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  return (
    <ReasonButton
      label="Suspend site"
      title="Suspend this site?"
      description={
        <>
          Every page at its address shows &quot;This site has been suspended&quot; within seconds, and the owner cannot publish or roll back
          until it is lifted. Its stored files are suspended with it: no uploads and no download addresses. Nothing is deleted.
        </>
      }
      hint="Reason (the owner sees this in their Publish panel)"
      placeholder="e.g. This page imitates a bank sign-in form."
      confirmLabel="Suspend site"
      busyLabel="Suspending…"
      endpoint={`/projects/${projectId}/site/suspend`}
      onDone={onDone}
    />
  );
}

/**
 * The files this app has stored with tau Cloud Storage: whether it is on, the
 * one control (suspend or resume, files kept) and, on request, the files
 * themselves with a takedown per file. Both need a reason, which goes to the log
 * with the admin id.
 */
function StorageCard({ project, onChange }: { project: ProjectDetailData["project"]; onChange: () => void }) {
  const [env, setEnv] = useState<"PREVIEW" | "LIVE">("PREVIEW");
  const [showFiles, setShowFiles] = useState(false);
  const files = useApi<StorageFilesPage>(showFiles ? `/projects/${project.id}/storage/files?env=${env}&limit=100` : null);
  const suspended = Boolean(project.storageSuspendedAt);
  const state = suspended
    ? ({ tone: "critical", text: "Suspended" } as const)
    : project.storageEnabled
      ? ({ tone: "good", text: "On" } as const)
      : ({ tone: "neutral", text: "Not used" } as const);

  return (
    <Card
      title="File storage"
      action={
        suspended ? (
          <ConfirmButton
            label="Resume storage"
            title="Resume this app's storage?"
            description="The app can upload files and open them again right away. Nothing was deleted, so there is nothing to restore."
            variant="primary"
            closeOnSuccess
            onConfirm={async () => {
              await post(`/projects/${project.id}/storage/resume`);
            }}
            onDone={onChange}
          />
        ) : (
          <ReasonButton
            label="Suspend storage"
            title="Suspend this app's storage?"
            description="The app can no longer upload files or get download addresses for them, and the owner's Storage pane says it is suspended. Every file is kept."
            hint="Reason (kept in the log with your id)"
            placeholder="e.g. Stores a phishing kit reported on 2026-10-10."
            confirmLabel="Suspend storage"
            busyLabel="Suspending…"
            endpoint={`/projects/${project.id}/storage/suspend`}
            onDone={onChange}
          />
        )
      }
    >
      <KV>
        <Row k="Status"><Badge tone={state.tone}>{state.text}</Badge></Row>
        {suspended && <Row k="Suspended">{dateTime(project.storageSuspendedAt!)} ({ago(project.storageSuspendedAt!)})</Row>}
      </KV>
      <div className="mt-3 flex items-center gap-2">
        <Button className="px-2 py-1 text-xs" onClick={() => setShowFiles((v) => !v)}>
          {showFiles ? "Hide files" : "Show files"}
        </Button>
        {showFiles && (
          <select className={inputClass} value={env} onChange={(e) => setEnv(e.target.value as "PREVIEW" | "LIVE")} aria-label="Environment">
            <option value="PREVIEW">Preview</option>
            <option value="LIVE">Live</option>
          </select>
        )}
      </div>
      {showFiles && (
        <div className="mt-3">
          {files.error && <ErrorBox message={files.error} onRetry={() => files.reload()} />}
          {files.loading && !files.data && <Loading />}
          {files.data && (
            <Table head={["File", "Type", "Size", "Uploaded", ""]} empty="No files.">
              {files.data.files.map((f) => (
                <tr key={f.id}>
                  <Td mono className="break-all">{f.key}</Td>
                  <Td className="text-xs text-fg-3">{f.contentType}</Td>
                  <Td num>{bytes(f.size)}</Td>
                  <Td className="text-xs text-fg-3">{dateTime(f.createdAt)}</Td>
                  <Td>
                    <ReasonButton
                      label="Delete"
                      title="Delete this file?"
                      description={<span className="break-all font-mono text-xs">{f.key}</span>}
                      hint="Reason (kept in the log with your id)"
                      placeholder="e.g. Malware reported by a visitor."
                      confirmLabel="Delete file"
                      busyLabel="Deleting…"
                      endpoint={`/projects/${project.id}/storage/files/delete`}
                      extraBody={{ env, key: f.key }}
                      onDone={() => files.reload()}
                    />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {files.data?.nextCursor && <p className="mt-2 text-xs text-fg-3">Showing the first 100 files.</p>}
        </div>
      )}
    </Card>
  );
}
