import type { ButtonHTMLAttributes, ReactNode } from "react";

const buttonBase =
  "min-h-11 cursor-pointer rounded-xl border border-border " +
  "bg-[color-mix(in_oklch,var(--surface)_78%,transparent)] " +
  "transition-[background,border-color,transform] duration-150 ease-out " +
  "hover:bg-[color-mix(in_oklch,var(--surface)_96%,var(--fg)_4%)] " +
  "hover:border-[color-mix(in_oklch,var(--fg)_20%,transparent)]";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

/** Square 44px icon-only button (topbar actions, card affordances). */
export function IconButton({ children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${buttonBase} grid w-11 place-items-center p-0 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.7] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Compact labeled button, optionally with a leading icon. */
export function CompactButton({
  children,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`${buttonBase} inline-flex items-center gap-2 px-3.5 text-[13px] font-[550] tracking-[0.02em] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.7] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
