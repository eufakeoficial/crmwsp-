# ADR 0012 — Pagos marcados a mano y webhooks autenticados solo por token

**Estado:** aceptado · **Fecha:** 2026-10-21 · **Relacionado:** ADR 0004, ADR 0009, ADR 0010 · **Origen:** auditoría cyber-neo (CN-016, CN-023, CN-024)

## Contexto
La regla de CLAUDE.md dice que un pedido solo pasa a `paid` con `verified_by = webhook | reconciliation`.
Hay dos situaciones reales que no encajan del todo: (a) el cliente paga por transferencia o en efectivo y
no existe ningún webhook que lo confirme; (b) varios proveedores no firman sus callbacks y solo podemos
autenticarlos con un secreto compartido. Este ADR deja por escrito ambas excepciones y sus límites.

## Decisión

### A. Marcar pagado a mano es una excepción acotada, no otro camino a `paid`
`markPaidManuallyTx` (`apps/api/src/commerce/orders.service.ts`) permite que un **owner/admin** del
tenant marque un pedido como pagado. Reglas:
- Exige `reason` (texto obligatorio). Queda auditado en el historial del pedido con
  `reason = "pago manual: …"`, `verifiedBy = 'manual'`, `verifiedByUserId` (el actor) y
  `method = 'manual'` o `'receipt_review'` si se adjunta un `paymentReviewId`.
- Nunca escribe `verified_by = 'webhook'`. Hace la misma transición `mark_paid` y confirma stock
  (`commit_stock`) que un pago verificado, pero el origen queda marcado de forma distinta.
- Una revisión de comprobante (`receipt_review`) sigue siendo un pago **manual**: la imagen no verifica
  nada, solo documenta la decisión humana.

**Ingresos, ROAS y rentabilidad cuentan solo `webhook | reconciliation`.** Las consultas de
`apps/api/src/analytics/profitability.service.ts` y `apps/api/src/ads/ads.queries.ts` filtran por
`verified_by in ('webhook','reconciliation')`; los pagos manuales no entran en métricas de dinero.
Cualquier consulta nueva de ingresos hereda este filtro.

**Automatizaciones sobre `order.paid` deben distinguir `manual`.** El evento lleva `verifiedBy`; una
automatización que entregue acceso, descuentos o avisos de "pago confirmado" tiene que decidir
explícitamente si acepta `manual`. Por defecto, no.

### B. Proveedores autenticados solo por un token secreto en la URL o en el cuerpo
- **Gupshup inbound** (`packages/whatsapp/src/webhook-token.ts`): no documenta firma; la URL de callback
  lleva un token por conexión de **256 bits** (`randomBytes(32)`, base64url).
- **Gumroad / Hotmart / Payhip** (`packages/integrations/src/adapters/infoproducts.ts`): esquemas
  débiles (`seller_id`, `hottok` estático, `sha256(apiKey)` en el cuerpo). No firman el payload ni
  tienen protección contra replay.

Riesgos aceptados: quien obtenga el token (logs, proxies, captura de URL) puede inyectar eventos.
Mitigaciones obligatorias:
1. Tokens de ≥256 bits generados por el servidor; nunca elegidos por el usuario.
2. Comparación en tiempo constante (`safeEqualToken` / `safeEqualText`, hash + `timingSafeEqual`).
3. Dedupe por `inbound_events.dedupe_key` antes de cualquier worker; un replay no genera un segundo pago
   ni dispara dos automatizaciones.
4. Rate limit por conexión en el endpoint de webhook.
5. Rotación del token desde el panel sin perder la conexión; el token no se escribe en logs de acceso.
6. Validación estricta del payload (Zod) y, donde el proveedor lo ofrece, confirmación por API antes
   de marcar `paid`.
7. La UI muestra un aviso al conectar estos proveedores: "autenticado solo por token; trátalo como una
   contraseña y rótalo si se filtra".

## Consecuencias
- `verified_by` admite tres valores con semántica distinta: `webhook` y `reconciliation` son prueba de
  cobro; `manual` es una decisión humana auditada. Solo los dos primeros valen para dinero.
- Toda integración nueva con "solo token" debe aplicar la lista de mitigaciones completa antes de
  habilitarse; si el proveedor ofrece firma HMAC, se usa la firma y este ADR no aplica.
- Pendiente: exponer `verifiedBy` en los filtros de automatizaciones y en la lista de pedidos.
