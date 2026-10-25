"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { chipClasses } from "@/components/ui";

export type ChannelsTabId = "channels" | "guide";

const TABS: { id: ChannelsTabId; label: string }[] = [
  { id: "channels", label: "Mis canales" },
  { id: "guide", label: "Guía paso a paso" },
];

/** Controlled WAI-ARIA tabs (arrows, Home, End) so other UI can switch the tab. */
export function ChannelsTabs({ selected, onSelect, panels }: { selected: ChannelsTabId; onSelect: (id: ChannelsTabId) => void; panels: Record<ChannelsTabId, ReactNode> }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const tab = TABS[next];
    if (!tab) return;
    onSelect(tab.id);
    refs.current[tab.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Canales" className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 py-1">
        {TABS.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            role="tab"
            type="button"
            id={`channels-tab-${tab.id}`}
            aria-selected={selected === tab.id}
            aria-controls={`channels-panel-${tab.id}`}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={chipClasses(selected === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div key={tab.id} role="tabpanel" id={`channels-panel-${tab.id}`} aria-labelledby={`channels-tab-${tab.id}`} hidden={selected !== tab.id}>
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
