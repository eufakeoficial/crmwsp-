import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { LEGAL_UPDATED, PRIVACY_INTRO, PRIVACY_SECTIONS } from "@/components/site/legal-content";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Qué datos trata Vende+ WSP, para qué, con quién los comparte y cómo ejercer tus derechos.",
  alternates: { canonical: "/privacidad" },
};

export default function PrivacyPage() {
  return <LegalPage title="Política de privacidad" updated={LEGAL_UPDATED} intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} />;
}
