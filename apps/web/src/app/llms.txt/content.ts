import { COMPARISON_COLUMNS, COMPARISON_ROWS, DEFINITION, FAQ, FEATURE_LIST, INTEGRATIONS, STEPS } from "@/components/landing/content";
import { CONTENT_LAST_MODIFIED, getSiteUrl, SITE_NAME } from "@/lib/site";

/** Plain-text/Markdown responses for AI crawlers. Only facts that also appear on the public landing. */
export const LLMS_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=86400",
} as const;

const DIFFERENTIATORS = [
  "**La IA solo responde con fuentes.** Toda afirmación de precio, stock o plazo cita el catálogo del negocio; sin cita, la conversación pasa a una persona.",
  "**Pagos verificados.** Un pago pasa a pagado solo por confirmación del proveedor (webhook) o por conciliación. Una imagen de comprobante nunca basta; la única excepción es el marcado manual auditado por un owner o admin.",
  "**WhatsApp oficial.** La conexión usa un proveedor oficial de la API de WhatsApp Business (BSP); no se usan librerías no oficiales.",
  "**Datos aislados por empresa.** Cada empresa trabaja en su propio espacio y las claves se guardan cifradas.",
] as const;

function links(base: string): string {
  return [
    `- [Inicio](${base}/): descripción del producto, funciones y preguntas frecuentes`,
    `- [Crear cuenta](${base}/signup)`,
    `- [Ingresar](${base}/login)`,
    `- [Versión extendida para IA](${base}/llms-full.txt)`,
  ].join("\n");
}

export function buildLlmsTxt(): string {
  const base = getSiteUrl();
  return `# ${SITE_NAME}

> ${DEFINITION}

Última actualización: ${CONTENT_LAST_MODIFIED}. Idioma: español (Latinoamérica).

## Para quién es

Negocios de servicios que cotizan y venden por WhatsApp y necesitan que su equipo, la IA y los cobros trabajen sobre la misma conversación.

## Funciones principales

${FEATURE_LIST.map((f) => `- ${f}`).join("\n")}

## Integraciones

${INTEGRATIONS.map((i) => `- ${i}`).join("\n")}

## Enlaces

${links(base)}
`;
}

export function buildLlmsFullTxt(): string {
  const base = getSiteUrl();
  const table = [
    `| Capacidad | ${COMPARISON_COLUMNS.join(" | ")} |`,
    `| --- | ${COMPARISON_COLUMNS.map(() => "---").join(" | ")} |`,
    ...COMPARISON_ROWS.map(({ capability, cells }) => `| ${capability} | ${cells.join(" | ")} |`),
  ].join("\n");
  return `# ${SITE_NAME}: documentación extendida

> ${DEFINITION}

Última actualización: ${CONTENT_LAST_MODIFIED}. Idioma: español (Latinoamérica). Sitio: ${base}

## Qué es

${SITE_NAME} es un CRM de WhatsApp con IA para negocios de servicios que envían presupuestos. Cubre el recorrido completo: primer mensaje, atención con IA y equipo, presupuesto, cobro verificado y seguimiento.

## Para quién es

Negocios de servicios de Latinoamérica que cotizan por WhatsApp y que, al crecer el equipo, pierden mensajes, precios y cobros. Problemas que resuelve:

- Mensajes perdidos entre chats personales y celulares del equipo: inbox compartido con historial por cliente y asignación.
- Cotizar a mano y perseguir el pago después: presupuestos y pedidos desde la conversación, con cobro verificado.
- Un bot que inventa precios: IA que cita el catálogo o deriva a una persona.
- Cada vendedor responde a su manera: un playbook de ventas fija el tono y las reglas.

## Funciones

${FEATURE_LIST.map((f) => `- ${f}`).join("\n")}

## Cómo funciona

${STEPS.map(({ title, text }, i) => `${i + 1}. **${title}.** ${text}`).join("\n")}

## Qué lo diferencia

${DIFFERENTIATORS.map((d) => `- ${d}`).join("\n")}

## Integraciones

- **WhatsApp, mediante Gupshup** (proveedor oficial de la API de WhatsApp Business).
- **MercadoPago** y **NOWPayments** como proveedores de pago; la disponibilidad por país puede variar.
- **Meta Ads**: lectura de la atribución de anuncios que llevan a WhatsApp.
- IA con clave propia del cliente (BYOK) o créditos incluidos; el consumo con clave propia se paga directo al proveedor de IA.

## Comparación por capacidades

Comparación por categorías de producto; las funciones exactas de cada herramienta varían.

${table}

## Preguntas frecuentes

${FAQ.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}

## Enlaces

${links(base)}
`;
}
