import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MODERATION_RULE_COPY, type ModerationActionDto, type Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { ACTION_LABEL, when } from "../../components/admin/adminCopy.js";

export function AdminActivity() {
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "actions"],
    queryFn: () => api.get<Paginated<ModerationActionDto>>("/admin/actions?limit=50"),
  });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <RowSkeleton count={4} />;
  if (data.items.length === 0) return <EmptyState title="No actions yet" description="Every warning, removal and suspension is recorded here." />;
  return (
    <ul className="divide-y divide-fiber rounded-md border border-fiber bg-paper-raised text-sm">
      {data.items.map((entry) => (
        <li key={entry.id} className="px-4 py-3">
          <span className="font-medium">{ACTION_LABEL[entry.action]}</span>
          {entry.subjectUser && (
            <>
              {" "}
              <Link to={`/admin/users/${entry.subjectUser.id}`} className="text-indigo hover:underline">@{entry.subjectUser.username}</Link>
            </>
          )}
          {entry.rule && ` · ${MODERATION_RULE_COPY[entry.rule].label}`}
          <span className="block text-xs text-ink-faint">by @{entry.staff.username} · {when(entry.createdAt)}</span>
          {entry.note && <span className="block text-ink-soft">{entry.note}</span>}
        </li>
      ))}
    </ul>
  );
}
