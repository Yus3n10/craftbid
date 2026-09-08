import { useId, type ReactNode } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "../../lib/cx.js";

const CONTROL =
  "w-full rounded-md border bg-paper-raised px-3 py-2 text-ink " +
  "placeholder:text-ink-faint transition-colors " +
  "focus:border-indigo focus:outline-none focus:ring-2 focus:ring-indigo/20 " +
  "disabled:bg-paper-sunk disabled:text-ink-faint";

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
      className={cx(CONTROL, invalid ? "border-rust" : "border-fiber-strong", className)}
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
      className={cx(
        CONTROL,
        "min-h-28 resize-y leading-relaxed",
        invalid ? "border-rust" : "border-fiber-strong",
        className,
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
      className={cx(
        CONTROL,
        "appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9",
        invalid ? "border-rust" : "border-fiber-strong",
        className,
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
        className={cx(
          CONTROL,
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
