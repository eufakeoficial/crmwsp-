# ADR 0015 — Cobro anual de la suscripción y aplicación de límites del plan

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0011, ADR 0013, ADR 0014

## Contexto
Una auditoría del cobro SaaS (ADR 0013) encontró que:
- Los límites `contacts` y `whatsapp_numbers` se contaban pero no se aplicaban en ningún punto de
  creación (alta de canales Gupshup/360dialog, reactivación, importación CSV).
- Al aceptar una invitación no se revalidaban los asientos.
- El precio anual estaba definido (490 / 890 USD) pero todo cobro facturaba el precio mensual por 30 días.
- La FAQ prometía "cancelar cuando quieras" cuando no existe cobro recurrente que cancelar.

## Decisión

### Límite de números de WhatsApp
- Cada canal no deshabilitado ocupa una unidad de `whatsapp_numbers`.
- Se valida en `POST /channels/gupshup`, en `POST /channels/360dialog/connect` y al reactivar un
  canal deshabilitado (`PATCH /channels/:id`). Error: 402 `PLAN_LIMIT_EXCEEDED`.
- 360dialog: se comprueba **antes** de llamar a la Partner API (no se crea una API key que no se
  pueda guardar) y otra vez dentro de la transacción de inserción.
- Las comprobaciones dentro de transacción toman un advisory lock por tenant y límite
  (`plan-limit:{key}:{tenant}`) para que dos peticiones simultáneas no superen el tope.

### Límite de contactos
- **Importación CSV**: se cuentan los teléfonos nuevos (los que ya existen solo se actualizan). Si
  superan lo que el plan permite, se rechaza la importación entera (402, `details.requested` y
  `details.remaining`); no se importa nada parcialmente. No existe endpoint de alta manual de contactos.
- **Mensajes entrantes de clientes nuevos**: **nunca** se bloquean ni se descartan. Perder la
  conversación de un cliente es peor que exceder el plan. El contacto se crea igual y el exceso se
  muestra: `summarizeUsage` devuelve `exceeded: true` y "Plan y uso" muestra un aviso en rojo. La
  única consecuencia es que no se pueden importar más contactos hasta mejorar el plan.

### Asientos al aceptar invitación
- La invitación pendiente ya contaba como asiento al enviarse. Al aceptarla (usuario existente o
  alta nueva) se consume la invitación y, en la misma transacción, se comprueba que el tenant no
  quede por encima de su límite (reserva 0 unidades adicionales). Si el plan se redujo o la
  suscripción está restringida, se revierte todo con 402.

### Cobro anual
- `POST /billing/subscription/charges` acepta `period: "monthly" | "annual"` (por defecto `monthly`).
  Mensual cobra `priceMonthlyUsd` y concede 30 días; anual cobra `priceAnnualUsd` y concede 365 días.
  Los precios no cambian.
- Migración 0067: `subscription_charges.period_days` (30 o 365, por defecto 30 para las filas
  existentes). `subscription_charge_create` recibe el período y lo valida; `subscription_charge_apply`
  concede `period_days` y el re-apilado tras un reembolso usa la duración de cada cargo.
- Integridad de la liquidación: `decideSettlement` exige además que el precio guardado sea
  exactamente el del plan para su período (49/89 mensual, 490/890 anual). Un cargo con 365 días y
  precio mensual nunca se liquida.
- Solo cambia la columna `period_days` de una tabla ya protegida por RLS (0063); la app no puede
  escribirla directamente (test de aislamiento).

### Texto público
- La FAQ dice la verdad: sin permanencia ni cobros automáticos; cada pago cubre 30 días (o 365); si
  no se renueva, 3 días de gracia y luego solo lectura; los datos nunca se borran.

## Consecuencias
- Un tenant puede quedar por encima del límite de contactos por mensajes entrantes; es deliberado.
- Si en el futuro cambian los precios, los cargos pendientes creados con el precio anterior dejarán
  de liquidarse (`mismatch`) y habrá que conciliarlos a mano o versionar los precios.
