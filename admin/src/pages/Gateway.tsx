import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { credits, num } from "@/lib/format";
import type { GatewayOverview } from "@/types";
import { Badge, ErrorBox, Loading, PageHeader, Section, Stat, StatGrid, Table, Td, inputClass } from "@/components/ui";

const WINDOWS = [
  [1, "Last hour"],
  [6, "Last 6 hours"],
  [24, "Last 24 hours"],
  [72, "Last 3 days"],
  [168, "Last 7 days"],
  [720, "Last 30 days"],
] as const;

/**
 * Runtime inference: deployed apps calling an LLM on their owner's credits.
 * Ordered by spend rather than request count. Fifty tau-max calls matter more
 * than a thousand tau-fast ones. The abuse-triage view.
 */
export default function Gateway() {
  const [params, setParams] = useSearchParams();
  const hours = Number(params.get("hours") ?? 24);
  const { data, error, loading, fetchedAt, reload } = useApi<GatewayOverview>(`/gateway?hours=${hours}`);

  return (
    <>
      <PageHeader title="AI gateway" subtitle="Inference from published apps, by key and model alias" fetchedAt={fetchedAt} loading={loading} onRefresh={() => reload()}>
        <select className={inputClass} value={hours} onChange={(e) => setParams({ hours: e.target.value })} aria-label="Window">
          {WINDOWS.map(([h, text]) => (
            <option key={h} value={h}>
              {text}
            </option>
          ))}
        </select>
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          <StatGrid>
            <Stat label="Requests" value={num(data.totals.requests)} />
            <Stat label="Credits" value={credits(data.totals.credits)} />
            <Stat label="Keys with traffic" value={num(data.topKeys.length)} sub={data.topKeys.length === 50 ? "top 50 shown" : undefined} />
            <Stat
              label="Credits per request"
              value={data.totals.requests ? credits(data.totals.credits / data.totals.requests) : "—"}
            />
          </StatGrid>

          <div className="grid gap-3 xl:grid-cols-[1fr_2fr]">
            <Section title="By model alias">
              <Table head={["Alias", "Requests", "Credits"]} empty="No traffic.">
                {data.byAlias
                  .slice()
                  .sort((a, b) => b.credits - a.credits)
                  .map((a) => (
                    <tr key={a.alias}>
                      <Td mono>{a.alias}</Td>
                      <Td num>{num(a.requests)}</Td>
                      <Td num>{credits(a.credits)}</Td>
                    </tr>
                  ))}
              </Table>
            </Section>
            <Section title="Top keys by spend">
              <Table head={["Key", "Status", "Owner", "Requests", "Tokens", "Credits"]} empty="No traffic.">
                {data.topKeys.map((k) => (
                  <tr key={k.apiKeyId}>
                    <Td mono>{k.prefix ?? k.apiKeyId.slice(0, 8)}</Td>
                    <Td>
                      <Badge tone={k.status === "ACTIVE" ? "good" : k.status === "REVOKED" ? "neutral" : "warning"} icon={k.status !== "REVOKED"}>
                        {k.status ?? "unknown"}
                      </Badge>
                    </Td>
                    <Td>
                      <Link to={`/users/${k.userId}`} className="font-mono text-xs text-accent hover:underline">
                        {k.userId.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td num>{num(k.requests)}</Td>
                    <Td num>{num(k.inputTokens + k.outputTokens)}</Td>
                    <Td num className="font-medium">{credits(k.credits)}</Td>
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
