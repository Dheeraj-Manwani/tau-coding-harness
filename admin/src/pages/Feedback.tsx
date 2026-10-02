import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/api";
import { ago, label } from "@/lib/format";
import type { FeedbackPage } from "@/types";
import { Badge, Button, ErrorBox, Loading, Muted, PageHeader } from "@/components/ui";

type Entry = FeedbackPage["entries"][number];

/** What users told us, newest first, 50 at a time. */
export default function Feedback() {
  const first = useApi<FeedbackPage>("/feedback");
  // Pages loaded after the first, tied to the first page they continue. A
  // refresh produces a new first page, which silently discards them.
  const [more, setMore] = useState<{ base?: FeedbackPage; entries: Entry[]; cursor: string | null; busy: boolean; error?: string }>({
    entries: [],
    cursor: null,
    busy: false,
  });
  const extends_ = more.base !== undefined && more.base === first.data;
  const entries = [...(first.data?.entries ?? []), ...(extends_ ? more.entries : [])];
  const cursor = extends_ ? more.cursor : (first.data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!cursor || !first.data) return;
    const base = first.data;
    const prior = extends_ ? more.entries : [];
    setMore((m) => ({ ...m, busy: true, error: undefined }));
    try {
      const page = await api<FeedbackPage>(`/feedback?cursor=${encodeURIComponent(cursor)}`);
      setMore({ base, entries: [...prior, ...page.entries], cursor: page.nextCursor, busy: false });
    } catch (err) {
      setMore((m) => ({ ...m, busy: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <>
      <PageHeader title="Feedback" subtitle="Ratings and suggestions from users" fetchedAt={first.fetchedAt} loading={first.loading} onRefresh={() => first.reload()} />
      {first.error && <ErrorBox message={first.error} onRetry={() => first.reload()} />}
      {!first.data && first.loading && <Loading />}
      {first.data && entries.length === 0 && <Muted>No feedback yet.</Muted>}

      <ul className="space-y-3">
        {entries.map((f) => (
          <li key={f.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Rating value={f.rating} />
              <Badge tone="neutral" icon={false}>{label(f.kind)}</Badge>
              <span className="text-fg-3">from {f.source}</span>
              <Link to={`/users/${f.userId}`} className="text-accent hover:underline">
                {f.user.email}
              </Link>
              {f.projectId && (
                <Link to={`/projects/${f.projectId}`} className="text-fg-3 hover:text-accent">
                  on a project
                </Link>
              )}
              <span className="ml-auto text-fg-3">{ago(f.createdAt)}</span>
            </div>
            {f.message && <p className="mt-2 text-sm whitespace-pre-wrap text-fg">{f.message}</p>}
            {f.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {f.attachments.map((a) =>
                  a.url ? (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline">
                      {a.filename}
                    </a>
                  ) : (
                    <span key={a.id} className="text-xs text-fg-3">{a.filename}</span>
                  ),
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {more.error && <div className="mt-3"><ErrorBox message={more.error} /></div>}
      {cursor && (
        <div className="mt-4">
          <Button onClick={loadMore} disabled={more.busy}>
            {more.busy ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}

function Rating({ value }: { value: number }) {
  const tone = value >= 4 ? "good" : value >= 3 ? "neutral" : "critical";
  return (
    <Badge tone={tone} icon={tone !== "neutral"}>
      <span aria-label={`${value} out of 5`}>
        {"★".repeat(value)}
        <span className="opacity-30">{"★".repeat(Math.max(0, 5 - value))}</span>
      </span>
    </Badge>
  );
}
