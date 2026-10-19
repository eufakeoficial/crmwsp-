import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { buttonClasses } from "@/components/ui";
import { MobileMenu } from "./MobileMenu";
import { SITE_NAV } from "./nav";

/** Public sticky header. With a session cookie the primary action becomes "Ir a mi panel". */
export function SiteHeader({ hasSession }: { hasSession: boolean }) {
  const primary = hasSession ? { href: "/app", label: "Ir a mi panel" } : { href: "/signup", label: "Crear cuenta gratis" };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white">
      <div className="container-page relative flex h-[72px] items-center gap-6">
        <Logo href="/" />
        <nav aria-label="Principal" className="hidden gap-1 desk:flex">
          {SITE_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="flex h-12 items-center rounded-full px-3.5 font-semibold whitespace-nowrap text-ink no-underline hover:bg-paper">{item.label}</Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 desk:flex">
          {hasSession ? null : <Link href="/login" className="flex h-12 items-center px-4 font-bold text-ink no-underline">Ingresar</Link>}
          <Link href={primary.href} className={buttonClasses("accent", "h-12 px-[22px] text-[15px]")}>{primary.label}</Link>
        </div>
        <MobileMenu items={SITE_NAV} primary={primary} hasSession={hasSession} />
      </div>
    </header>
  );
}
