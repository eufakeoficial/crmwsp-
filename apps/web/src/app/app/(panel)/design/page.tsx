import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/EmptyState";
import { ShowcaseBasics } from "@/components/design/ShowcaseBasics";
import { ShowcaseData } from "@/components/design/ShowcaseData";
import { ShowcaseInbox } from "@/components/design/ShowcaseInbox";

/** Internal catalogue of the design system. Not available in production. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <PageHeader title="Sistema de diseño" subtitle="Catálogo interno de componentes de CRMWSP. Solo disponible en desarrollo." />
      <ShowcaseBasics />
      <ShowcaseData />
      <ShowcaseInbox />
    </>
  );
}
