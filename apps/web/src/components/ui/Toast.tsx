import { Check } from "lucide-react";

/** The live region stays mounted even when there is no message. */
export function Toast({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-0 bottom-7 z-[80] flex justify-center px-3">
      {message ? (
        <span className="flex max-w-full items-center gap-2 rounded-3xl bg-ink px-5 py-3 text-center font-bold text-white shadow-[0_10px_30px_rgba(18,18,18,.25)]">
          <Check aria-hidden className="size-4 flex-none text-lime" />
          {message}
        </span>
      ) : null}
    </div>
  );
}
