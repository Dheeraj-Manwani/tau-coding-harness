import { Link, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { post } from "@/lib/api";
import { ago, credits, dateTime, int, label, num, shortId } from "@/lib/format";
import type { UserDetail as UserDetailData } from "@/types";
import {
  Badge,
  Card,
  ConfirmButton,
  ErrorBox,
  IdLink,
  JobStatusBadge,
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
} from "@/components/ui";
import { JobLinks } from "./Jobs";

/**
 * Everything a support question needs about one account: which credit pot ran
 * out, what's holding their job slots, what they built and what their
 * deployed apps are spending. Never a key or ciphertext — prefixes only.
 */
export default function UserDetail() {
  const { id = "" } = useParams();
  const { data, error, loading, fetchedAt, reload } = useApi<UserDetailData>(`/users/${id}`);

  return (
    <>
      <PageHeader
        title={data?.user.email ?? `User ${shortId(id)}`}
        subtitle={<span className="font-mono text-xs">{id}</span>}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload()}
      />
      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && <Body d={data} onChange={() => reload()} />}
    </>
  );
}

function Body({ d, onChange }: { d: UserDetailData; onChange: () => void }) {
  const b = d.billing;
  return (
    <>
      <StatGrid>
        <Stat label="Plan" value={b ? label(b.plan) : "—"} sub={b?.cycleEnd ? `cycle ends ${dateTime(b.cycleEnd)}` : undefined} />
        <Stat label="Available credits" value={credits(b?.availableCredits)} tone={b && b.availableCredits <= 0 ? "warning" : undefined} sub={`${credits(b?.reservedCredits)} reserved`} />
        <Stat label="Free" value={credits(b?.freeCredits)} sub="sign-up grant" />
        <Stat label="Plan pot" value={credits(b?.planCredits)} sub="resets monthly" />
        <Stat label="Bonus" value={credits(b?.bonusCredits)} sub="promos, top-ups" />
        <Stat label="Projects" value={int(d.projects)} sub={`joined ${ago(d.user.createdAt)}`} />
      </StatGrid>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Account">
          <KV>
            <Row k="Email">{d.user.email}</Row>
            <Row k="Name">{d.user.displayName ?? "—"}</Row>
            <Row k="Role">{d.user.role === "ADMIN" ? <Badge tone="info" icon={false}>Admin</Badge> : "User"}</Row>
            <Row k="Verified">{d.user.emailVerifiedAt ? dateTime(d.user.emailVerifiedAt) : "No"}</Row>
            <Row k="Joined">{dateTime(d.user.createdAt)}</Row>
          </KV>
          <div className="mt-3">
            <JobLinks userId={d.user.id} />
          </div>
        </Card>
        <Card
          title={`Active credit holds (${d.activeHolds.length})`}
          action={
            d.activeHolds.length > 0 && (
              <ConfirmButton
                label="Release all"
                title="Free every job slot this user holds?"
                description="Running jobs are cancelled; holds left behind by jobs that are already gone are settled. Use this when the user is told they already have a job running but nothing is."
                onConfirm={async () => {
                  const r = await post<{ released: number }>(`/users/${d.user.id}/holds/release`);
                  return `Released ${r.released} hold(s).`;
                }}
                onDone={onChange}
              />
            )
          }
        >
          {d.activeHolds.length === 0 ? (
            <Muted>No holds. All job slots are free.</Muted>
          ) : (
            <ul className="space-y-2">
              {d.activeHolds.map((h) => (
                <li key={h.jobId} className="flex flex-wrap items-center gap-2 text-sm">
                  <IdLink to={`/jobs/${h.jobId}`} id={h.jobId} />
                  <Badge tone={h.resident ? "info" : "warning"}>{h.resident ? "Running here" : "No live job"}</Badge>
                  <span className="text-xs text-fg-3">
                    {credits(Number(h.consumed) / 1e6)} of {credits(Number(h.amount) / 1e6)} used · {ago(h.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Section title="Projects" description="Most recently active first">
        <Table head={["Project", "Template", "Sandbox", "Published", "Updated"]} empty="No projects.">
          {d.projectList.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link to={`/projects/${p.id}`} className="text-accent hover:underline">
                  {p.name}
                </Link>
              </Td>
              <Td className="text-xs text-fg-2">{p.templateKey}</Td>
              <Td className="text-xs text-fg-2">{label(p.sandboxStatus)}</Td>
              <Td className="text-xs">{p.liveDeploymentId ? <Badge tone="good">{p.slug ?? "live"}</Badge> : <span className="text-fg-3">—</span>}</Td>
              <Td className="text-xs text-fg-2">{ago(p.updatedAt)}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Recent jobs">
        <Table head={["Job", "Status", "Ended", "Effort", "Turns", "Credits", "Queued"]} empty="No jobs yet.">
          {d.recentJobs.map((j) => (
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

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Build tokens (7d)">
          <Table head={["Model", "In", "Out"]} empty="No builds this week.">
            {d.spend7dByModel.map((s) => (
              <tr key={s.model}>
                <Td mono>{s.model}</Td>
                <Td num>{num(s.inputTokens)}</Td>
                <Td num>{num(s.outputTokens)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Deployed-app AI usage (7d)" description="Spend from their published apps through the AI gateway">
          <Table head={["Alias", "Requests", "Tokens", "Credits"]} empty="No gateway traffic this week.">
            {d.gatewaySpend7dByAlias.map((g) => (
              <tr key={g.alias}>
                <Td mono>{g.alias}</Td>
                <Td num>{num(g.requests)}</Td>
                <Td num>{num(g.inputTokens + g.outputTokens)}</Td>
                <Td num>{credits(g.credits)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>

      <Section title="API keys" description="Prefixes only. The key itself is never shown here.">
        <Table head={["Prefix", "Status", "Daily cap", "Last used", "Created", "Revoke after"]} empty="No keys.">
          {d.apiKeys.map((k) => (
            <tr key={k.id}>
              <Td mono>{k.prefix}</Td>
              <Td>
                <Badge tone={k.status === "ACTIVE" ? "good" : k.status === "ROTATING" ? "warning" : "neutral"}>{label(k.status)}</Badge>
              </Td>
              <Td num>{k.dailyCapCredits === null ? "default" : credits(k.dailyCapCredits)}</Td>
              <Td className="text-xs text-fg-2">{ago(k.lastUsedAt)}</Td>
              <Td className="text-xs text-fg-2">{dateTime(k.createdAt)}</Td>
              <Td className="text-xs text-fg-2">{k.revokeAfter ? dateTime(k.revokeAfter) : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
