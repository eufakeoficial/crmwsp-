import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { FAQ } from "./Sections";

/** Serialize for an inline <script>: "<" is escaped so content can never close the tag. */
function serialize(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\u003c");
}

/**
 * Structured data for the landing. Only facts that exist on the page: no ratings, reviews or
 * prices (the plan page does not exist yet, so SoftwareApplication carries no `offers`).
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
        inLanguage: "es",
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${url}/#software`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "es",
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${url}/#faq`,
        inLanguage: "es",
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
