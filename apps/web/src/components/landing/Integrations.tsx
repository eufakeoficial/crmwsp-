import Image from "next/image";
import { INTEGRATIONS_SECTION } from "./content";
import { Reveal, Stagger, StaggerItem } from "./motion";
import { H2 } from "./styles";

/** Compact partner-logo strip: 2x2 on mobile, one row on desktop. Logos are grayscale until hover/focus. */
export function Integrations() {
  const { title, lead, logos } = INTEGRATIONS_SECTION;
  return (
    <section id="integraciones" aria-labelledby="integraciones-title" className="container-page py-[clamp(32px,5vw,56px)]">
      <Reveal as="header" className="mb-8 text-center">
        <h2 id="integraciones-title" className={`${H2} mx-auto max-w-[24ch] !text-[clamp(1.375rem,1.1rem+1.1vw,2rem)]`}>{title}</h2>
        <p className="mx-auto mt-3 mb-0 max-w-[48ch] text-ink-3">{lead}</p>
      </Reveal>
      <Stagger className="m-0 grid list-none grid-cols-2 gap-3 p-0 desk:grid-cols-4 desk:gap-4">
        {logos.map((logo) => (
          <StaggerItem key={logo.name} className="group flex flex-col items-center gap-3 rounded-[20px] border border-line bg-white px-4 py-6 text-center transition-colors hover:border-line-2">
            <div className="flex h-10 items-center justify-center">
              <Image
                src={logo.src}
                alt={logo.alt}
                width={logo.width}
                height={logo.height}
                sizes="160px"
                className="h-9 w-auto max-w-[140px] object-contain opacity-70 grayscale transition duration-300 group-hover:opacity-100 group-hover:grayscale-0 group-focus-within:opacity-100 group-focus-within:grayscale-0"
              />
            </div>
            <p className="m-0 text-xs leading-snug text-ink-3">{logo.caption}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
