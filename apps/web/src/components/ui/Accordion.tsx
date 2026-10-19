"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";

export interface AccordionItem {
  question: string;
  answer: string;
}

/** One open answer at a time, stable accessible ids, answers kept in the server HTML. */
export function Accordion({ items, initialOpen = 0, className }: { items: readonly AccordionItem[]; initialOpen?: number; className?: string }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  return (
    <div className={className}>
      {items.map(({ question, answer }, index) => {
        const expanded = open === index;
        const Chevron = expanded ? ChevronUp : ChevronDown;
        return (
          <div key={question} className={cn(index < items.length - 1 && "border-b border-line")}>
            <h3 className="m-0 text-base">
              <button
                type="button"
                id={`${id}-q${index}`}
                aria-expanded={expanded}
                aria-controls={`${id}-a${index}`}
                onClick={() => setOpen(expanded ? -1 : index)}
                className="flex min-h-[60px] w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-base font-bold text-ink"
              >
                <span className="min-w-0 flex-1">{question}</span>
                <Chevron aria-hidden className="size-5 flex-none" />
              </button>
            </h3>
            <p id={`${id}-a${index}`} role="region" aria-labelledby={`${id}-q${index}`} hidden={!expanded} className="m-0 pb-4 text-ink-3">
              {answer}
            </p>
          </div>
        );
      })}
    </div>
  );
}
