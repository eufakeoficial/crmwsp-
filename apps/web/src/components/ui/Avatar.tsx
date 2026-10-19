import { cn } from "@/lib/cn";

const SIZES = { sm: "size-8 text-xs rounded-lg", md: "size-10 text-sm rounded-xl", lg: "size-12 text-base rounded-2xl" } as const;
const TONES = { soft: "bg-lime-soft text-ink", ink: "bg-ink text-lime", lime: "bg-lime text-ink", paper: "bg-paper text-ink" } as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Initials avatar. Decorative: the name is always rendered next to it. */
export function Avatar({
  name,
  tone = "soft",
  size = "md",
  round = false,
  className,
}: {
  name: string;
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  round?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid shrink-0 place-items-center font-extrabold", SIZES[size], TONES[tone], round && "rounded-full", className)}
    >
      {initials(name)}
    </span>
  );
}
