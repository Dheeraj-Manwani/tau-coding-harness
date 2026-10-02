import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { ago, int, label } from "@/lib/format";
import type { UserSearchRow } from "@/types";
import { Badge, Button, ErrorBox, Loading, PageHeader, Table, Td, inputClass } from "@/components/ui";

/** Find an account by email fragment or exact id. Empty search lists the newest sign-ups. */
export default function Users() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const { data, error, loading, fetchedAt, reload } = useApi<UserSearchRow[]>(`/users?q=${encodeURIComponent(q)}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    setParams(next ? { q: next } : {});
  };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={q ? `Matches for "${q}"` : "Newest sign-ups"}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={() => reload()}
      />
      <form onSubmit={submit} className="mb-4 flex max-w-xl gap-2" role="search">
        <input
          className={`${inputClass} flex-1`}
          placeholder="Email or user id"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {error && <ErrorBox message={error} onRetry={() => reload()} />}
      {!data && loading && <Loading />}
      {data && (
        <Table head={["Email", "Name", "Plan", "Projects", "Verified", "Joined"]} empty="No accounts match.">
          {data.map((u) => (
            <tr key={u.id}>
              <Td>
                <Link to={`/users/${u.id}`} className="text-accent hover:underline">
                  {u.email}
                </Link>
                {u.role === "ADMIN" && (
                  <span className="ml-2">
                    <Badge tone="info" icon={false}>Admin</Badge>
                  </span>
                )}
              </Td>
              <Td className="text-fg-2">{u.displayName ?? "—"}</Td>
              <Td>
                <Badge tone={u.plan === "PRO" ? "info" : "neutral"} icon={false}>
                  {label(u.plan ?? "none")}
                </Badge>
              </Td>
              <Td num>{int(u.projects)}</Td>
              <Td className="text-xs text-fg-2">{u.emailVerifiedAt ? "Yes" : "No"}</Td>
              <Td className="text-xs text-fg-2">{ago(u.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      {data && data.length === 20 && <p className="mt-2 text-xs text-fg-3">Showing 20. Search more precisely to narrow it down.</p>}
    </>
  );
}
