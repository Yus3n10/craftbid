import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AdminUserRowDto, Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { cx } from "../../lib/cx.js";
import { Field, Select, TextInput } from "../../components/ui/Field.js";
import { RoleBadge } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { STATUS_LABEL, when } from "../../components/admin/adminCopy.js";

/** Whether the account proved its address by following the emailed link. */
export function EmailBadge({ confirmedAt }: { confirmedAt: string | null }) {
  return (
    <span
      title={confirmedAt ? `Confirmed ${when(confirmedAt)}` : "Never followed the confirmation link"}
      className={cx(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
        confirmedAt ? "bg-sage-wash text-sage" : "bg-amber-wash text-amber",
      )}
    >
      {confirmedAt ? "Email confirmed" : "Not confirmed"}
    </span>
  );
}

export function AdminUsers() {
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");

  const params = new URLSearchParams({ limit: "25" });
  if (q.trim()) params.set("q", q.trim());
  if (email) params.set("email", email);
  if (status) params.set("status", status);
  if (role) params.set("role", role);

  const { data, error, refetch, isPending } = useQuery({
    queryKey: ["admin", "users", params.toString()],
    queryFn: () => api.get<Paginated<AdminUserRowDto>>(`/admin/users?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          {({ id }) => <TextInput id={id} type="search" placeholder="Name, username or email" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <Field label="Email">
          {({ id }) => (
            <Select id={id} value={email} onChange={(e) => setEmail(e.target.value)}>
              <option value="">Any</option>
              <option value="confirmed">Confirmed</option>
              <option value="unconfirmed">Not confirmed</option>
            </Select>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Removed</option>
            </Select>
          )}
        </Field>
        <Field label="Role">
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Any</option>
              <option value="client">Client</option>
              <option value="artist">Artist</option>
            </Select>
          )}
        </Field>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <RowSkeleton count={5} />
      ) : data!.items.length === 0 ? (
        <EmptyState title="No accounts match" description="Try a different search or filter." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-fiber bg-paper-raised">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Accounts</caption>
            <thead className="border-b border-fiber text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Account</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data!.items.map((user) => (
                <tr key={user.id} className="border-b border-fiber last:border-0">
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${user.id}`} className="font-medium text-indigo hover:underline">
                      {user.displayName}
                    </Link>
                    <span className="block text-xs text-ink-faint">@{user.username}{user.isStaff ? " · staff" : ""}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="block break-all">{user.email}</span>
                    <EmailBadge confirmedAt={user.emailConfirmedAt} />
                  </td>
                  <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                  <td className={cx("px-4 py-3", user.status !== "active" && "font-medium text-rust")}>{STATUS_LABEL[user.status]}</td>
                  <td className="px-4 py-3 text-ink-soft">{when(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-fiber px-4 py-2 text-xs text-ink-faint">
            Showing {data!.items.length} of {data!.total}
          </p>
        </div>
      )}
    </div>
  );
}
