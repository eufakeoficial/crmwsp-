import { ArrowUpRight, Check } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { DEMO_VIDEO } from "./content";
import { ArrowLink, ArrowNudge, DemoPlayer, Reveal, Stagger, StaggerItem } from "./motion";
import { H2, SECTION } from "./styles";

/** Product demo: copy left, looping silent video right (stacked on mobile). Light background so the white video blends. */
export function DemoVideo() {
  const d = DEMO_VIDEO;
  return (
    <section id="demo-venta" aria-labelledby="demo-venta-title" className={`${SECTION} pt-[clamp(32px,5vw,56px)]`}>
      <div className="grid items-center gap-10 desk:grid-cols-2 desk:gap-16">
        <Reveal from="left" className="order-2 desk:order-1">
          <p className="m-0 mb-3 text-sm font-semibold tracking-wide text-royal uppercase">{d.eyebrow}</p>
          <h2 id="demo-venta-title" className={`${H2} max-w-[20ch]`}>{d.title}</h2>
          <p className="mt-4 mb-6 max-w-[46ch] text-ink-3">{d.lead}</p>
          <Stagger className="m-0 mb-8 flex list-none flex-col gap-3 p-0">
            {d.bullets.map((text) => (
              <StaggerItem key={text} className="flex items-start gap-3 font-semibold">
                <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime text-ink">
                  <Check className="size-4" />
                </span>
                {text}
              </StaggerItem>
            ))}
          </Stagger>
          <ArrowLink magnetic href="/signup" className={buttonClasses("primary", "", "lg")}>
            {d.cta}
            <ArrowNudge><ArrowUpRight className="size-5" /></ArrowNudge>
          </ArrowLink>
        </Reveal>
        <Reveal spring from="scale" className="order-1 mx-auto w-full max-w-[380px] desk:order-2">
          <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-[0_24px_60px_-20px_rgba(5,10,58,0.25)]">
            <DemoPlayer webm={d.webm} mp4={d.mp4} poster={d.poster} label={d.videoLabel} width={720} height={900} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
