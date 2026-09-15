import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminProblemDto, Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Dialog } from "../../components/ui/Dialog.js";
import { Field, TextArea } from "../../components/ui/Field.js";
import { Card } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, FormError, RowSkeleton } from "../../components/ui/States.js";
import { PaymentRecordRow } from "../../components/admin/PaymentRecordRow.js";
import { PROBLEM_REASON_LABEL, PROBLEM_STATUS_LABEL, when } from "../../components/admin/adminCopy.js";

type Outcome = "continue" | "cancel";

/** Settling a problem: carry on or call it off, with a note both people read. */
function ResolveDialog({ problem, onClose }: { problem: AdminProblemDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome>("continue");
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: () => api.post(`/admin/problems/${problem!.id}/resolve`, { outcome, note: note.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      close();
    },
  });

  function close() {
    setOutcome("continue");
    setNote("");
    resolve.reset();
    onClose();
  }

  const options: { value: Outcome; title: string; detail: string }[] = [
    { value: "continue", title: "Continue the commission", detail: "It is unpaused and both people carry on." },
    { value: "cancel", title: "Cancel the commission", detail: "It is called off. Craftbid cannot return money." },
  ];

  return (
    <Dialog
      open={problem !== null}
      onClose={close}
      title="Resolve this problem"
      size="md"
      actions={
        <>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={outcome === "cancel" ? "danger" : "primary"}
            disabled={note.trim().length < 5}
            loading={resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            Resolve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink">Outcome</legend>
          {options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-fiber p-3">
              <input
                type="radio"
                name="outcome"
                value={option.value}
                checked={outcome === option.value}
                onChange={() => setOutcome(option.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-ink">{option.title}</span>
                <span className="block text-sm text-ink-soft">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Note both people will see" required>
          {({ id }) => <TextArea id={id} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        <FormError error={resolve.error} />
      </div>
    </Dialog>
  );
}

function ProblemCard({ problem, onResolve }: { problem: AdminProblemDto; onResolve: () => void }) {
  const headingId = useId();
  return (
    <article aria-labelledby={headingId}>
      <Card className="p-5">
        <div className="space-y-3 pl-3 text-sm">
          <p className="text-xs text-ink-faint">
            {PROBLEM_REASON_LABEL[problem.reason] ?? problem.reason} · reported by @{problem.openedBy.username} · {when(problem.createdAt)}
          </p>
          <h3 id={headingId} className="break-words font-display text-lg text-ink">
            <Link className="hover:underline" to={`/commissions/${problem.commissionId}`}>
              {problem.postingTitle}
            </Link>
          </h3>
          <p className="whitespace-pre-wrap break-words rounded-md bg-paper-sunk px-3 py-2 text-ink-soft">{problem.details}</p>

          <dl className="grid gap-2 sm:grid-cols-2">
            {([
              ["Client", problem.client],
              ["Artist", problem.artist],
            ] as const).map(([label, person]) => (
              <div key={label} className="min-w-0">
                <dt className="eyebrow">{label}</dt>
                <dd className="break-words">
                  <Link className="text-indigo hover:underline" to={`/admin/users/${person.id}`}>
                    @{person.username}
                  </Link>{" "}
                  <span className="text-ink-faint">{person.email}</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className="space-y-2">
            <h4 className="eyebrow">Payment records</h4>
            {problem.payments.length === 0 ? (
              <p className="text-ink-faint">No payments recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {problem.payments.map((payment) => (
                  <li key={payment.id}>
                    <PaymentRecordRow payment={payment} showRequest={false} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {problem.status === "open" ? (
            <Button type="button" size="sm" onClick={onResolve}>
              Resolve
            </Button>
          ) : (
            <p className="text-xs text-ink-faint">
              {PROBLEM_STATUS_LABEL[problem.status]}
              {problem.closedAt ? ` · ${when(problem.closedAt)}` : ""}
              {problem.resolution ? ` · ${problem.resolution}` : ""}
            </p>
          )}
        </div>
      </Card>
    </article>
  );
}

/** Reported commission problems, with everything needed to settle one. */
export function AdminProblems() {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [resolving, setResolving] = useState<AdminProblemDto | null>(null);
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "problems", status],
    queryFn: () => api.get<Paginated<AdminProblemDto>>(`/admin/problems?status=${status}&limit=25`),
  });

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(["open", "closed"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>
            {value === "open" ? "Open" : "Closed"}
          </Button>
        ))}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <RowSkeleton count={3} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={status === "open" ? "No open problems" : "Nothing closed yet"}
          description="Problems either person reports on a commission land here. While one is open, the commission is paused."
        />
      ) : (
        <ul className="space-y-4">
          {data.items.map((problem) => (
            <li key={problem.id}>
              <ProblemCard problem={problem} onResolve={() => setResolving(problem)} />
            </li>
          ))}
        </ul>
      )}
      <ResolveDialog problem={resolving} onClose={() => setResolving(null)} />
    </div>
  );
}
