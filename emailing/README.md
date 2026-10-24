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

## Plantillas y dónde se envían hoy
Hoy el código solo usa `renderEmail({title, body, ctaLabel, ctaUrl})` de `packages/mailer` (plantilla genérica). Estas plantillas aún no reemplazan esa función; el nombre indica qué enviaría cada ruta.

| Plantilla | Ruta de código actual | Estado |
|---|---|---|
| `invitacion-equipo` | `apps/api/src/team/invitation-token.ts` (`invitationEmail`), enviada en `team.service.ts` | Mismo asunto y variables (`tenantName`, `role`, `inviterName`, `link`); falta conectar |
| `recordatorio-conecta-whatsapp` | `apps/worker/src/index.ts` (`sendSetupReminder`) | Mismo asunto; falta conectar |
| `cuenta-aprobada`, `cuenta-rechazada`, `cuenta-suspendida` | `apps/api/src/platform/platform.service.ts` (`notifyOwner`) | Mismos asuntos; falta conectar |
| `notificacion-generica` | `apps/worker/src/index.ts` (`sendOwnerEmail`) | Falta conectar |
| `bienvenida-verificacion` | Ninguna | No cableada (no hay verificación de correo) |
| `recuperar-contrasena` | Ninguna | No cableada |
| `prueba-iniciada`, `prueba-por-terminar`, `prueba-terminada` | Ninguna | No cableadas |
| `pago-confirmado`, `pago-por-vencer`, `cuenta-solo-lectura` | Ninguna (la liquidación está en `apps/worker/src/subscription-billing`) | No cableadas |
| `referido-recompensa` | Ninguna (programa en billing) | No cableada |
| `ticket-respuesta` | Ninguna | No cableada |

## Pendientes a confirmar
- Rutas de los enlaces de ejemplo (`/app/settings`, `/verify/…`, `/reset/…`, `/unsubscribe`): son provisionales salvo `/app`, `/app/channels` e `/invite/<token>`.
- Montos, planes y formatos de fecha llegan ya formateados desde quien llama.
- `optional` (recordatorio, prueba por terminar, referido) exige enlaces de preferencias y baja en el contexto.
