import Link from "next/link";
import { cn } from "@/lib/cn";

/** Lime square with a black "C". */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      className={cn("grid flex-none place-items-center rounded-[28%] bg-lime font-extrabold text-ink", className)}
    >
      C
    </span>
  );
}

/** Logo mark plus the "CRMWSP" wordmark. `inverted` for dark backgrounds. */
export function Logo({ href = "/", inverted = false, className }: { href?: string; inverted?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 no-underline", inverted ? "text-white" : "text-ink", className)}>
      <LogoMark />
      <span className="text-[17px] font-extrabold tracking-[-0.01em]">CRMWSP</span>
    </Link>
  );
}
