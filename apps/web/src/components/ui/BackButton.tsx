import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Round "back" button: a link when `href` is given, otherwise a button. */
export function BackButton({ href, onClick, tone = "paper" }: { href?: string; onClick?: () => void; tone?: "paper" | "white" }) {
  const cls = cn("grid size-12 flex-none cursor-pointer place-items-center rounded-full text-ink no-underline", tone === "paper" ? "bg-paper" : "bg-white");
  const icon = <ArrowLeft aria-hidden className="size-5" />;
  return href ? (
    <Link href={href} aria-label="Atrás" className={cls}>{icon}</Link>
  ) : (
    <button type="button" onClick={onClick} aria-label="Atrás" className={cls}>{icon}</button>
  );
}
