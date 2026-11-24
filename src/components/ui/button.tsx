import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary";

const BASE =
  "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-2 text-base font-bold transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none motion-reduce:transition-none";

// Przycisk główny: gradient akcentu (10%); drugorzędny: jednolita powierzchnia z ramką.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-cta border-transparent",
  secondary: "border-border bg-surface text-text hover:border-head-from",
};

/** Klasy przycisku dla elementów innych niż <button> (np. link `next/link` albo `<a download>`). */
export function buttonClass(variant: ButtonVariant): string {
  return `${BASE} ${VARIANTS[variant]}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={className ? `${buttonClass(variant)} ${className}` : buttonClass(variant)} {...rest} />;
}
