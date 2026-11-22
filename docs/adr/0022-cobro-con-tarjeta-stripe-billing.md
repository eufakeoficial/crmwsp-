# ADR 0022 — Cobro de la suscripción SaaS con tarjeta y renovación automática (Stripe Billing)

**Estado:** aceptado · **Fecha:** 2026-11-18 · **Relacionado:** ADR 0011, ADR 0012, ADR 0013, ADR 0015, ADR 0017

## Contexto
La suscripción de CRMWSP solo se podía pagar en cripto (NOWPayments, ADR 0013): un pago único por
período, sin renovación automática. La mayoría de los clientes espera pagar con tarjeta y que el plan
se renueve solo. Este ADR añade esa vía **junto a** NOWPayments, que no se toca. El cobro del tenant a
sus propios clientes (`payment_connections`, ADR 0012) tampoco cambia.

## Decisión

### Proveedor
- **Stripe Billing** con claves de la plataforma (`STRIPE_SECRET_KEY`), por HTTPS directo (sin SDK: no
  se añade dependencia). Checkout en modo `subscription`, portal de cliente para cambiar tarjeta,
  cancelar y ver facturas. Los códigos promocionales de Stripe quedan desactivados: el precio es
  exactamente el del plan.
- Un cliente de Stripe por tenant (`subscription_billing_accounts`, una fila por tenant). La creación es
  idempotente (`Idempotency-Key: crmwsp-customer-{tenantId}`) y el guardado es único por tenant.
- Precios en USD, mapeados a los planes existentes por variables de entorno (4 price ids): Start 49/490
  y Pro 89/890 (`packages/billing/src/index.ts`). Los importes no cambian ni se duplican en código: el
  worker compara el importe pagado con el precio del plan.

### Confirmación del pago: `paid` solo por webhook verificado
- `POST /webhooks/stripe-billing`, autenticado solo por `Stripe-Signature` (HMAC-SHA256 sobre el cuerpo
  crudo, tolerancia de 5 min, reutiliza `verifyStripeSignature`). Sin firma válida: 401 y nada se guarda.
- Como todo webhook (CLAUDE.md), primero se persiste en `inbound_events` (`provider = 'stripe'`,
  `dedupe_key = stripe_billing:{event.id}`) mediante `ingest_stripe_billing_event` (SECURITY DEFINER),
  que resuelve el tenant **por el id de cliente de nuestra propia tabla**, nunca por metadatos del payload.
  Después el worker liquida (misma cola `subscription-billing`, job `settle-stripe-billing-event`).
- Eventos: `checkout.session.completed` (solo enlaza la suscripción; volver de Checkout nunca concede
  acceso), `invoice.paid` (liquida), `invoice.payment_failed` (refleja `past_due`),
  `customer.subscription.updated` / `.deleted` (reflejan estado, plan y fin de período).
- **Liquidación** (`decideStripeInvoice` + `stripe_invoice_settle`): factura `paid`, price id conocido,
  moneda USD e importe **exactamente** igual al del plan y período. Cualquier otra cosa (precio ajeno,
  descuento, otra moneda) no se liquida y queda anotada en `inbound_events.error` para revisión manual.
  La función SQL repite los invariantes: la factura pertenece al cliente del tenant y cada factura
  liquida una sola vez (`subscription_charges.provider_payment_id` es único), de modo que reintentos y
  eventos desordenados nunca conceden dos períodos.
- Cada factura pagada crea un cargo `provider = 'stripe'`, `verified_by = 'webhook'` y su fila en
  `subscription_payments` (`method = 'stripe'`, valor ya permitido desde 0062). El período empieza en
  `max(hoy, fin del período pagado)` y dura 30 o 365 días: la misma regla de apilado que NOWPayments, así
  que las renovaciones extienden en vez de solaparse.

### Gracia y solo lectura (sin lógica nueva)
- El acceso sigue dependiendo únicamente de `paid_until` (máximo `period_end` de `subscription_payments`,
  ADR 0013): 3 días de gracia y luego solo lectura. Si la tarjeta falla o el cliente cancela, simplemente
  no llega otra factura pagada y se aplica el comportamiento existente; nunca se borra nada.
- El estado espejo de Stripe (`subscription_billing_accounts.status`, `cancel_at_period_end`,
  `current_period_end`) es **informativo**: no concede ni revoca acceso. Un evento antiguo que llega
  tarde no pisa a uno nuevo (`status_event_at`).

### Datos y seguridad
- `subscription_billing_accounts` (migración 0102) tiene `tenant_id`, RLS forzada y es de **solo
  lectura** para el rol de la app; toda escritura pasa por funciones SECURITY DEFINER con `search_path`
  fijo (`stripe_billing_account_attach`, `ingest_stripe_billing_event`, `stripe_invoice_settle`,
  `stripe_billing_subscription_sync`). Test de aislamiento entre tenants y de escritura denegada.
- Claves y secreto del webhook solo en variables de entorno; nunca en logs ni respuestas. La API solo
  devuelve URLs alojadas en Stripe y la web solo las sigue si son `https://*.stripe.com`.

### Desactivado limpiamente
- Sin `STRIPE_SECRET_KEY` o sin price ids: `GET /billing/card` devuelve `enabled: false` y la UI no
  muestra la opción; `checkout` y `portal` responden 502 con mensaje genérico; el webhook responde 401 si
  falta `STRIPE_WEBHOOK_SECRET`. NOWPayments sigue funcionando igual.

## Variables de entorno
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_START_MONTHLY`, `STRIPE_PRICE_START_ANNUAL`,
`STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL` (API y worker; el worker solo necesita los price
ids). Opcional: `STRIPE_API_BASE`. Detalle de alta en `docs/runbooks/stripe-billing.md`.

## Alternativas descartadas
- **Mercado Pago ahora**: encaja mejor en LATAM (cuotas, medios locales) pero sus suscripciones
  (`preapproval`) tienen otro modelo de eventos y de estados; hacerlo bien exige su propio adaptador,
  webhook y pruebas. **Siguiente paso documentado**: un adaptador `MercadoPagoSubscriptions` que alimente
  la misma liquidación (`subscription_charges` + `subscription_payments`, `verified_by = webhook`), con su
  propio ADR. El resto de la arquitectura (periodos apilados, gracia, solo lectura) ya lo soporta.
- **Reutilizar `subscription_charges` en estado `pending` para Stripe**: Stripe crea la factura y cobra
  solo; no hay un cargo pendiente local que reconciliar. Se inserta el cargo ya pagado al llegar el webhook.
- **Fiarse de la redirección de Checkout o de los metadatos**: rompe la regla de `paid` solo por webhook.
- **Descuentos/cupones de Stripe**: los cupones propios (ADR 0017) solo aplican al flujo cripto; en tarjeta
  un descuento haría que el importe no coincida y la factura no se liquide. Soportarlos queda para un ADR futuro.

## Consecuencias
- Reembolsos y disputas en Stripe (`charge.refunded`, `charge.dispute.*`) no revocan el período
  automáticamente en esta versión: se gestionan a mano desde el backoffice de plataforma (como los pagos
  manuales, ADR 0011). Es el siguiente refinamiento si el volumen lo pide.
- Si cambian los precios del plan hay que crear nuevos precios en Stripe y actualizar los price ids; las
  facturas con el importe antiguo dejarán de liquidarse (`amount_mismatch`) hasta alinearlos.
- Impuestos: no se activa Stripe Tax; el importe cobrado debe ser el precio del plan. Si el negocio
  empieza a cobrar impuestos habrá que comparar contra el subtotal.
