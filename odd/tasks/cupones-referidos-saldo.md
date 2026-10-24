# Cupones, referidos y saldo NOWPayments

## Objetivo
Cupones de plataforma canjeables en el checkout de la suscripción, programa de referidos con
recompensa al primer pago real del referido, y tarjeta "Finanzas" de solo lectura con el saldo
vivo de NOWPayments en el backoffice.

## Restricciones
- Rama `feat/integracion`; un commit por tarea; sin push.
- Migraciones desde 0071 (0070 reservada para soporte), ADRs desde 0017.
- El servidor calcula siempre el precio final; nunca se confía en el cliente.
- `paid` de un cobro con proveedor solo con `verified_by = webhook | reconciliation`; los canjes
  100 % / días gratis usan `verified_by = coupon` (ADR 0017).
- Sin capacidad de retiro/payout de NOWPayments.

## Checklist
- [x] T1 Cupones: tablas `coupons` (plataforma) + `coupon_redemptions` (tenant, RLS), cálculo puro del descuento (TDD), invariante de liquidación, cotización y checkout con cupón, canje 100 % / días gratis, CRUD backoffice, input en Facturación. Ruta: inline (contexto ya cargado).
- [x] T2 Referidos: código por tenant, `?ref=` en signup, recompensa 20 % (acumulable hasta 100 %) al primer cobro pagado del referido con señales antiabuso T7, resumen en Plan y uso. Ruta: inline.
- [x] T3 Saldo NOWPayments: cliente de solo lectura (API key + JWT de /v1/auth en memoria), caché 60 s, ingresos propios, pista de conciliación, tarjeta Finanzas. Ruta: inline.

## Criterios de aceptación
- `decideSettlement` rechaza (mismatch) un cobro cuyo precio guardado no sea `precio lista - descuento`.
- `max_redemptions` no se supera con cobros concurrentes (lock + reservas de cobros pendientes).
- Recompensa de referido idempotente por tenant referido; nunca con mismo email/IP o prueba denegada.

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --continue` (DB tests requieren DATABASE_URL).

## Progreso / evidencia
- T1 8e48de9: migración 0071 (`coupons` plataforma, `coupon_redemptions` tenant con RLS, columnas de descuento en `subscription_charges`, `verified_by = coupon`, funciones de cotización/creación/canje/hooks, CRUD `platform_coupon_*`); `@crmwsp/billing/coupons` (RED observado: 14 fallos antes de implementar, luego 76/76); invariante en `decideSettlement`; `POST /billing/subscription/quote`, `couponCode` en checkout; backoffice Cupones; input de cupón en Suscripción. ADR 0017.
- T2 f0ce1b2: migración 0072 (códigos, referidos, recompensas; decisión en el hook de pago con antiabuso email/IP/prueba denegada; revocación al reembolso); `GET /billing/referrals`; `referralCode` en signup (`?ref=`); tarjeta discreta en Plan y uso; créditos aplicados al próximo pago mensual.
- T3 0212bbf: migración 0073 (`platform_finance_summary`); cliente de saldo (API key + JWT de `/v1/auth` en memoria, caché 60 s, refresh mínimo 10 s) con 6 tests; `GET /platform/finance`; página Finanzas. ADR 0018.
- Checks: typecheck OK, lint OK, tests OK salvo `@crmwsp/knowledge parseCsvCatalog` (preexistente). Tests de DB (coupons, referrals) escritos pero omitidos: sin DATABASE_URL.

## Pendiente
- Ejecutar los tests de DB con Postgres (0071-0073 no se aplicaron contra una base real).
- Variables de entorno: `NOWPAYMENTS_EMAIL`, `NOWPAYMENTS_PASSWORD` (nuevas; `.env.example` no editable en esta sesión).
- Verificar el cuerpo de `POST /v1/auth` contra la cuenta real de NOWPayments.
- Espejo Engram `odd/cupones-referidos-saldo/tasks`: pendiente para el padre.
