import { useSearchParams } from "react-router-dom";
import { Page } from "../../components/layout/Shell.js";
import { cx } from "../../lib/cx.js";
import { PageHeading } from "../../components/ui/States.js";
import { AdminActivity } from "./AdminActivity.js";
import { AdminBugs } from "./AdminBugs.js";
import { AdminOverview } from "./AdminOverview.js";
import { AdminPayments } from "./AdminPayments.js";
import { AdminProblems } from "./AdminProblems.js";
import { AdminReports } from "./AdminReports.js";
import { AdminUsers } from "./AdminUsers.js";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reports", label: "Reports" },
  { key: "users", label: "Users" },
  { key: "problems", label: "Problems" },
  { key: "payments", label: "Payments" },
  { key: "bugs", label: "Bug reports" },
  { key: "activity", label: "Activity log" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** The staff screen. The tab lives in the address so a link can open straight to it. */
export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((item) => item.key === params.get("tab"))?.key ?? "overview") as Tab;

  return (
    <Page>
      <PageHeading eyebrow="Staff only" title="Admin" />
      <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto px-4">
        <ul className="flex w-max gap-1 rounded-md border border-fiber bg-paper-raised p-1">
          {TABS.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={tab === item.key ? "page" : undefined}
                onClick={() => setParams({ tab: item.key })}
                className={cx(
                  "whitespace-nowrap rounded-sm px-3 py-1.5 text-sm transition-colors",
                  tab === item.key ? "bg-indigo text-paper-raised" : "text-ink-soft hover:text-ink",
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "overview" && <AdminOverview />}
      {tab === "reports" && <AdminReports />}
      {tab === "users" && <AdminUsers />}
      {tab === "problems" && <AdminProblems />}
      {tab === "payments" && <AdminPayments />}
      {tab === "bugs" && <AdminBugs />}
      {tab === "activity" && <AdminActivity />}
    </Page>
  );
}
