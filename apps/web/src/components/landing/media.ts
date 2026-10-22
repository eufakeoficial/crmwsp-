/**
 * Single source of truth for every image/video slot on the public landing page.
 *
 * To fill a slot: drop the file in `apps/web/public/landing/` (see the README there)
 * and set `src` to its public path, e.g. `src: "/landing/crm-laptop.png"`.
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
    alt: "Bandeja de conversaciones de CRMWSP en una laptop: lista de chats, conversación con un cliente y su cotización enviada",
    label: "Foto: captura del inbox con una conversación real",
    width: 1672,
    height: 941,
    src: "/landing/crm-laptop.png",
  },
  /** Features showcase: AI answering from the catalog with a cited source. */
  showcaseAi: {
    kind: "image",
    alt: "Chat donde la IA responde el precio de un kit solar y cita la fuente: Catálogo 2026",
    label: "Foto: respuesta de la IA con la cita al catálogo visible",
    width: 1448,
    height: 1086,
    src: "/landing/ai-chat-solar.png",
  },
  /** Features showcase: sales playbook editor. */
  showcasePlaybook: {
    kind: "image",
    alt: "Playbook de ventas con cinco etapas y respuestas sugeridas a objeciones comunes",
    label: "Foto: pantalla del playbook de ventas",
    width: 1448,
    height: 1086,
    src: "/landing/sales-playbook.png",
  },
  /** Features showcase: quote and order built from a chat. */
  showcaseQuotes: {
    kind: "image",
    alt: "Presupuesto aceptado con el pago verificado y su línea de tiempo: enviado, aceptado y pagado",
    label: "Foto: presupuesto o pedido con el estado del pago",
    width: 1448,
    height: 1086,
    src: "/landing/quote-accepted.png",
  },
  /** Demo video section. */
  demoVideo: {
    kind: "video",
    alt: "Demostración de CRMWSP: WhatsApp, IA, presupuesto y pago conectados en un solo flujo",
    label: "Video: demo de 60 a 90 s (MP4 H.264, sin audio obligatorio)",
    width: 1672,
    height: 940,
    src: "", // e.g. "/landing/demo.mp4"
    poster: "/landing/automation-neon.png",
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
