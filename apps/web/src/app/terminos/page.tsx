import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { LEGAL_UPDATED, TERMS_INTRO, TERMS_SECTIONS } from "@/components/site/legal-content";

export const metadata: Metadata = {
  title: "Términos de uso",
  description: "Condiciones de uso de Vende+ WSP, el CRM de WhatsApp con IA: cuenta, pagos, prueba gratis, IA y responsabilidad.",
  alternates: { canonical: "/terminos" },
};

export default function TermsPage() {
  return <LegalPage title="Términos de uso" updated={LEGAL_UPDATED} intro={TERMS_INTRO} sections={TERMS_SECTIONS} />;
}
