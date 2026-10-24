import type { SiteAssistantActionKind } from "@crmwsp/contracts";

/** Deterministic keyword router: used when there is no key, the provider fails, the breaker is open or the daily cap is reached. */
export interface FallbackReply {
  reply: string;
  action: SiteAssistantActionKind | null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const RULES: { match: RegExp; reply: string; action: SiteAssistantActionKind | null }[] = [
  { match: /\b(demo|demostracion|reunion|llamada|asesor|vendedor|ventas|humano|persona|contacto|hablar)\b/, reply: "¡Con gusto! Escríbenos por WhatsApp y coordinamos una demo con tu caso, o crea tu cuenta gratis para probarlo hoy.", action: "whatsapp" },
  { match: /\b(inventa|invente|equivoca|equivocad|alucina|mentir|precios? equivocad)/, reply: "No: la IA solo afirma precios, stock o plazos si puede citar tu catálogo. Si no encuentra el dato, deriva la conversación a una persona de tu equipo.", action: "faq" },
  { match: /\b(precio|precios|cuesta|cuanto|costo|plan|planes|tarifa|suscripcion|pagar el servicio)\b/, reply: "No tengo los precios a mano por aquí. Puedes empezar gratis y ver los planes desde tu cuenta, o escribirnos para que te asesoremos.", action: "pricing" },
  { match: /\b(cobr|pago|pagos|pagar|mercadopago|nowpayments|comprobante|factura)/, reply: "Envías el presupuesto desde el chat y cobras con MercadoPago o NOWPayments. El pago se marca como pagado solo cuando el proveedor lo confirma, nunca por una imagen de comprobante.", action: "how_it_works" },
  { match: /\b(whatsapp|numero|conectar|conecto|api|bsp|gupshup)\b/, reply: "Conectas tu número de WhatsApp Business mediante un proveedor oficial de la API (BSP); no usamos librerías no oficiales. Te guiamos en el proceso.", action: "how_it_works" },
  { match: /\b(funciona|empezar|pasos|configurar|instalar|como se usa)\b/, reply: "Son cuatro pasos: conectas tu número, cargas tu catálogo y playbook, atiendes con tu equipo y la IA, y cotizas y cobras desde la conversación.", action: "how_it_works" },
  { match: /\b(seguro|seguridad|datos|privacidad|aislad|clave|byok)\b/, reply: "Los datos de cada empresa están aislados y las claves se guardan cifradas. Además puedes usar tu propia clave de IA (BYOK).", action: "faq" },
  { match: /\b(cuenta|registr|gratis|probar|prueba)\b/, reply: "Puedes crear tu cuenta gratis y empezar a configurar tu WhatsApp, tu catálogo y tu equipo.", action: "signup" },
];

const DEFAULT: FallbackReply = {
  reply: "Vende+ WSP es un CRM para WhatsApp con IA: bandeja de equipo, respuestas que citan tu catálogo, presupuestos y cobros confirmados por el proveedor. ¿Qué te gustaría saber?",
  action: "faq",
};

export function fallbackReply(lastUserMessage: string): FallbackReply {
  const text = norm(lastUserMessage);
  for (const r of RULES) if (r.match.test(text)) return { reply: r.reply, action: r.action };
  return DEFAULT;
}
