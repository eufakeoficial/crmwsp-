import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "accent" | "outline" | "ghost" | "whatsapp";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  accent: "bg-lime font-extrabold text-ink hover:brightness-95",
  outline: "border-[1.5px] border-ink bg-white text-ink hover:bg-paper",
  ghost: "bg-transparent text-ink hover:bg-ink/8",
  whatsapp: "bg-whatsapp text-whatsapp-ink hover:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-[13px]",
  lg: "h-11 px-5 text-[15px]",
};

/** Class string of a pill button; also used to style `<Link>`s as buttons. */
export function buttonClasses(variant: ButtonVariant = "primary", className?: string, size: ButtonSize = "md"): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap no-underline transition",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClasses(variant, className, size)} {...props} />;
}
