/**
 * Single source of truth for every image/video slot on the public landing page.
 *
 * To fill a slot: drop the file in `apps/web/public/landing/` (see the README there)
 * and set `src` to its public path, e.g. `src: "/landing/hero-inbox.webp"`.
 * While `src` is empty the page shows a dashed placeholder describing what goes there.
 * CSP allows `'self'` and `https:` for images and `'self'`/`https:` for media.
 */
export interface MediaSpec {
  kind: "image" | "video";
  /** Accessible description of the final asset (used as alt / aria-label). */
  alt: string;
  /** Placeholder text: what to put here. */
  label: string;
  /** Recommended pixel size, also sets the aspect ratio of the slot. */
  width: number;
  height: number;
  /** Public path or https URL. Leave empty until the asset exists. */
  src: string;
  /** Videos only: poster image path. */
  poster?: string;
}

export const MEDIA = {
  /** Hero: main product shot next to the headline. */
  hero: {
    kind: "image",
    alt: "Bandeja compartida de WhatsApp de CRMWSP con una conversación y la respuesta sugerida por la IA",
    label: "Foto: captura del inbox con una conversación real",
    width: 1600,
    height: 1000,
    src: "", // e.g. "/landing/hero-inbox.webp"
  },
  /** Features showcase: AI answering from the catalog with a cited source. */
  showcaseAi: {
    kind: "image",
    alt: "Respuesta de la IA con la fuente del catálogo citada",
    label: "Foto: respuesta de la IA con la cita al catálogo visible",
    width: 1200,
    height: 900,
    src: "", // e.g. "/landing/showcase-ai.webp"
  },
  /** Features showcase: sales playbook editor. */
  showcasePlaybook: {
    kind: "image",
    alt: "Pantalla del playbook de ventas con las reglas y el tono del negocio",
    label: "Foto: pantalla del playbook de ventas",
    width: 1200,
    height: 900,
    src: "", // e.g. "/landing/showcase-playbook.webp"
  },
  /** Features showcase: quote and order built from a chat. */
  showcaseQuotes: {
    kind: "image",
    alt: "Presupuesto creado desde una conversación y su estado de pago",
    label: "Foto: presupuesto o pedido con el estado del pago",
    width: 1200,
    height: 900,
    src: "", // e.g. "/landing/showcase-quotes.webp"
  },
  /** Demo video section. */
  demoVideo: {
    kind: "video",
    alt: "Demostración de CRMWSP: de un mensaje de WhatsApp a un presupuesto cobrado",
    label: "Video: demo de 60 a 90 s (MP4 H.264, sin audio obligatorio)",
    width: 1920,
    height: 1080,
    src: "", // e.g. "/landing/demo.mp4"
    poster: "", // e.g. "/landing/demo-poster.webp"
  },
} as const satisfies Record<string, MediaSpec>;

/** Customer logos strip (SVG or PNG with transparent background). */
export const LOGOS: readonly MediaSpec[] = Array.from({ length: 5 }, (_, i) => ({
  kind: "image" as const,
  alt: `Logo del cliente ${i + 1}`,
  label: `Logo ${i + 1}`,
  width: 240,
  height: 96,
  src: "", // e.g. "/landing/logo-1.svg"
}));

export interface Testimonial {
  /** Leave `quote` empty to show a placeholder card. */
  quote: string;
  name: string;
  role: string;
  avatar: MediaSpec;
}

/** Fill with real customer quotes. Never publish invented testimonials. */
export const TESTIMONIALS: readonly Testimonial[] = Array.from({ length: 3 }, (_, i) => ({
  quote: "",
  name: "",
  role: "",
  avatar: {
    kind: "image" as const,
    alt: `Foto de la persona del testimonio ${i + 1}`,
    label: "Foto",
    width: 160,
    height: 160,
    src: "", // e.g. "/landing/testimonial-1.webp"
  },
}));

/** Owner-editable pricing teaser copy. No prices are published here. */
export const PRICING_TEASER = {
  from: "Planes desde [completar]",
  note: "[Completar: qué incluye el plan de entrada y cómo se factura.]",
};
