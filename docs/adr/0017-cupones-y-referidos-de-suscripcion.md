# ADR 0017 — Cupones y referidos en el cobro de la suscripción

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0011, ADR 0013, ADR 0015

## Contexto
El cobro SaaS (ADR 0013/0015) solo admitía el precio de lista del plan por período. Queremos
descuentos creados por el equipo de la plataforma (cupones) y un programa de referidos, sin abrir
ninguna vía para que un tenant fije su propio precio ni se marque un período como pagado.

## Decisión

### Cupones (migración 0071)
- `coupons` es una tabla **de plataforma** (no tiene `tenant_id`): RLS forzado sin políticas y
  sin privilegios para `crmwsp_app`, igual que `trial_claims`. Solo se lee/escribe con funciones
  `SECURITY DEFINER`; las de administración (`platform_coupon_*`) verifican
  `platform_assert_admin_internal` y auditan en `platform_audit_events`.
- Campos: `code` (único, normalizado a mayúsculas: insensible a mayúsculas), `type`
  `percent | fixed_usd | free_days`, `value`, `plans` (vacío = todos), `period`
  `monthly | annual | any`, `max_redemptions`, `per_tenant_limit` (1 por defecto),
  `valid_from/until`, `active`, `created_by`. Código y tipo son inmutables; el valor también una
  vez usado. Solo se puede borrar un cupón nunca usado (si no, se desactiva).
- `coupon_redemptions` es **por tenant** (RLS de lectura del propio tenant, escritura solo vía
  funciones). Un uso se cuenta cuando el cobro se liquida como pagado, o al instante en los canjes
  sin pago.

### Precio en el servidor e invariante de liquidación
- `POST /billing/subscription/quote` y `POST /billing/subscription/charges` aceptan `couponCode`.
  El cliente nunca envía un precio. La API calcula la vista previa con `@crmwsp/billing`
  (`quoteCharge`), pero el precio que se guarda lo recalcula SQL
  (`subscription_charge_create_with_coupon`) con el cupón bloqueado (`FOR UPDATE`).
- Cada cobro guarda `list_price_amount`, `discount_amount`, `coupon_id/coupon_code` y
  `price_amount` = precio **final**; un `CHECK` exige `price_amount + discount_amount =
  list_price_amount`. NOWPayments recibe el precio final leído de la base.
- **Invariante:** `decideSettlement` solo liquida si `price_amount` = precio del plan para el
  período (`periodPriceUsd`) − `discount_amount`, con un descuento de 0..lista en centavos y precio
  final > 0. Cualquier otro valor es `mismatch` (se ignora, no se marca pagado). Así un cobro no
  puede otorgar 365 días por un precio mensual ni un descuento inventado.
- Redondeo: porcentaje en centavos con redondeo hacia arriba en la mitad; fijo topeado al precio
  de lista. La función SQL `coupon_discount_internal` replica exactamente `discountCents`.

### Límite de usos sin carreras
- Usos = canjes registrados + "reservas": cobros pendientes con ese cupón de menos de 24 h.
  La creación bloquea la fila del cupón y comprueba `max_redemptions` y `per_tenant_limit`
  contando ambos, así dos checkouts simultáneos no pueden superar el máximo.
- Al liquidarse un cobro con cupón, el canje se registra siempre (`ON CONFLICT (charge_id) DO
  NOTHING`): el dinero ya se recibió al precio con descuento.

### Canjes sin pago: 100 % y días gratis
- Un descuento que cubre el precio de lista o un cupón `free_days` **no llama a NOWPayments**:
  `subscription_coupon_grant` inserta un cobro ya liquidado con `price_amount = 0`,
  `verified_by = 'coupon'`, sin `provider_payment_id`, su fila derivada en
  `subscription_payments` (`method = 'coupon'`, importe 0) y el canje, todo en una transacción y
  auditado (`subscription_charge.coupon_granted`). El período se apila igual que uno pagado.
  `free_days` usa el plan actual del tenant y `period_days` = días del cupón (1..365).
- Idempotencia: un segundo canje del mismo cupón por el mismo tenant en 2 minutos devuelve el
  mismo cobro; después rige `per_tenant_limit`.
- **Por qué no viola "paid solo por webhook | reconciliation":** esa regla (CLAUDE.md, ADR 0012,
  ADR 0013) protege que un pago **con dinero** se declare recibido sin evidencia del proveedor.
  Un canje sin pago no declara dinero recibido: su importe es 0, es la plataforma quien concede
  el período (como el registro manual de pagos de ADR 0011) y queda trazado con un
  `verified_by` propio. Los `CHECK` garantizan que `verified_by = 'coupon'` solo existe con
  precio 0 y sin pago del proveedor, y `subscription_charge_apply` sigue rechazando
  `verified_by` distinto de `webhook | reconciliation` e ignora cualquier notificación sobre un
  canje. Los pedidos de clientes finales no cambian.

## Consecuencias
- Un cobro pendiente con cupón reserva un uso hasta 24 h; si se paga después de ese plazo, el
  canje se registra igual y puede superar `max_redemptions` (riesgo acotado y visible en el
  backoffice).
- Un tenant con `per_tenant_limit = 1` y un cobro pendiente con el cupón no puede crear otro con
  ese cupón (otro plan o período) hasta pagar o pasadas 24 h.
- Un reembolso de un cobro con cupón no devuelve el uso.
