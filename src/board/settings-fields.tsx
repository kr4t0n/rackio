import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

/** Shared, hand-polished form primitives for card settings panels. */

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted"
      >
        {label}
      </label>
      {children(id)}
      {hint ? <p className="m-0 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      {...props}
      className="min-h-11 rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 text-sm transition-colors hover:border-[color-mix(in_oklch,var(--fg)_20%,transparent)]"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
          checked
            ? "bg-accent"
            : "bg-[color-mix(in_oklch,var(--fg)_18%,transparent)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-[left] duration-150 ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
