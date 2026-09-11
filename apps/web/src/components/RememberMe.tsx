import { useId } from "react";

/**
 * "Keep me logged in".
 *
 * Off by default: on a borrowed or shared phone, the safe outcome is the one
 * that happens when nobody reads the box. The line underneath says what the
 * choice actually does in the terms a person decides by, "this phone" and
 * "30 days", rather than in terms of cookies.
 *
 * The whole row is the label, and at least 44px tall, so it is a comfortable
 * thumb target rather than a 16px square.
 */
export function RememberMe({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();

  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hintId}
          className="size-5 shrink-0 rounded-sm border-fiber-strong text-indigo"
        />
        Keep me logged in
      </label>
      <p id={hintId} className="pl-8 text-xs text-ink-soft">
        Stay signed in on this device for 30 days. Leave it off on a shared phone.
      </p>
    </div>
  );
}
