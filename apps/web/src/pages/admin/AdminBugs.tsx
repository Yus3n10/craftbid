import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminBugReportDto, Paginated } from "@craftbid/shared";
import { api, loadPrivateUrl } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { when } from "../../components/admin/adminCopy.js";

function Screenshot({ bugId }: { bugId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let created: string | null = null;
    loadPrivateUrl(`/admin/bugs/${bugId}/screenshot`)
      .then((value) => {
        created = value;
        if (active) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [bugId]);
  return url ? <img src={url} alt="Screenshot sent with the report" className="max-h-80 rounded-md border border-fiber" /> : null;
}

export function AdminBugs() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "bugs", status],
    queryFn: () => api.get<Paginated<AdminBugReportDto>>(`/admin/bugs?status=${status}&limit=25`),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/admin/bugs/${id}/resolve`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(["open", "resolved"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>
            {value === "open" ? "Open" : "Resolved"}
          </Button>
        ))}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <RowSkeleton count={3} />
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "open" ? "No open bug reports" : "Nothing resolved yet"} description="Problems people report from the account menu land here." />
      ) : (
        <ul className="space-y-4">
          {data.items.map((bug) => (
            <li key={bug.id}>
              <Card className="p-5">
                <div className="space-y-2 pl-3 text-sm">
                  <p className="text-xs text-ink-faint">@{bug.reporter.username} &lt;{bug.reporter.email}&gt; · {when(bug.createdAt)}</p>
                  <p className="whitespace-pre-wrap break-words text-ink">{bug.description}</p>
                  {bug.pageUrl && <p className="break-all text-ink-soft">Page: {bug.pageUrl}</p>}
                  {bug.userAgent && <p className="break-all text-xs text-ink-faint">{bug.userAgent}</p>}
                  {bug.hasScreenshot && <Screenshot bugId={bug.id} />}
                  {bug.status === "open" && (
                    <Button type="button" size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === bug.id} onClick={() => resolve.mutate(bug.id)}>
                      Mark resolved
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
