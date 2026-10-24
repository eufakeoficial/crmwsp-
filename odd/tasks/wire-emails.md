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
- [x] T1 Kit en `packages/mailer/src/templates`; preview funcionando; precios reales en ejemplos; logo https absoluto. Ruta: inline (worker delegado).
- [x] T2 Reemplazar `renderEmail` genérico: invitación, recordatorio día 5, cuenta aprobada/rechazada/suspendida, notificación genérica. Ruta: inline.
- [x] T3 Remitentes nuevos: pagos (confirmado, por vencer, solo lectura), prueba (iniciada, por terminar, terminada), referido, bienvenida, recuperación de contraseña. Ruta: inline.
- Omitido: correo de respuesta a ticket (la rama de soporte no está integrada).

## Criterios de aceptación
`pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --continue` (fallo previo conocido: `@crmwsp/knowledge` parseCsvCatalog), preview con código 0.

## Progreso / evidencia
- T1 `12396a0` refactor(mailer): kit en `packages/mailer/src/templates`, `emailContextFromEnv`/`templateMessage`, plantilla `bienvenida`, ejemplos con Pro 89 USD, logo `https://www.vendemas.chat/brand/logo-on-dark.png` (existe en `apps/web/public/brand`).
- T2 `a3f53de` feat(mailer): invitación, recordatorio día 5, cuenta aprobada/rechazada/suspendida y notificación genérica con plantillas de marca; `renderEmail` genérico eliminado.
- T3a `2b9b81a` feat(billing): migración 0074 (`email_dispatches`, `password_reset_tokens` y funciones), `dueLifecycleEmails` (dominio puro), `apps/worker/src/lifecycle-emails` en el tick de suscripciones.
- T3b `2623c85` feat(auth): `POST /auth/password/forgot|reset`, bienvenida al registrarse, páginas `/forgot-password` y `/reset/[token]`, enlace en login, ADR 0019.
- Verificación: `pnpm typecheck` ok (16/16), `pnpm lint` ok (16/16), `pnpm turbo run test --continue` solo falla el conocido `@crmwsp/knowledge` parseCsvCatalog; tests de BD omitidos sin DATABASE_URL. Preview: código 0, 17 plantillas.

## Decisiones
- Sin mecanismo de baja: `recordatorio-conecta-whatsapp`, `prueba-por-terminar` y `referido-recompensa` pasan a `service`.
- Correos del worker: claim antes de enviar (como mucho una vez); ventanas acotadas para no enviar históricos.
- `prueba-terminada` se envía al terminar la gracia (el texto dice solo lectura); el vencimiento del setup sin canal no envía `cuenta-solo-lectura` (el texto habla de pago).

## Pendiente
- Correo de respuesta a ticket: omitido hasta integrar la rama de soporte.
- Preferencias de avisos / baja; fechas en zona horaria del tenant.
