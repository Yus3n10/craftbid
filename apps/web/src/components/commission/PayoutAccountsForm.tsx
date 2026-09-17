import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PayoutAccountDto } from "@craftbid/shared";
import { ApiError, api } from "../../lib/api.js";
import { useUnsavedChanges } from "../../lib/unsavedChanges.js";
import { Button } from "../ui/Button.js";
import { Field, TextInput } from "../ui/Field.js";
import { FieldMessages, FormError } from "../ui/States.js";

interface Draft {
  gcashName: string;
  gcashNumber: string;
  mayaName: string;
  mayaNumber: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
}

const EMPTY: Draft = {
  gcashName: "",
  gcashNumber: "",
  mayaName: "",
  mayaNumber: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
};

function toDraft(accounts: PayoutAccountDto[]): Draft {
  const draft = { ...EMPTY };
  for (const account of accounts) {
    if (account.method === "gcash") {
      draft.gcashName = account.accountName;
      draft.gcashNumber = account.accountNumber;
    } else if (account.method === "maya") {
      draft.mayaName = account.accountName;
      draft.mayaNumber = account.accountNumber;
    } else {
      draft.bankName = account.bankName ?? "";
      draft.bankAccountName = account.accountName;
      draft.bankAccountNumber = account.accountNumber;
    }
  }
  return draft;
}

/**
 * One payment method: a heading and its fields on one shared two-column grid.
 *
 * Every method uses the same two columns, name on the left and number on the
 * right, so the boxes line up down the whole form.
 */
function Method({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-fiber bg-paper p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/**
 * Where clients pay an artist.
 *
 * Shown to a client only inside an active commission with this artist, never
 * on the public profile. A method left blank is simply not offered.
 */
export function PayoutAccountsForm() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["payout-accounts"],
    queryFn: () => api.get<PayoutAccountDto[]>("/me/payout-accounts"),
  });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [baseline, setBaseline] = useState<Draft>(EMPTY);

  useEffect(() => {
    if (data) {
      setDraft(toDraft(data));
      setBaseline(toDraft(data));
    }
  }, [data]);

  useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(baseline));

  const save = useMutation({
    mutationFn: () => {
      const accounts = [];
      if (draft.gcashName || draft.gcashNumber) {
        accounts.push({ method: "gcash", accountName: draft.gcashName, accountNumber: draft.gcashNumber });
      }
      if (draft.mayaName || draft.mayaNumber) {
        accounts.push({ method: "maya", accountName: draft.mayaName, accountNumber: draft.mayaNumber });
      }
      if (draft.bankName || draft.bankAccountName || draft.bankAccountNumber) {
        accounts.push({
          method: "bank",
          bankName: draft.bankName,
          accountName: draft.bankAccountName,
          accountNumber: draft.bankAccountNumber,
        });
      }
      return api.put<PayoutAccountDto[]>("/me/payout-accounts", { accounts });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["payout-accounts"], saved);
      setBaseline(toDraft(saved));
      void queryClient.invalidateQueries({ queryKey: ["commission"] });
    },
  });

  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <FormError error={save.error} />

      <Method title="GCash">
        <Field label="Name on the account">
          {({ id }) => <TextInput id={id} autoComplete="name" value={draft.gcashName} onChange={set("gcashName")} />}
        </Field>
        <Field label="GCash number">
          {({ id }) => (
            <TextInput id={id} inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX" value={draft.gcashNumber} onChange={set("gcashNumber")} />
          )}
        </Field>
      </Method>

      <Method title="Maya">
        <Field label="Name on the account">
          {({ id }) => <TextInput id={id} value={draft.mayaName} onChange={set("mayaName")} />}
        </Field>
        <Field label="Maya number">
          {({ id }) => (
            <TextInput id={id} inputMode="tel" placeholder="09XX XXX XXXX" value={draft.mayaNumber} onChange={set("mayaNumber")} />
          )}
        </Field>
      </Method>

      <Method title="Bank">
        <div className="sm:col-span-2">
          <Field label="Bank">
            {({ id }) => <TextInput id={id} placeholder="BPI, BDO, Landbank…" value={draft.bankName} onChange={set("bankName")} />}
          </Field>
        </div>
        <Field label="Name on the account">
          {({ id }) => <TextInput id={id} value={draft.bankAccountName} onChange={set("bankAccountName")} />}
        </Field>
        <Field label="Account number">
          {({ id }) => <TextInput id={id} inputMode="numeric" value={draft.bankAccountNumber} onChange={set("bankAccountNumber")} />}
        </Field>
      </Method>

      <FieldMessages error={save.error} />

      <div className="flex items-center gap-3">
        <Button type="submit" loading={save.isPending}>
          Save payment details
        </Button>
        {save.isSuccess && <span className="text-sm text-sage">Saved.</span>}
      </div>
    </form>
  );
}
