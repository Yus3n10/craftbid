import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MODERATION_RULE_COPY, type AdminUserDetailDto } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Page } from "../../components/layout/Shell.js";
import { Button } from "../../components/ui/Button.js";
import { Card, RoleBadge, ThreadRule } from "../../components/ui/Primitives.js";
import { ErrorState, FormError, PageHeading, RowSkeleton } from "../../components/ui/States.js";
import { ModerationDialog, type ModerationTarget } from "../../components/admin/ModerationDialog.js";
import { ACTION_LABEL, REPORT_REASON_LABEL, STATUS_LABEL, TARGET_LABEL, when } from "../../components/admin/adminCopy.js";
import { EmailBadge } from "./AdminUsers.js";

const CONTENT_PATH = { artist_post: "posts", posting: "postings", comment: "comments" } as const;

export function AdminUserDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ModerationTarget | null>(null);

  const { data: user, error, refetch } = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => api.get<AdminUserDetailDto>(`/admin/users/${id}`),
  });
  const unsuspend = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/unsuspend`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  if (error) return <Page><ErrorState error={error} onRetry={() => void refetch()} /></Page>;
  if (!user) return <Page><RowSkeleton count={4} /></Page>;

  const actionable = user.status !== "deleted" && !user.isStaff;
  const at = (verb: string, path: string, preview: string, danger = false): ModerationTarget => ({
    verb,
    noun: `@${user.username}`,
    path: `/admin/users/${user.id}/${path}`,
    preview: () => preview,
    danger,
  });

  return (
    <Page>
      <p className="mb-4 text-sm"><Link to="/admin?tab=users" className="text-indigo hover:underline">Back to accounts</Link></p>
      <PageHeading eyebrow="Account" title={user.displayName} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <dl className="grid gap-3 pl-3 text-sm sm:grid-cols-2">
              <div><dt className="eyebrow">Username</dt><dd>@{user.username}</dd></div>
              <div><dt className="eyebrow">Role</dt><dd><RoleBadge role={user.role} /></dd></div>
              <div className="sm:col-span-2">
                <dt className="eyebrow">Email</dt>
                <dd className="flex flex-wrap items-center gap-2"><span className="break-all">{user.email}</span><EmailBadge confirmedAt={user.emailConfirmedAt} /></dd>
                {user.emailConfirmedAt && <dd className="text-xs text-ink-faint">Confirmed {when(user.emailConfirmedAt)}</dd>}
              </div>
              <div><dt className="eyebrow">Status</dt><dd>{STATUS_LABEL[user.status]}{user.isStaff ? " · staff" : ""}</dd></div>
              <div><dt className="eyebrow">Joined</dt><dd>{when(user.createdAt)}</dd></div>
            </dl>
          </Card>

          <section aria-labelledby="content-title">
            <h2 id="content-title" className="font-display text-xl">Recent posts, requests and comments</h2>
            <ThreadRule className="my-3 w-12" />
            {user.recentContent.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing posted.</p>
            ) : (
              <ul className="space-y-2">
                {user.recentContent.map((item) => (
                  <li key={item.id} className="rounded-md border border-fiber bg-paper-raised px-4 py-3 text-sm">
                    <p className="text-xs text-ink-faint">{TARGET_LABEL[item.kind]} · {when(item.createdAt)}{item.removed ? " · removed" : ""}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-ink">{item.text}</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {item.href && <Link to={item.href} className="text-indigo hover:underline">View</Link>}
                      {!item.removed && actionable && (
                        <button
                          type="button"
                          className="text-rust hover:underline"
                          onClick={() =>
                            setTarget({
                              verb: `Remove ${TARGET_LABEL[item.kind].toLowerCase()}`,
                              noun: `this ${TARGET_LABEL[item.kind].toLowerCase()}`,
                              path: `/admin/${CONTENT_PATH[item.kind]}/${item.id}/remove`,
                              preview: () => `We removed your ${TARGET_LABEL[item.kind].toLowerCase()}.`,
                              danger: true,
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="history-title">
            <h2 id="history-title" className="font-display text-xl">Moderation history</h2>
            <ThreadRule className="my-3 w-12" />
            {user.history.length === 0 ? (
              <p className="text-sm text-ink-faint">No actions taken.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {user.history.map((entry) => (
                  <li key={entry.id} className="rounded-md bg-paper-sunk px-3 py-2">
                    <span className="font-medium">{ACTION_LABEL[entry.action]}</span>
                    {entry.rule && ` · ${MODERATION_RULE_COPY[entry.rule].label}`} · by @{entry.staff.username} · {when(entry.createdAt)}
                    {entry.note && <span className="block text-ink-soft">{entry.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="reports-title">
            <h2 id="reports-title" className="font-display text-xl">Reports about this account</h2>
            <ThreadRule className="my-3 w-12" />
            {user.reportsAgainst.length === 0 ? (
              <p className="text-sm text-ink-faint">None.</p>
            ) : (
              <ul className="space-y-1 text-sm text-ink-soft">
                {user.reportsAgainst.map((report) => (
                  <li key={report.id}>{REPORT_REASON_LABEL[report.reason] ?? report.reason} · {report.status} · {when(report.createdAt)}</li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <Card className="p-5">
            <div className="space-y-2 pl-3">
              <h2 className="font-display text-lg">Actions</h2>
              {!actionable ? (
                <p className="text-sm text-ink-faint">{user.isStaff ? "Staff accounts cannot be moderated here." : "This account was removed."}</p>
              ) : (
                <>
                  <Button type="button" variant="secondary" className="w-full" onClick={() => setTarget(at("Warn", "warn", "Warning from Craftbid."))}>
                    Send a warning
                  </Button>
                  {user.status === "suspended" ? (
                    <Button type="button" variant="secondary" className="w-full" loading={unsuspend.isPending} onClick={() => unsuspend.mutate()}>
                      Unsuspend
                    </Button>
                  ) : (
                    <Button type="button" variant="danger" className="w-full" onClick={() => setTarget(at("Suspend account", "suspend", "This account is suspended for breaking Craftbid's rules.", true))}>
                      Suspend
                    </Button>
                  )}
                  <Button type="button" variant="danger" className="w-full" onClick={() => setTarget(at("Remove account", "remove", "Their profile, posts, requests and comments disappear. Commissions stay for the other person.", true))}>
                    Remove account
                  </Button>
                  <FormError error={unsuspend.error} />
                </>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <ModerationDialog target={target} onClose={() => setTarget(null)} />
    </Page>
  );
}
