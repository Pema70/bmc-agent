import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border font-bold transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none motion-reduce:transition-none";

// Przycisk główny: gradient akcentu (10%); drugorzędny: jednolita powierzchnia z ramką.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-cta border-transparent",
  secondary: "border-border bg-surface text-text hover:border-head-from",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-10 px-4 py-2 text-base",
  sm: "min-h-9 px-3 py-1 text-sm",
};

/** Klasy przycisku dla elementów innych niż <button> (np. link `next/link` albo `<a download>`). */
export function buttonClass(variant: ButtonVariant, size: ButtonSize = "md"): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={className ? `${buttonClass(variant, size)} ${className}` : buttonClass(variant, size)} {...rest} />;
}
