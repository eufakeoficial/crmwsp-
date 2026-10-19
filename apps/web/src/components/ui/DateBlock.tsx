import { cn } from "@/lib/cn";

/** Black calendar block: big day over a short month. */
export function DateBlock({ date, className }: { date: Date; className?: string }) {
  const day = date.getUTCDate();
  const month = new Intl.DateTimeFormat("es", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return (
    <time
      dateTime={date.toISOString()}
      className={cn("inline-flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-ink text-white", className)}
    >
      <span className="text-xl leading-none font-extrabold">{day}</span>
      <span className="mt-0.5 text-[11px] font-bold tracking-wide text-lime uppercase">{month}</span>
    </time>
  );
}
