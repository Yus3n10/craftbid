import { useId, type ReactNode } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "../../lib/cx.js";

const CONTROL =
  "rounded-md border bg-paper-raised px-3 py-2 text-ink " +
  "placeholder:text-ink-faint transition-colors " +
  "focus:border-indigo focus:outline-none focus:ring-2 focus:ring-indigo/20 " +
  "disabled:bg-paper-sunk disabled:text-ink-faint";

/**
 * A control fills its container unless the caller has already said how wide it
 * should be.
 *
 * cx() joins class names, it does not merge them, so a caller passing `w-36`
 * used to leave both that and the `w-full` baked into CONTROL in the class
 * list. Which one applied was then decided by the order Tailwind happens to
 * emit its width rules, and it emits `w-full` last. The caller lost silently:
 * the platform select on the contact-links row rendered at the full width of
 * the row and pushed the address field and its Remove button off the edge of
 * the card, so the link could not be typed.
 *
 * Withholding the default when the caller has supplied a width of their own
 * means only one width rule is ever in play. `flex-1`, `basis-*` and `size-*`
 * count as widths here because they decide the same thing inside a flex row.
 */
const WIDTH_SUPPLIED = /(?:^|\s)(?:w-|min-w-|max-w-|size-|basis-|flex-1|grow)/;

function control(className: string | undefined, ...rest: (string | false | null | undefined)[]) {
  return cx(WIDTH_SUPPLIED.test(className ?? "") ? "" : "w-full", CONTROL, ...rest, className);
}

interface FieldProps {
  label: string;
  /** Server or client validation message. Announced, not just coloured. */
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/**
 * Wraps a control with its label, hint and error.
 *
 * Errors are wired through aria-describedby and aria-invalid rather than left
 * as red text, so someone using a screen reader hears why the form was
 * rejected instead of only that it was.
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-1 text-clay" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-sm text-ink-faint">
          {hint}
        </p>
      )}

      {children({
        id,
        ...(describedBy ? { describedBy } : {}),
        invalid: Boolean(error),
      })}

      {error && (
        <p id={errorId} className="text-sm font-medium text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={control(className, invalid ? "border-rust" : "border-fiber-strong")}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function TextArea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={control(
        className,
        "min-h-28 resize-y leading-relaxed",
        invalid ? "border-rust" : "border-fiber-strong",
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={control(
        className,
        "appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9",
        invalid ? "border-rust" : "border-fiber-strong",
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%2368726d' stroke-width='1.5'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
      }}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * A peso amount entered in whole pesos and stored in centavos, so no float
 * ever represents money. The prefix sits inside the control.
 */
export function PesoInput({
  valueCentavos,
  onChangeCentavos,
  invalid,
  id,
  describedBy,
  ...rest
}: {
  valueCentavos: number | "";
  onChangeCentavos: (centavos: number | "") => void;
  invalid?: boolean;
  id?: string;
  describedBy?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      >
        ₱
      </span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={control(
          undefined,
          "tabular pl-7",
          invalid ? "border-rust" : "border-fiber-strong",
        )}
        value={valueCentavos === "" ? "" : Math.round(valueCentavos / 100)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChangeCentavos("");
            return;
          }
          const pesos = Number(raw);
          if (Number.isFinite(pesos)) onChangeCentavos(Math.round(pesos) * 100);
        }}
        {...rest}
      />
    </div>
  );
}
