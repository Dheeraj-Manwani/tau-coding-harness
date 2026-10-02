import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { post } from "@/lib/api";
import { credits, duration, int, label, num, shortId } from "@/lib/format";
import type { JobListItem } from "@/types";
import { ConfirmButton, ErrorBox, IdLink, JobStatusBadge, Loading, PageHeader, Table, Td, inputClass } from "@/components/ui";

const STATUSES = [
  ["active", "Active (queued + running)"],
  ["all", "All"],
  ["RUNNING", "Running"],
  ["QUEUED", "Queued"],
  ["FAILED", "Failed"],
  ["COMPLETED", "Completed"],
  ["CANCELLED", "Cancelled"],
] as const;

/**
 * Jobs, filtered by URL so a filtered view is a shareable link. The default —
 * everything still claiming to run, oldest first — floats a stuck job to the
 * top without anyone looking for it.
 */
export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const userId = params.get("userId");
  const projectId = params.get("projectId");

  const query = new URLSearchParams({ status, limit: "100" });
  if (userId) query.set("userId", userId);
  if (projectId) query.set("projectId", projectId);
  const { data, error, loading, fetchedAt, reload } = useApi<JobListItem[]>(`/jobs?${query}`);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Jobs" subtitle="Builds, previews and publishes" fetchedAt={fetchedAt} loading={loading} onRefresh={() => reload()}>
        <select className={inputClass} value={status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          {STATUSES.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </PageHeader>

      {(userId || projectId) && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {userId && <FilterChip label={`user ${shortId(userId)}`} onClear={() => set("userId", null)} />}
          {projectId && <FilterChip label={`project ${shortId(projectId)}`} onClear={() => set("projectId", null)} />}
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && (
        <Table
          head={["Job", "Status", "Phase", "Kind", "Turn", "Age", "Heartbeat", "Tokens", "Credits", "Ended", "User", ""]}
          empty={status === "active" ? "Nothing running. The runner is idle." : "No jobs match."}
        >
          {data.map((j) => {
            const active = j.status === "QUEUED" || j.status === "RUNNING";
            return (
              <tr key={j.id}>
                <Td>
                  <IdLink to={`/jobs/${j.id}`} id={j.id} />
                </Td>
                <Td>
                  <JobStatusBadge status={j.status} stuck={j.stuck} />
                </Td>
                <Td className="text-xs">
                  {j.live ? (
                    <>
                      <span className="font-mono text-accent">{j.live.phase}</span>{" "}
                      <span className="text-fg-3">{duration(j.live.phaseAgeSeconds)}</span>
                    </>
                  ) : (
                    <span className="text-fg-3">—</span>
                  )}
                </Td>
                <Td className="text-xs text-fg-2">
                  {label(j.type)} · {label(j.effort)}
                </Td>
                <Td num>{j.currentTurn}</Td>
                <Td num>{duration(j.ageSeconds)}</Td>
                <Td num className={j.stuck ? "text-critical-text" : ""}>{duration(j.heartbeatAgeSeconds)}</Td>
                <Td num>{num(j.inputTokens + j.outputTokens)}</Td>
                <Td num>{credits(j.credits)}</Td>
                <Td className="text-xs text-fg-2">{label(j.finishReason)}</Td>
                <Td>{j.userId ? <IdLink to={`/users/${j.userId}`} id={j.userId} /> : "—"}</Td>
                <Td>
                  {active && (
                    <ConfirmButton
                      label="Kill"
                      title="Force-terminate this job?"
                      description={
                        <>
                          The user's run stops now and its credit hold settles. A job this process is running is
                          cancelled cleanly; an orphaned one is marked failed.
                        </>
                      }
                      typeToConfirm={shortId(j.id)}
                      onConfirm={async () => {
                        const r = await post<{ killed: boolean }>(`/jobs/${j.id}/kill`);
                        return r.killed ? "Job terminated." : "It had already finished.";
                      }}
                      onDone={() => reload()}
                    />
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {data && data.length >= 100 && <p className="mt-2 text-xs text-fg-3">Showing the first {int(data.length)}. Narrow by status or user.</p>}
    </>
  );
}

function FilterChip({ label: text, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-accent">
      {text}
      <button type="button" onClick={onClear} className="ml-1 hover:text-fg" aria-label={`Clear ${text}`}>
        ×
      </button>
    </span>
  );
}

export function JobLinks({ userId, projectId }: { userId?: string | null; projectId?: string | null }) {
  return (
    <span className="inline-flex gap-3 text-xs">
      {userId && (
        <Link className="text-accent hover:underline" to={`/jobs?status=all&userId=${userId}`}>
          All jobs for this user
        </Link>
      )}
      {projectId && (
        <Link className="text-accent hover:underline" to={`/jobs?status=all&projectId=${projectId}`}>
          All jobs for this project
        </Link>
      )}
    </span>
  );
}
