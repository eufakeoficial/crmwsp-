export interface Labels {
  quote: string;
  issued: string;
  validUntil: string;
  from: string;
  to: string;
  taxId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  tax: string;
  amount: string;
  subtotal: string;
  discountTotal: string;
  taxLine: string;
  total: string;
  notes: string;
  terms: string;
  payOnline: string;
  payHint: string;
  page: (page: number, pages: number) => string;
}

const es: Labels = {
  quote: "PRESUPUESTO",
  issued: "Fecha de emisión",
  validUntil: "Válido hasta",
  from: "DE",
  to: "PARA",
  taxId: "NIF",
  description: "Descripción",
  quantity: "Cant.",
  unitPrice: "Precio unit.",
  discount: "Dto.",
  tax: "Imp.",
  amount: "Importe",
  subtotal: "Subtotal",
  discountTotal: "Descuento",
  taxLine: "Impuesto",
  total: "Total",
  notes: "Notas",
  terms: "Condiciones",
  payOnline: "Pagar online",
  payHint: "Escanea el código o abre el enlace para pagar:",
  page: (p, n) => `Página ${p} de ${n}`,
};

const en: Labels = {
  quote: "QUOTE",
  issued: "Issue date",
  validUntil: "Valid until",
  from: "FROM",
  to: "TO",
  taxId: "Tax ID",
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  discount: "Disc.",
  tax: "Tax",
  amount: "Amount",
  subtotal: "Subtotal",
  discountTotal: "Discount",
  taxLine: "Tax",
  total: "Total",
  notes: "Notes",
  terms: "Terms",
  payOnline: "Pay online",
  payHint: "Scan the code or open the link to pay:",
  page: (p, n) => `Page ${p} of ${n}`,
};

/** Spanish for `es*`, English otherwise. */
export function labelsFor(locale: string): Labels {
  return locale.toLowerCase().startsWith("es") ? es : en;
}
