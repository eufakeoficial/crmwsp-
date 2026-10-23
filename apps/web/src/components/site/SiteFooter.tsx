import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { FOOTER_COLUMNS } from "./nav";

// Module level so the year does not change between server and client renders.
const YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="bg-ink text-white">
      <div className="container-page flex flex-col gap-8 pt-[clamp(40px,5vw,64px)] pb-8">
        <div className="grid grid-cols-2 gap-7 sm:grid-cols-3 desk:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-full flex flex-col gap-2.5 desk:col-span-1">
            <Logo inverted />
            <span className="text-sm text-subtle">El CRM para negocios que venden por WhatsApp.</span>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="flex flex-col gap-0.5 text-[15px]">
              <b className="mb-1.5 text-lime">{col.title}</b>
              {col.links.map((l) => (
                <Link key={l.label} href={l.href} className="flex min-h-9 items-center text-white no-underline hover:underline">{l.label}</Link>
              ))}
            </nav>
          ))}
        </div>
        <div className="border-t border-ink-3 pt-5 text-sm text-subtle">© {YEAR} Vende+ WSP</div>
      </div>
    </footer>
  );
}
