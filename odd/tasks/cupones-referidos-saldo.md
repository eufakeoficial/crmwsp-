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
- [ ] T1 Cupones: tablas `coupons` (plataforma) + `coupon_redemptions` (tenant, RLS), cálculo puro del descuento (TDD), invariante de liquidación, cotización y checkout con cupón, canje 100 % / días gratis, CRUD backoffice, input en Facturación. Ruta: inline (contexto ya cargado).
- [ ] T2 Referidos: código por tenant, `?ref=` en signup, recompensa 20 % (acumulable hasta 100 %) al primer cobro pagado del referido con señales antiabuso T7, resumen en Plan y uso. Ruta: inline.
- [ ] T3 Saldo NOWPayments: cliente de solo lectura (API key + JWT de /v1/auth en memoria), caché 60 s, ingresos propios, pista de conciliación, tarjeta Finanzas. Ruta: inline.

## Criterios de aceptación
- `decideSettlement` rechaza (mismatch) un cobro cuyo precio guardado no sea `precio lista - descuento`.
- `max_redemptions` no se supera con cobros concurrentes (lock + reservas de cobros pendientes).
- Recompensa de referido idempotente por tenant referido; nunca con mismo email/IP o prueba denegada.

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --continue` (DB tests requieren DATABASE_URL).

## Progreso / evidencia
(se completa por tarea)
