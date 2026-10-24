# Correos de marca Vende+ cableados (wire-emails)

## Objetivo
Que las plantillas de `emailing/` sean los correos reales que envía la app (SMTP vía `packages/mailer` → Resend).

## Problema / por qué
Hoy solo existe `renderEmail({title, body})` genérico; las plantillas de marca no se usan y faltan correos de pagos, prueba, referidos, bienvenida y recuperación de contraseña.

## Alcance y restricciones
- Kit movido a `packages/mailer/src/templates` (sin dependencias nuevas). `emailing/scripts/preview.ts` sigue funcionando.
- Envíos idempotentes que nunca bloquean la transacción principal (después del commit; tick del worker con `email_dispatches`).
- No inventar verificación de correo ni endpoint `/unsubscribe`.
- Migraciones 0074+ (otra rama agrega 0070 de soporte).

## Tareas
- [ ] T1 Kit en `packages/mailer/src/templates`; preview funcionando; precios reales en ejemplos; logo https absoluto. Ruta: inline (worker delegado).
- [ ] T2 Reemplazar `renderEmail` genérico: invitación, recordatorio día 5, cuenta aprobada/rechazada/suspendida, notificación genérica. Ruta: inline.
- [ ] T3 Remitentes nuevos: pagos (confirmado, por vencer, solo lectura), prueba (iniciada, por terminar, terminada), referido, bienvenida, recuperación de contraseña. Ruta: inline.
- Omitido: correo de respuesta a ticket (la rama de soporte no está integrada).

## Criterios de aceptación
`pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --continue` (fallo previo conocido: `@crmwsp/knowledge` parseCsvCatalog), preview con código 0.

## Progreso / evidencia
(se completa por tarea)
