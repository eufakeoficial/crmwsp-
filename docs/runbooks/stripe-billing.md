# Runbook — Cobro con tarjeta (Stripe Billing)

Decisión y diseño: `docs/adr/0022-cobro-con-tarjeta-stripe-billing.md`. Mientras `STRIPE_SECRET_KEY`
esté vacía la función está apagada y la pantalla de suscripción solo muestra cripto.

## Alta en Stripe (la hace el propietario)
1. Crear (o usar) la cuenta de Stripe de la plataforma y activar pagos con tarjeta.
2. Crear 4 **Precios recurrentes en USD** en un único Producto por plan (sin impuestos incluidos):
   - Start mensual 49,00 · Start anual 490,00
   - Pro mensual 89,00 · Pro anual 890,00
3. Crear un **webhook** apuntando a `https://<api-publica>/webhooks/stripe-billing` con los eventos:
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
4. Activar el **portal de clientes** (Settings → Billing → Customer portal): permitir actualizar tarjeta,
   cancelar y ver facturas. No permitir cambiar de precio desde el portal (los cambios de plan se hacen
   desde la pantalla de suscripción).
5. No activar códigos promocionales ni Stripe Tax en estos precios (el importe cobrado debe ser el del plan).

## Variables de entorno
Se documentan aquí porque `.env.example` no estaba accesible para la sesión que implementó esto; añadir
las mismas líneas (vacías) allí.

```
# API (y worker para los price ids). Sin STRIPE_SECRET_KEY la función queda apagada.
STRIPE_SECRET_KEY=            # sk_live_... / sk_test_...  (solo API)
STRIPE_WEBHOOK_SECRET=        # whsec_...  (solo API)
STRIPE_PRICE_START_MONTHLY=   # price_...  (API y worker)
STRIPE_PRICE_START_ANNUAL=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=
# Opcional: STRIPE_API_BASE (solo para pruebas con un mock)
```
Nunca subir claves reales al repositorio. Las variables se cargan en el despliegue de API y worker.

## Pruebas con Stripe CLI (modo test)
```
stripe listen --forward-to <api-local>/webhooks/stripe-billing
stripe trigger invoice.paid   # solo liquida si el cliente y el price id existen en nuestra base
```
Flujo real de prueba: iniciar sesión como owner → Suscripción → "Suscribirme" → tarjeta `4242 4242 4242 4242`.
Debe aparecer un cargo `provider = stripe`, `verified_by = webhook` y `paid_until` extendido.

## Operación
- **Estado de eventos**: `inbound_events` (`provider = 'stripe'`). Una fila con `error` no nulo necesita
  revisión: `amount_mismatch` / `unknown_price` / `currency_mismatch` (precio mal configurado, descuento o
  moneda ajena), `unknown_customer` (cliente de otro tenant).
- **Pago recibido pero sin período**: revisar el `error` del evento; corregir el price id o el importe en
  Stripe y reenviar el evento desde el panel de Stripe (la liquidación es idempotente).
- **Reembolsos/disputas**: no revocan el período solos; gestionarlos desde el backoffice de plataforma.
- **Fallo de tarjeta**: Stripe reintenta; la pantalla muestra "Pago fallido". Si no se cobra, el período
  vence y se aplican los 3 días de gracia y luego el modo solo lectura (nada se borra).
- **Mercado Pago**: siguiente paso documentado en el ADR 0022 (no implementado).
