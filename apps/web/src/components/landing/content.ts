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
