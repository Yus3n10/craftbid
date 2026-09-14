import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AdminOverviewDto } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Card } from "../../components/ui/Primitives.js";
import { ErrorState, RowSkeleton } from "../../components/ui/States.js";

export function AdminOverview() {
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<AdminOverviewDto>("/admin/overview"),
  });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <RowSkeleton count={2} />;

  const tiles = [
    { label: "Open reports", value: data.openReports, to: "/admin?tab=reports" },
    { label: "Open bug reports", value: data.openBugReports, to: "/admin?tab=bugs" },
    { label: "Suspended accounts", value: data.suspendedAccounts, to: "/admin?tab=users" },
    { label: "Emails not confirmed", value: data.unconfirmedAccounts, to: "/admin?tab=users" },
    { label: "Actions this week", value: data.actionsThisWeek, to: "/admin?tab=activity" },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <li key={tile.label}>
          <Link to={tile.to} className="block">
            <Card interactive className="p-5">
              <p className="pl-3 text-sm text-ink-soft">{tile.label}</p>
              <p className="pl-3 font-display text-4xl tabular">{tile.value}</p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
