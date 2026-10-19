"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { chipClasses } from "./Chip";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

/** Pill tabs following the WAI-ARIA tabs pattern (arrows, Home, End). */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  const base = useId();
  const [selected, setSelected] = useState(items[0]?.id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    setSelected(item.id);
    refs.current[item.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${item.id}`}
            aria-selected={selected === item.id}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={selected === item.id ? 0 : -1}
            onClick={() => setSelected(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={chipClasses(selected === item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={selected !== item.id}
          className="mt-4"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
