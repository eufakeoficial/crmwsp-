# Feature: bandeja-correo-admin

Objetivo: bandeja de correo tipo Gmail en el backoffice de plataforma para contacto@vendemas.chat,
montada sobre los tickets de soporte (ADR 0016). Resend recibe el correo (MX vendemas.chat) y envía
un webhook `email.received`.

Rama: feat/soporte-tickets. Migración: 0076_support_email_inbox (renumerada al integrar en feat/integracion; tickets = 0075). ADR: 0020.

## Plan de renumeración
- En esta rama el journal salta de idx 68 (0068) a idx 69 con tag 0075_support_email_inbox.
- Al integrar con feat/integracion: 0068_support_tickets debe pasar a ser posterior a 0074 (p. ej.
  0075_support_tickets) y esta migración a 0076; reordenar el journal (idx y `when` crecientes) y
  revisar que ningún entorno haya aplicado ya 0068 con el nombre viejo (drizzle compara por hash).

## Alcance / restricciones
- Webhook POST /webhooks/resend: firma Svix verificada a mano (node:crypto, HMAC-SHA256, tolerancia
  5 min, comparación en tiempo constante). Sin dependencia nueva.
- inbound_events con dedupe_key `resend:{email_id}` (provider `resend`, tenant NULL) → worker.
- El worker trae el cuerpo con GET /emails/receiving/{id} (RESEND_API_KEY, solo lectura).
- Ticket channel='email'; tenant_id NULL solo para tickets externos; RLS sigue ocultándolos al tenant.
- HTML saneado en servidor + render en iframe sandbox con CSP en la UI.
- Adjuntos: metadatos guardados; descarga solo vía endpoint de plataforma autenticado (proxy).
- Nunca auto-respuesta; ignorar Auto-Submitted / Precedence / bounces; límite por remitente.

## Tareas
- [x] T1 dominio + contratos — ruta: inline — commits 10d7cea, 5ef4dc6 (lint)
- [x] T2 migración 0075 + schema drizzle + tests de aislamiento — ruta: inline — commit ce11c9e
- [x] T3 API: webhook Resend, endpoints de correo, mailer con cabeceras — ruta: inline — commit 8e53db5
- [x] T4 worker: evento Resend → ticket — ruta: inline — commit 2927689
- [x] T5 Web: pestaña Correo, contador en AdminShell — ruta: inline — commit 9f9de19
- [x] T6 ADR 0020 + cierre de este documento — ruta: inline

Ruta: este worker es el escritor delegado; tareas inline.

## Evidencia
- Tests de dominio escritos junto con la implementación (sin RED previo observado): 15 tests.
- API: firma Svix (válida, alterada, vieja, sin cabeceras, secreto ausente), dedupe/encolado, 503;
  servicio de correo (cabeceras de hilo, no registra si falla el envío, límite, dominio propio).
- Worker: mapeo de correo recibido (saneado, refs, token, auto-respuesta).
- DB (support-email-isolation, 6 tests): se saltan sin DATABASE_URL.
- pnpm typecheck 16/16; pnpm lint 16/16; turbo test: todo verde salvo el fallo conocido
  @crmwsp/knowledge parseCsvCatalog.

## Siguiente paso
- Ejecutar tests de DB contra Postgres; registrar el webhook en Resend; configurar env.
- Opcional: notificar a los admins por el mecanismo de notificaciones al llegar correo nuevo.
