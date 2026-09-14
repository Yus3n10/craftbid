import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminReportDto, Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { ModerationDialog, type ModerationTarget } from "../../components/admin/ModerationDialog.js";
import { REPORT_REASON_LABEL, TARGET_LABEL, when } from "../../components/admin/adminCopy.js";

const REMOVE: Record<string, { path: string; verb: string; noun: string; kind: string } | undefined> = {
  artist_post: { path: "posts", verb: "Remove post", noun: "this post", kind: "post" },
  posting: { path: "postings", verb: "Remove request", noun: "this request", kind: "request" },
  comment: { path: "comments", verb: "Remove comment", noun: "this comment", kind: "comment" },
};

export function AdminReports() {
  const [status, setStatus] = useState<"open" | "reviewed" | "dismissed">("open");
  const [target, setTarget] = useState<ModerationTarget | null>(null);
  const queryClient = useQueryClient();

  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "reports", status],
    queryFn: () => api.get<Paginated<AdminReportDto>>(`/admin/reports?status=${status}&limit=25`),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/admin/reports/${id}/dismiss`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(["open", "reviewed", "dismissed"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>
            {value === "open" ? "Open" : value === "reviewed" ? "Acted on" : "Dismissed"}
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <RowSkeleton count={3} />
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "open" ? "No open reports" : "Nothing here"} description="Reports people send from the site land here." />
      ) : (
        <ul className="space-y-4">
          {data.items.map((report) => {
            const removal = REMOVE[report.targetType];
            const headingId = `report-${report.id}`;
            return (
              <li key={report.id}>
                <article aria-labelledby={headingId}>
                  <Card className="p-5">
                    <div className="space-y-3 pl-3">
                      <p className="text-xs text-ink-faint">
                        {TARGET_LABEL[report.targetType]} · {REPORT_REASON_LABEL[report.reason] ?? report.reason} · reported by @{report.reporter.username} · {when(report.createdAt)}
                      </p>
                      <h3 id={headingId} className="whitespace-pre-wrap break-words font-medium text-ink">
                        {report.target ? report.target.text : "This no longer exists."}
                        {report.target?.removed && <span className="ml-2 text-xs font-semibold uppercase text-rust">Removed</span>}
                      </h3>
                      {report.details && <p className="rounded-md bg-paper-sunk px-3 py-2 text-sm text-ink-soft">{report.details}</p>}
                      {report.target?.owner && (
                        <p className="text-sm text-ink-soft">
                          By <Link className="text-indigo hover:underline" to={`/admin/users/${report.target.owner.id}`}>@{report.target.owner.username}</Link>
                          {report.target.href && (
                            <>
                              {" · "}
                              <Link className="text-indigo hover:underline" to={report.target.href}>View on the site</Link>
                            </>
                          )}
                        </p>
                      )}
                      {report.resolution && (
                        <p className="text-xs text-ink-faint">
                          Closed by @{report.resolution.by} · {when(report.resolution.at)}{report.resolution.note ? ` · ${report.resolution.note}` : ""}
                        </p>
                      )}
                      {report.status === "open" && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {removal && report.target && !report.target.removed && (
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                setTarget({
                                  verb: removal.verb,
                                  noun: removal.noun,
                                  path: `/admin/${removal.path}/${report.targetId}/remove`,
                                  reportId: report.id,
                                  danger: true,
                                  preview: () => `We removed your ${removal.kind}.`,
                                })
                              }
                            >
                              {removal.verb}
                            </Button>
                          )}
                          {report.target?.owner && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setTarget({
                                  verb: "Warn",
                                  noun: `@${report.target!.owner!.username}`,
                                  path: `/admin/users/${report.target!.owner!.id}/warn`,
                                  reportId: report.id,
                                  preview: () => "Warning from Craftbid.",
                                })
                              }
                            >
                              Warn @{report.target.owner.username}
                            </Button>
                          )}
                          <Button type="button" size="sm" variant="ghost" loading={dismiss.isPending && dismiss.variables === report.id} onClick={() => dismiss.mutate(report.id)}>
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <ModerationDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
