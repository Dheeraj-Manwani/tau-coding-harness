import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { ago, dateTime, int, time } from "@/lib/format";
import type { ErrorSummary } from "@/types";
import { Badge, Button, ErrorBox, JsonBlock, Loading, Muted, PageHeader, Section, Stat, StatGrid, Table, Td, inputClass } from "@/components/ui";

/**
 * Warn and error lines this process has logged, grouped by what failed rather
 * than by when. Fields were scrubbed by the logger before they ever got here,
 * so prompts and file contents never appear. In-memory: it resets on deploy.
 * The log drain is the long-term history.
 */
export default function Errors() {
  const { data, error, loading, fetchedAt, reload } = useApi<ErrorSummary>("/errors");
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<"all" | "error" | "warn">("all");
  const [open, setOpen] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const groups = (data?.groups ?? []).filter(
    (g) => (level === "all" || g.level === level) && (!q || g.event.toLowerCase().includes(q) || g.message.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Errors"
        subtitle={data ? `Since this process started at ${time(data.trackingSince)} · resets on deploy` : "Grouped warnings and errors"}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload()}
      >
        <input className={`${inputClass} w-48`} placeholder="Filter event or message" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Level">
          <option value="all">All levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
        </select>
      </PageHeader>

      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          <StatGrid>
            <Stat label="Errors (15m)" value={int(data.last15m.errors)} tone={data.last15m.errors > 20 ? "warning" : undefined} />
            <Stat label="Warnings (15m)" value={int(data.last15m.warns)} />
            <Stat label="Errors (60m)" value={int(data.last60m.errors)} />
            <Stat label="Distinct problems" value={int(data.groups.length)} sub="fingerprints tracked" />
          </StatGrid>

          <Section title="By problem" description="Same event with the same message, ids and numbers ignored. Most recent first.">
            <Table head={["Level", "Count", "Event", "Message", "Last seen", "First seen", ""]} empty={q || level !== "all" ? "Nothing matches." : "No warnings or errors yet."}>
              {groups.flatMap((g) => {
                const rows = [
                  <tr key={g.fingerprint}>
                    <Td>
                      <Badge tone={g.level === "error" ? "critical" : "warning"}>{g.level === "error" ? "Error" : "Warning"}</Badge>
                    </Td>
                    <Td num className="font-medium">{int(g.count)}</Td>
                    <Td mono>{g.event}</Td>
                    <Td className="max-w-[28rem] text-xs text-fg-2">
                      <span className="line-clamp-2 break-words" title={g.message}>{g.message || "—"}</span>
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-fg-2">{ago(g.lastSeen)}</Td>
                    <Td className="text-xs whitespace-nowrap text-fg-3">{ago(g.firstSeen)}</Td>
                    <Td>
                      <Button className="px-2 py-1 text-xs" onClick={() => setOpen(open === g.fingerprint ? null : g.fingerprint)}>
                        {open === g.fingerprint ? "Hide" : "Context"}
                      </Button>
                    </Td>
                  </tr>,
                ];
                if (open === g.fingerprint) {
                  rows.push(
                    <tr key={`${g.fingerprint}:ctx`}>
                      <td colSpan={7} className="bg-surface-2/40 px-3 py-3">
                        <div className="mb-2 text-xs text-fg-3">
                          Latest occurrence · {g.svc} · {dateTime(g.lastSeen)}
                        </div>
                        <JsonBlock value={g.lastFields} summary="Fields" open />
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </Table>
          </Section>

          <Section title="Most recent" description="The last 200 lines, newest first">
            {data.recent.length === 0 ? (
              <Muted>Nothing logged yet.</Muted>
            ) : (
              <Table head={["When", "Level", "Event", "Message"]}>
                {data.recent.slice(0, 100).map((r, i) => (
                  <tr key={`${r.ts}:${i}`}>
                    <Td className="text-xs whitespace-nowrap text-fg-3">{time(r.ts)}</Td>
                    <Td>
                      <Badge tone={r.level === "error" ? "critical" : "warning"}>{r.level === "error" ? "Error" : "Warning"}</Badge>
                    </Td>
                    <Td mono>{r.event}</Td>
                    <Td className="max-w-[36rem] truncate text-xs text-fg-2" >
                      <span title={r.message}>{r.message || "—"}</span>
                    </Td>
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
