import { Link } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { bytes, dateTime, num, pct } from "@/lib/format";
import type { StorageOverview } from "@/types";
import { Badge, ErrorBox, IdLink, Loading, PageHeader, Section, Stat, StatGrid, Table, Td } from "@/components/ui";

/**
 * Tau Cloud Storage across every project: how much is kept, who keeps it, who is
 * close to their allowance, and how fast files are arriving. The abuse-triage
 * view; a project's own controls (suspend, files, takedown) are on its page.
 */
export default function Storage() {
  const { data, error, loading, fetchedAt, reload } = useApi<StorageOverview>("/storage");
  const busiest = data?.busiestProject;
  const peak = Math.max(1, ...(data?.uploadsPerHour.map((h) => h.uploads) ?? [0]));

  return (
    <>
      <PageHeader title="File storage" subtitle="What apps keep with tau Cloud Storage" fetchedAt={fetchedAt} loading={loading} onRefresh={() => reload()} />
      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          {!data.configured && (
            <p className="mb-3 text-sm text-fg-2">
              This server has no storage bucket configured (<code className="font-mono">R2_STORAGE_BUCKET</code>), so apps cannot use storage. Any figures below are from earlier use.
            </p>
          )}
          <StatGrid>
            <Stat label="Stored" value={bytes(data.totals.usedBytes)} sub="including pending" />
            <Stat label="Files" value={num(data.totals.files)} />
            <Stat label="Projects" value={num(data.totals.projects)} sub={`${num(data.totals.owners)} owners`} />
            <Stat
              label="Busiest project, last hour"
              value={busiest ? num(busiest.uploads) : "0"}
              sub={busiest ? "files created" : undefined}
              to={busiest ? `/projects/${busiest.projectId}` : undefined}
            />
          </StatGrid>

          <div className="grid gap-3 xl:grid-cols-2">
            <Section title="Near the allowance" description="Owners at 80% or more of their plan's storage">
              <Table head={["Owner", "Used", "Allowance", "Share"]} empty="Nobody is near their allowance.">
                {data.nearAllowance.map((o) => (
                  <tr key={o.userId}>
                    <Td><IdLink to={`/users/${o.userId}`} id={o.userId} /></Td>
                    <Td num>{bytes(o.usedBytes)}</Td>
                    <Td num>{bytes(o.quotaBytes)}</Td>
                    <Td num><Badge tone={o.ratio >= 1 ? "critical" : "warning"}>{pct(o.ratio, 0)}</Badge></Td>
                  </tr>
                ))}
              </Table>
            </Section>
            <Section title="Files created per hour" description="Last 24 hours, counting files still stored">
              <Table head={["Hour", "Files", ""]} empty="Nothing uploaded in the last day.">
                {data.uploadsPerHour.map((h) => (
                  <tr key={h.hour}>
                    <Td className="text-xs text-fg-3">{dateTime(h.hour)}</Td>
                    <Td num>{num(h.uploads)}</Td>
                    <Td>
                      <div className="h-2 rounded bg-accent" style={{ width: `${Math.max(2, (h.uploads / peak) * 100)}%` }} aria-hidden />
                    </Td>
                  </tr>
                ))}
              </Table>
            </Section>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Section title="Largest projects">
              <Table head={["Project", "Owner", "Files", "Stored", "State"]} empty="Nothing stored.">
                {data.topProjects.map((p) => (
                  <tr key={p.projectId}>
                    <Td>
                      <Link to={`/projects/${p.projectId}`} className="text-accent hover:underline">
                        {p.name ?? p.projectId.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td>{p.userId ? <IdLink to={`/users/${p.userId}`} id={p.userId} /> : "—"}</Td>
                    <Td num>{num(p.files)}</Td>
                    <Td num className="font-medium">{bytes(p.usedBytes)}</Td>
                    <Td>{p.suspended ? <Badge tone="critical">Suspended</Badge> : <span className="text-fg-3">—</span>}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
            <Section title="Largest owners">
              <Table head={["Owner", "Files", "Stored", "Share of allowance"]} empty="Nothing stored.">
                {data.topOwners.map((o) => (
                  <tr key={o.userId}>
                    <Td><IdLink to={`/users/${o.userId}`} id={o.userId} /></Td>
                    <Td num>{num(o.files)}</Td>
                    <Td num className="font-medium">{bytes(o.usedBytes)}</Td>
                    <Td num>{pct(o.ratio, 0)}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
          </div>
        </>
      )}
    </>
  );
}
