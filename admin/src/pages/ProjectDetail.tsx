import { Link, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { ago, credits, dateTime, int, label, num, shortId } from "@/lib/format";
import type { ProjectDetail as ProjectDetailData } from "@/types";
import {
  Badge,
  Card,
  ErrorBox,
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
              </KV>
              <Link to="/sandboxes" className="mt-3 inline-block text-xs text-accent hover:underline">
                Check against live E2B sandboxes
              </Link>
            </Card>
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
