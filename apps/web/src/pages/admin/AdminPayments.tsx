import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminPaymentDto, Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Field, Select, TextInput } from "../../components/ui/Field.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { PaymentRecordRow } from "../../components/admin/PaymentRecordRow.js";

type State = "" | "submitted" | "confirmed" | "rejected";

/**
 * Every payment record on every commission, whatever its state, so a dispute
 * can be checked against what was actually sent before anyone reports it.
 */
export function AdminPayments() {
  const [state, setState] = useState<State>("");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams({ limit: "25" });
  if (state) params.set("status", state);
  if (search) params.set("q", search);

  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "payments", state, search],
    queryFn: () => api.get<Paginated<AdminPaymentDto>>(`/admin/payments?${params.toString()}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Field label="State">
            {({ id }) => (
              <Select id={id} value={state} onChange={(event) => setState(event.target.value as State)}>
                <option value="">All</option>
                <option value="submitted">Waiting for the artist</option>
                <option value="confirmed">Confirmed</option>
                <option value="rejected">Rejected</option>
              </Select>
            )}
          </Field>
        </div>
        <form
          role="search"
          className="flex w-full min-w-0 flex-1 items-end gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draft.trim());
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Username or reference number">
              {({ id }) => (
                <TextInput
                  id={id}
                  type="search"
                  aria-label="Search payments"
                  value={draft}
                  maxLength={60}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <RowSkeleton count={3} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No payment records" description="Payments clients record on their commissions appear here." />
      ) : (
        <ul className="space-y-3">
          {data.items.map((payment) => (
            <li key={payment.id}>
              <PaymentRecordRow payment={payment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
