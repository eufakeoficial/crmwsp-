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
  title: "Atiende 100 chats como si fueran 1",
  lead: "Todos tus chats en un solo inbox: la IA responde en paralelo, cotiza, cobra y mueve cada venta a Pagado.",
  bullets: [
    "La IA contesta a varios clientes a la vez",
    "Cotiza y manda el link de pago (Yape o tarjeta)",
    "El pago confirmado pasa la venta a Pagado",
  ],
  cta: "Crear cuenta gratis",
  videoLabel: "Demo: el inbox de Vende+ WSP recibe muchos chats, la IA responde a tres clientes en paralelo, envía cotización y link de pago, y la venta pasa a Pagado en el pipeline.",
  name: "Demo: el inbox de Vende+ WSP con IA, cotización y cobro",
  description: "La IA de Vende+ WSP responde con el catálogo, envía la cotización y el link de pago, y el pago se confirma solo.",
  webm: "/videos/demo-negocio.webm",
  mp4: "/videos/demo-negocio.mp4",
  poster: "/videos/demo-negocio.jpg",
  uploadDate: "2026-10-23",
  duration: "PT25S",
} as const;

export const DEMO_VIDEO_PLAYBOOK = {
  eyebrow: "Playbook de IA",
  title: "Enséñale a tu IA a vender como tú",
  lead: "Define cómo responde a objeciones, cómo cierra y cuándo hace seguimiento. La IA lo aplica en cada chat.",
  bullets: [
    "Respuestas aprobadas para cada objeción",
    "Cierre suave o directo, a tu estilo",
    "Seguimiento automático si el cliente no responde",
  ],
  cta: "Crear cuenta gratis",
  videoLabel: "Demo: el dueño configura el Playbook de IA con una objeción de precio, y luego la IA responde a un cliente que dice que está caro, envía el link de pago y recibe el pago.",
  webm: "/videos/demo-playbook.webm",
  mp4: "/videos/demo-playbook.mp4",
  poster: "/videos/demo-playbook.jpg",
} as const;
