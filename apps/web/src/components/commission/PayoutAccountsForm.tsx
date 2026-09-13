import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PayoutAccountDto } from "@craftbid/shared";
import { ApiError, api } from "../../lib/api.js";
import { Button } from "../ui/Button.js";
import { Field, TextInput } from "../ui/Field.js";
import { FormError } from "../ui/States.js";

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

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

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
      void queryClient.invalidateQueries({ queryKey: ["commission"] });
    },
  });

  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <FormError error={save.error} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">GCash</legend>
        <Field label="Name on the account">
          {({ id }) => <TextInput id={id} autoComplete="name" value={draft.gcashName} onChange={set("gcashName")} />}
        </Field>
        <Field label="GCash number" hint="09XX XXX XXXX">
          {({ id, describedBy }) => (
            <TextInput id={id} inputMode="tel" autoComplete="tel" aria-describedby={describedBy} value={draft.gcashNumber} onChange={set("gcashNumber")} />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Maya</legend>
        <Field label="Name on the account">
          {({ id }) => <TextInput id={id} value={draft.mayaName} onChange={set("mayaName")} />}
        </Field>
        <Field label="Maya number" hint="09XX XXX XXXX">
          {({ id, describedBy }) => (
            <TextInput id={id} inputMode="tel" aria-describedby={describedBy} value={draft.mayaNumber} onChange={set("mayaNumber")} />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Bank</legend>
        <Field label="Bank">
          {({ id }) => <TextInput id={id} placeholder="BPI, BDO…" value={draft.bankName} onChange={set("bankName")} />}
        </Field>
        <Field label="Name on the account">
          {({ id }) => <TextInput id={id} value={draft.bankAccountName} onChange={set("bankAccountName")} />}
        </Field>
        <Field label="Account number">
          {({ id }) => <TextInput id={id} inputMode="numeric" value={draft.bankAccountNumber} onChange={set("bankAccountNumber")} />}
        </Field>
      </fieldset>

      {Object.keys(fields).length > 0 && (
        <p className="text-sm text-rust" role="alert">
          Check the details above: numbers need all their digits, and each method needs a name.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={save.isPending}>
          Save payment details
        </Button>
        {save.isSuccess && <span className="text-sm text-sage">Saved.</span>}
      </div>
    </form>
  );
}
