/** Landing copy lives in @crmwsp/contracts so the API site assistant answers from the same source. */
export { COMPARISON_COLUMNS, COMPARISON_ROWS, DEFINITION, FAQ, FEATURE_LIST, INTEGRATIONS, STEPS } from "@crmwsp/contracts";

export const INTEGRATIONS_SECTION = {
  title: "Se integra con lo que ya usas",
  lead: "WhatsApp oficial, tu tienda y tus cobros conectados desde el primer día.",
  logos: [
    { name: "Meta", caption: "WhatsApp Business API oficial de Meta", alt: "Logotipo de Meta", src: "/brand/integrations/meta.png", width: 600, height: 129 },
    { name: "Gupshup", caption: "Proveedor oficial de la API (BSP)", alt: "Logotipo de Gupshup", src: "/brand/integrations/gupshup.png", width: 600, height: 147 },
    { name: "WooCommerce", caption: "Tu catálogo de tienda online", alt: "Logotipo de WooCommerce", src: "/brand/integrations/woocommerce.png", width: 600, height: 126 },
    { name: "NOWPayments", caption: "Cobros en cripto", alt: "Logotipo de NOWPayments", src: "/brand/integrations/nowpayments.png", width: 600, height: 219 },
  ],
} as const;

export const DEMO_VIDEO = {
  eyebrow: "Así vende tu negocio",
  title: "Una venta completa, sin que nadie conteste",
  lead: "La IA responde con tu catálogo, envía la cotización y el link de pago, y el pago se confirma solo.",
  bullets: [
    "Responde a las 23:47 con precio y stock",
    "Cotiza y manda el link de pago (Yape o tarjeta)",
    "Marca pagado cuando el proveedor lo confirma",
  ],
  cta: "Crear cuenta gratis",
  videoLabel: "Demo: la IA atiende un chat de WhatsApp de Killa Store, cotiza un polo, envía el link de pago y confirma el pago recibido a las 23:49.",
  name: "Demo: una venta completa por WhatsApp con IA",
  description: "La IA de Vende+ WSP responde con el catálogo, envía la cotización y el link de pago, y el pago se confirma solo.",
  webm: "/videos/demo-moda.webm",
  mp4: "/videos/demo-moda.mp4",
  poster: "/videos/demo-moda.jpg",
  uploadDate: "2026-10-23",
  duration: "PT24S",
} as const;
