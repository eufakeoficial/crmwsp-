# ADR 0013 — Cobro de la suscripción SaaS con NOWPayments (cripto)

**Estado:** aceptado · **Fecha:** 2026-10-23 · **Relacionado:** ADR 0002, ADR 0011, ADR 0012

## Contexto
Hasta ahora el plan de cada tenant lo asignaba a mano un admin de plataforma y los pagos de la
suscripción se registraban manualmente en `subscription_payments` (ADR 0011). Necesitamos que el
tenant pueda pagar CRMWSP por sí mismo. Este ADR cubre **solo** el cobro de CRMWSP al tenant; el
cobro del tenant a sus propios clientes sigue en los proveedores locales existentes
(`payment_connections` / `payments`, Stripe y Mercado Pago) y no se toca.

## Decisión

### Proveedor y flujo
- **NOWPayments**, pago único por período (`POST {base}/payment`, `x-api-key`, timeout 15 s,
  `is_fixed_rate: true`, `pay_currency` por defecto `usdtbsc`). `base` por defecto
  `https://api.nowpayments.io/v1`; `NOWPAYMENTS_API_BASE` permite el sandbox.
- **Sin cobro recurrente del lado del proveedor**: cada pago concede 30 días. Renovar es pagar otra
  vez. El período nuevo empieza en `max(hoy, fin del período pagado)` y dura 30 días, así pagar antes
  de tiempo suma días en vez de perderlos.
- El precio sale de las definiciones de plan de `@crmwsp/billing` (`PLANS[*].priceMonthlyUsd`); no
  hay precios nuevos.
- Orden: primero se crea la fila local `subscription_charges` en `pending`, luego se llama a la API
  (`order_id` = id de la fila) y se guarda `payment_id` (normalizado a texto), dirección y monto.

### Confirmación del pago
- **IPN** en `POST /webhooks/nowpayments`, autenticada solo por `x-nowpayments-sig`: HMAC-SHA512
  (`NOWPAYMENTS_IPN_SECRET`) sobre `JSON.stringify` del cuerpo con claves ordenadas recursivamente
  (los arrays conservan el orden), hex, `timingSafeEqual` con control de longitud. Si falla: 401 y
  nada se guarda.
- Como todo webhook (CLAUDE.md), primero se persiste en `inbound_events` con
  `dedupe_key = nowpayments:{payment_id}:{status}` (función `ingest_nowpayments_event`, que resuelve
  el tenant desde la fila del cobro, nunca desde quien llama) y después el worker liquida.
- **Reconciliación**: un job repetible del worker (cada 5 min) consulta `GET /payment/{id}` de los
  cobros `pending` con más de 5 minutos y los pasa por el **mismo** camino de liquidación, con prefijo
  de dedupe `reconcile:`. También recupera IPN perdidas o encolados fallidos.

### Reglas de liquidación (`decideSettlement` + `subscription_charge_apply`)
- `paid` solo si el estado es `finished` o `confirmed` **y** `actually_paid >= pay_amount`
  (comparación decimal exacta, sin floats; un monto ausente o malformado = no pagado), además de
  `order_id` igual al cobro, `price_currency` igual sin distinguir mayúsculas y `price_amount` exacto.
- `partially_paid`, `waiting`, `confirming`, `sending` → `pending`. `failed`, `expired`, `refunded`
  se mapean a sus estados.
- `paid` y `refunded` son terminales: después de `paid` solo se acepta `refunded`.
- La transición a `paid` es una actualización condicional con bloqueo de fila y, en la misma
  transacción, crea la fila de `subscription_payments` (`method = 'nowpayments'`, `charge_id`) que
  define el período, y actualiza `tenant_plans.plan`. `paid` exige `verified_by = webhook |
  reconciliation`; nunca hay marcado por imagen ni por la UI.
- `payin_hash` es único: un mismo depósito no puede liquidar dos cobros.
- Un reembolso revoca el período (borra la fila derivada de `subscription_payments`; el cobro queda
  como registro auditado y hay entrada en `platform_audit_events`).

### Suspensión segura
- `paid_until` = máximo `period_end` de `subscription_payments` (la misma fuente que ya usa el
  backoffice). Estados: `unbilled` (nunca pagó por la plataforma), `active`, `grace` (hasta 3 días
  después) y `restricted`.
- `restricted` usa el mecanismo existente de límites del plan: todos los límites pasan a "no
  incluido" (sin IA, sin difusiones, sin crecer contactos/usuarios/números) y el worker no programa
  turnos de IA. El tenant conserva acceso de lectura a todos sus datos. **Nunca se borra nada.**
- `unbilled` no se restringe: los tenants existentes, que pagan de forma manual o aún no pagan, no
  quedan bloqueados al desplegar esto.

### Datos y seguridad
- `subscription_charges` (0062/0063) tiene `tenant_id`, RLS forzada y es de **solo lectura** para el
  rol de la app. Toda escritura pasa por funciones `SECURITY DEFINER` que toman el tenant de
  `app.tenant_id`. `subscription_payments` sigue inaccesible para la app; el tenant solo ve su
  `paid_until` mediante `tenant_subscription_paid_until()`.
- La API key y el secreto IPN viven solo en variables de entorno; nunca se registran ni se
  devuelven (`toJSON` del adaptador no los expone; los logs solo nombran la clase de error).

## Alternativas descartadas
- **Stripe Billing / suscripciones recurrentes**: buena parte del mercado objetivo (LATAM) no tiene
  tarjetas internacionales; el cobro recurrente en cripto no es fiable.
- **Cobro recurrente de NOWPayments**: exige gestión de suscriptores y correos del lado del
  proveedor; el pago por período es más simple y suficiente.
- **Confiar en la IPN sin persistir**: rompe la regla de `inbound_events` y la idempotencia.

## Consecuencias
- Nuevo valor `nowpayments` en el enum `channel_provider` (solo para `inbound_events`; no está en el
  enum TS de canales).
- `subscription_payments.method` admite `nowpayments`; el alta manual del backoffice sigue sin
  permitirlo.
- Reembolso con períodos apilados (0064): al reembolsar un cobro pagado, los cobros pagados
  posteriores se re-apilan bajo el mismo advisory lock y en la misma transacción, como si el
  período reembolsado no hubiera existido (cada uno empieza en max(día de su pago, fin del período
  anterior restante) y dura 30 días), y sus filas derivadas de `subscription_payments` se mueven con
  ellos. Los períodos manuales del backoffice nunca se mueven.
- En estado `restricted` también se bloquea el envío manual de mensajes y plantillas desde la
  bandeja (402 `PLAN_LIMIT_EXCEEDED`, `reason = subscription_restricted`), y el modo dueño no llama
  a la IA.
- Pendiente: mostrar un QR de la dirección de depósito; no hay librería de QR en el workspace y no
  se añade dependencia sin justificarla, así que hoy se muestra la dirección como texto copiable.
- Pendiente: si existe un período manual posterior a un cobro reembolsado, no se desplaza; se
  corrige a mano desde el backoffice.
