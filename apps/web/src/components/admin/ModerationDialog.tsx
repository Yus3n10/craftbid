import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MODERATION_RULES, MODERATION_RULE_COPY, type ModerationRule } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Select, TextArea } from "../ui/Field.js";
import { FormError } from "../ui/States.js";

export interface ModerationTarget {
  /** Dialog title and button, for example "Remove post". */
  verb: string;
  /** Title noun, for example "this post". */
  noun: string;
  path: string;
  reportId?: string;
  /** Whether the person is told, and how, shown before sending. */
  preview: (rule: ModerationRule | null) => string;
  danger?: boolean;
}

/**
 * Every staff action goes through this: a rule, an optional note, and the
 * exact words the person will see, before anything is sent.
 */
export function ModerationDialog({ target, onClose }: { target: ModerationTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rule, setRule] = useState<ModerationRule | "">("");
  const [note, setNote] = useState("");

  const act = useMutation({
    mutationFn: () =>
      api.post(target!.path, {
        rule,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(target!.reportId ? { reportId: target!.reportId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      close();
    },
  });

  function close() {
    setRule("");
    setNote("");
    act.reset();
    onClose();
  }

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={target ? `${target.verb.split(" ")[0]} ${target.noun}` : ""}
      size="md"
      actions={
        <>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={target?.danger ? "danger" : "primary"}
            disabled={!rule}
            loading={act.isPending}
            onClick={() => act.mutate()}
          >
            {target?.verb}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Rule" required>
          {({ id }) => (
            <Select id={id} value={rule} onChange={(event) => setRule(event.target.value as ModerationRule)}>
              <option value="" disabled>
                Choose the rule it broke
              </option>
              {MODERATION_RULES.map((value) => (
                <option key={value} value={value}>
                  {MODERATION_RULE_COPY[value].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Note to them (optional)">
          {({ id }) => <TextArea id={id} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        {target && (
          <div className="rounded-md bg-paper-sunk px-3 py-2 text-sm text-ink-soft">
            <p className="eyebrow mb-1">What they will see</p>
            <p>
              {/* Built the way the notification is: "We removed your post: Stolen work." */}
              {target.preview(rule || null).replace(/\.$/, "")}
              {rule ? `: ${MODERATION_RULE_COPY[rule].label}. ${MODERATION_RULE_COPY[rule].sentence}` : "."} {note.trim()}
            </p>
          </div>
        )}
        <FormError error={act.error} />
      </div>
    </Dialog>
  );
}
