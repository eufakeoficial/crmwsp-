# emailing — plantillas de correo de Vende+ WSP

Plantillas transaccionales (HTML basado en tablas + alternativa en texto plano) para Vende+ WSP.

## Origen
Portadas del kit de correos del proyecto de directorio del mismo autor (`D:\DIRECTORIO BOLIVIA`, `packages/integrations/src/email`: `blocks.ts`, `templates.ts`, `render.ts`). Se conservó la estructura (bloques reutilizables -> registro de plantillas -> `renderEmail`/`sampleEmail`) y se rehizo la marca:

- Colores reales de `apps/web/src/app/globals.css`: navy `#050a3a`, royal `#0a1696`, azure `#1233d8`, lime `#d2f34c` (solo acentos: franja bajo la cabecera, pills, botón sobre fondo oscuro; texto navy sobre lime, contraste AA).
- Logo: `assets/logo-on-dark.png` (copiado de `apps/web/public/brand/`). En producción se carga desde `https://www.vendemas.chat/brand/` (`assetsUrl`).
- Tipografía: Plus Jakarta Sans por web font, con Arial/Helvetica de respaldo.
- Remitente: `no-responder@vendemas.chat`. Texto en español neutro.
- Buenas prácticas: ancho máx. 600, tablas, botones a prueba de Outlook, preheader, alternativa en texto, `alt` en el logo, modo oscuro (`prefers-color-scheme`), pie con baja en los correos opcionales (`List-Unsubscribe` RFC 8058 en `headers`).
- No se portó el driver Resend (`port.ts`): este proyecto envía por `packages/mailer` (SMTP/nodemailer).

## Estructura
- El código vive en `packages/mailer/src/templates/` (importable desde api y worker como `@crmwsp/mailer`): `blocks.ts` bloques y layout; `templates.ts` plantillas y datos de ejemplo; `render.ts` render (`renderTemplate`, `sampleEmail`).
- `@crmwsp/mailer` agrega `emailContextFromEnv()` (enlaces a `PUBLIC_WEB_URL`, logo siempre en https absoluto: `EMAIL_ASSETS_URL` o `https://www.vendemas.chat/brand`) y `templateMessage()`.
- Aquí quedan `scripts/preview.ts` (genera `preview/*.html`, `preview/*.txt` e `index.html`, ignorados por git) y `assets/` para la vista local.

## Previsualizar
Desde la raíz del repo (no agrega dependencias al monorepo):

```
npx --yes tsx emailing/scripts/preview.ts
```
Abre `emailing/preview/index.html`. Las vistas usan el logo local `../assets`.

## Plantillas y dónde se envían
Todas se envían como correos de servicio (no hay mecanismo de baja de avisos; ver ADR 0019).

| Plantilla | Ruta de código | Cuándo |
|---|---|---|
| `bienvenida` | `apps/api/src/auth/auth.service.ts` (`signup`) | Al registrarse, en segundo plano |
| `recuperar-contrasena` | `auth.service.ts` (`forgotPassword`) | `POST /auth/password/forgot` (enlace `/reset/<token>`, 30 min) |
| `invitacion-equipo` | `apps/api/src/team/invitation-token.ts`, enviada en `team.service.ts` | Al invitar |
| `recordatorio-conecta-whatsapp` | `apps/worker/src/index.ts` (`sendSetupReminder`) | Día 5 del setup sin canal |
| `cuenta-aprobada`, `cuenta-rechazada`, `cuenta-suspendida` | `apps/api/src/platform/platform.service.ts` (`notifyOwner`) | Cambio de estado por plataforma |
| `notificacion-generica` | `apps/worker/src/index.ts` (`sendOwnerEmail`) | Avisos al dueño |
| `pago-confirmado` | `apps/worker/src/lifecycle-emails` (`runPaidChargeEmails`) | Cobro liquidado como pagado (incluye anual y cupón sin costo) |
| `pago-por-vencer` | `lifecycle-emails` (`runTenantLifecycleEmails`) | 3 días antes del último día pagado, una vez por período |
| `cuenta-solo-lectura` | `lifecycle-emails` | Primer día tras la gracia de un plan pagado, una vez |
| `prueba-iniciada`, `prueba-por-terminar`, `prueba-terminada` | `lifecycle-emails` | Inicio, 2 días antes del fin, fin de la gracia |
| `referido-recompensa` | `lifecycle-emails` (`runReferralRewardEmails`) | Al otorgarse el crédito al referente |
| `bienvenida-verificacion` | Ninguna | Sin verificación de correo |
| `ticket-respuesta` | Ninguna | Pendiente de la rama de soporte |

Los correos del worker reclaman su clave en `email_dispatches` antes de enviar (como mucho una vez) y corren en el tick de suscripciones, después del commit del pago.

## Pendientes
- Preferencias de avisos y baja (`optional` + `List-Unsubscribe` quedan listos en el renderer, sin uso).
- Fechas en UTC en los correos del worker (sin zona horaria del tenant).
