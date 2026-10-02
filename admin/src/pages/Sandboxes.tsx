import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { post } from "@/lib/api";
import { ago, duration, int, label, shortId } from "@/lib/format";
import type { LiveSandboxes } from "@/types";
import {
  Badge,
  ConfirmButton,
  ErrorBox,
  IdLink,
  Loading,
  Muted,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Table,
  Td,
} from "@/components/ui";

/**
 * E2B's list of what is actually running — and billing — joined to our
 * projects. An orphan is a sandbox no project and no live job points at, older
 * than 15 minutes; it is costing money for nothing. Only orphans can be killed
 * here: the server refuses anything a project or a running job owns.
 */
export default function Sandboxes() {
  const { data, error, loading, fetchedAt, reload } = useApi<LiveSandboxes>("/sandboxes/live");
  const [orphansOnly, setOrphansOnly] = useState(false);

  const rows = data?.sandboxes.filter((s) => !orphansOnly || s.orphan) ?? [];

  return (
    <>
      <PageHeader
        title="Sandboxes"
        subtitle={data ? `E2B list from ${ago(data.fetchedAt)} (cached up to 5 minutes)` : "Live E2B sandboxes"}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload({ fresh: true })}
      >
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} className="accent-[var(--accent)]" />
          Orphans only
        </label>
      </PageHeader>

      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && data.status !== "ok" && (
        <ErrorBox message={data.status === "unconfigured" ? "E2B is not configured on the server." : `E2B list failed: ${data.error}`} />
      )}
      {data && data.status === "ok" && (
        <>
          <StatGrid>
            <Stat label="Running" value={int(data.running)} sub={`${int(data.total)} total`} />
            <Stat label="Paused" value={int(data.paused)} sub="no compute billed" />
            <Stat label="Orphans" value={int(data.orphans)} tone={data.orphans ? "warning" : "good"} sub="running, owned by nothing" />
            <Stat label="Stale DB rows" value={int(data.staleDbRows)} tone={data.staleDbRows ? "info" : undefined} sub="READY, but gone from E2B" />
          </StatGrid>
          {data.truncated && (
            <p className="mt-2 text-xs text-warning-text">
              The list hit its 500-sandbox cap, so stale-row detection is off for this snapshot.
            </p>
          )}

          <Section title="Live in E2B" description="Orphans first, then oldest">
            <Table
              head={["Sandbox", "State", "Age", "Expires", "Size", "Owner", "In use by", ""]}
              empty={orphansOnly ? "No orphans." : "No sandboxes running."}
            >
              {rows.map((s) => (
                <tr key={s.sandboxId}>
                  <Td mono>
                    <span title={s.sandboxId}>{s.sandboxId}</span>
                    <div className="mt-0.5 font-sans text-[11px] text-fg-3">{s.name ?? s.templateId}</div>
                  </Td>
                  <Td>
                    {s.orphan ? (
                      <Badge tone="warning">Orphan</Badge>
                    ) : (
                      <Badge tone={s.state === "running" ? "info" : "neutral"} icon={false}>
                        {label(s.state)}
                      </Badge>
                    )}
                  </Td>
                  <Td num>{duration(s.ageMinutes * 60)}</Td>
                  <Td className="text-xs text-fg-2">{ago(s.endAt)}</Td>
                  <Td className="text-xs text-fg-2 whitespace-nowrap">
                    {s.cpuCount} CPU · {s.memoryMB} MB
                  </Td>
                  <Td className="text-xs">
                    {s.project ? (
                      <>
                        <Link to={`/projects/${s.project.id}`} className="text-accent hover:underline">
                          {s.project.name}
                        </Link>
                        <div className="text-fg-3">
                          <Link to={`/users/${s.project.userId}`} className="hover:text-accent">
                            {s.project.email}
                          </Link>
                        </div>
                      </>
                    ) : (
                      <span className="text-fg-3">—</span>
                    )}
                  </Td>
                  <Td>{s.residentJobId ? <IdLink to={`/jobs/${s.residentJobId}`} id={s.residentJobId} /> : <span className="text-fg-3">—</span>}</Td>
                  <Td>
                    {s.orphan && (
                      <ConfirmButton
                        label="Kill"
                        title="Kill this orphan sandbox?"
                        description={
                          <>
                            No project or running job references <code className="font-mono">{shortId(s.sandboxId)}</code>, and it has been up{" "}
                            {duration(s.ageMinutes * 60)}. Killing it stops the E2B billing. Nobody's preview depends on it.
                          </>
                        }
                        typeToConfirm={shortId(s.sandboxId)}
                        onConfirm={async () => {
                          const r = await post<{ killed: boolean }>(`/sandboxes/${encodeURIComponent(s.sandboxId)}/kill`);
                          return r.killed ? "Sandbox killed." : "E2B had already removed it.";
                        }}
                        onDone={() => reload({ fresh: true })}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section
            title="Stale database rows"
            description="These projects say READY, but E2B has no such sandbox. Harmless: they reprovision on next use. But they inflate the live count."
          >
            {data.stale.length === 0 ? (
              <Muted>None. The database agrees with E2B.</Muted>
            ) : (
              <Table head={["Project", "Recorded sandbox", "Last updated"]}>
                {data.stale.map((p) => (
                  <tr key={p.projectId}>
                    <Td>
                      <Link to={`/projects/${p.projectId}`} className="text-accent hover:underline">
                        {p.name}
                      </Link>
                    </Td>
                    <Td mono>{p.sandboxId ?? "—"}</Td>
                    <Td className="text-xs text-fg-2">{ago(p.updatedAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        </>
      )}
    </>
  );
}
