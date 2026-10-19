import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-[18px] flex-none animate-spin rounded-full border-[2.5px] border-muted border-t-lime [animation-duration:.8s]", className)} />;
}
