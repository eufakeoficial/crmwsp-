import { cookies } from "next/headers";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export interface LegalSection {
  title: string;
  paragraphs: readonly string[];
}

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts (presence check only).
const SESSION_COOKIE = "__Host-crmwsp_session";

/** Plain readable page for legal texts (terms, privacy). */
export async function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}) {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  return (
    <>
      <SiteHeader hasSession={hasSession} />
      <main className="container-page max-w-3xl pt-28 pb-20">
        <h1 className="m-0 mb-2 text-[clamp(28px,4vw,40px)] font-extrabold">{title}</h1>
        <p className="m-0 mb-6 text-sm text-ink-3">Última actualización: {updated}</p>
        <p className="mb-8 text-base leading-relaxed">{intro}</p>
        {sections.map((s, i) => (
          <section key={s.title} aria-labelledby={`sec-${i}`} className="mb-7">
            <h2 id={`sec-${i}`} className="m-0 mb-2 text-xl font-bold">
              {i + 1}. {s.title}
            </h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="m-0 mb-3 text-base leading-relaxed">
                {p}
              </p>
            ))}
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}
