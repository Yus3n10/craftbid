import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeDto, RoleSwitchStatusDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Card, RoleBadge, ThreadRule } from "./ui/Primitives.js";
import { FormError } from "./ui/States.js";

const WHAT_CHANGES = {
  artist: [
    "You can build a portfolio and bid on craft requests.",
    "You can no longer post craft requests.",
    "Your reviews stay, marked with the role you had.",
  ],
  client: [
    "You can post craft requests and choose artists.",
    "You can no longer bid. Your portfolio stays on your profile as past work.",
    "Your payment details are kept for if you switch back.",
  ],
} as const;

/**
 * Switching between artist and client.
 *
 * The server decides whether it is allowed and why not; this only shows its
 * answer. The confirmation says plainly that other devices are signed out,
 * because that is the part nobody expects.
 */
export function AccountTypeSection({ me }: { me: MeDto }) {
  const queryClient = useQueryClient();
  const target = me.role === "client" ? "artist" : "client";
  const [confirming, setConfirming] = useState(false);

  const status = useQuery({
    queryKey: ["role-switch", me.id, me.role],
    queryFn: () => api.get<RoleSwitchStatusDto>("/me/role-switch"),
  });

  const change = useMutation({
    mutationFn: () => api.post<{ user: MeDto }>("/me/role", { role: target }),
    onSuccess: ({ user }) => {
      setConfirming(false);
      queryClient.setQueryData(["me"], user);
      void queryClient.invalidateQueries();
    },
  });

  return (
    <section id="account-type" aria-labelledby="account-type-title" className="scroll-mt-24">
      <Card className="p-6">
        <div className="pl-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="account-type-title" className="font-display text-xl">
              Account type
            </h2>
            <RoleBadge role={me.role} />
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {me.role === "client"
              ? "You commission work. Switch to an artist account to make and sell it instead."
              : "You make work. Switch to a client account to commission it instead."}
          </p>
          <ThreadRule className="my-4 w-14" />

          {status.data && !status.data.allowed && (
            <ul className="mb-4 space-y-1 text-sm text-rust">
              {status.data.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}

          <Button
            type="button"
            variant="secondary"
            disabled={!status.data?.allowed}
            onClick={() => setConfirming(true)}
          >
            Switch to {target}
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Switch to ${target === "artist" ? "an artist" : "a client"} account?`}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" loading={change.isPending} onClick={() => change.mutate()}>
              Switch to {target}
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {WHAT_CHANGES[target].map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>You stay signed in here and are signed out on your other devices.</li>
          <li>You cannot switch again for 30 days.</li>
        </ul>
        <FormError error={change.error} />
      </Dialog>
    </section>
  );
}
