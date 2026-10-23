import { CONTENT_LAST_MODIFIED, getSiteUrl, SITE_DESCRIPTION, SITE_LANG, SITE_NAME } from "@/lib/site";
import { DEFINITION, FAQ, FEATURE_LIST, STEPS } from "./content";

/** Serialize for an inline <script>: "<" is escaped so content can never close the tag. */
function serialize(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\u003c");
}

/**
 * Structured data for the landing. Only facts that exist on the page: no ratings, reviews or
 * prices (the plan page does not exist yet, so SoftwareApplication carries no `offers`).
 * Organization has no `sameAs`: add it only when real public profiles exist.
 */
export function LandingJsonLd() {
  const url = getSiteUrl();
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}/#organization`,
        name: SITE_NAME,
        url,
        logo: { "@type": "ImageObject", url: `${url}/brand/logo-on-light.png` },
      },
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        url,
        name: SITE_NAME,
        inLanguage: SITE_LANG,
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "WebPage",
        "@id": `${url}/#webpage`,
        url,
        name: `${SITE_NAME}: CRM para WhatsApp con IA`,
        description: DEFINITION,
        inLanguage: SITE_LANG,
        dateModified: CONTENT_LAST_MODIFIED,
        isPartOf: { "@id": `${url}/#website` },
        about: { "@id": `${url}/#software` },
        speakable: { "@type": "SpeakableSpecification", cssSelector: ["#hero-title", "#que-es-definicion"] },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${url}/#software`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        featureList: [...FEATURE_LIST],
        dateModified: CONTENT_LAST_MODIFIED,
        inLanguage: SITE_LANG,
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "HowTo",
        "@id": `${url}/#howto`,
        name: "Cómo empezar a vender por WhatsApp con Vende+ WSP",
        inLanguage: SITE_LANG,
        step: STEPS.map(({ title, text }, i) => ({ "@type": "HowToStep", position: i + 1, name: title, text })),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}/#faq`,
        inLanguage: SITE_LANG,
        mainEntity: FAQ.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialize(graph) }} />;
}
