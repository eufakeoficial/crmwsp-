# Feature: bandeja-correo-admin

Objetivo: bandeja de correo tipo Gmail en el backoffice de plataforma para contacto@vendemas.chat,
montada sobre los tickets de soporte (ADR 0016). Resend recibe el correo (MX vendemas.chat) y envía
un webhook `email.received`.

Rama: feat/soporte-tickets. Migración: 0075_support_email_inbox (feat/integracion ya usa 0067–0074;
esta rama solo tiene hasta 0068). ADR: 0020.

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
- [ ] T1 dominio (parseo, hilos, auto-submitted, saneado HTML, asunto) + contratos — ruta: inline
- [ ] T2 migración 0075 + schema drizzle + tests de aislamiento — ruta: inline
- [ ] T3 API: webhook Resend (firma), endpoints de plataforma de correo, mailer con cabeceras — ruta: inline
- [ ] T4 worker: procesar evento Resend → ticket — ruta: inline
- [ ] T5 Web: pestaña Correo (3 paneles), contador en AdminShell — ruta: inline
- [ ] T6 ADR 0020 + cierre de este documento — ruta: inline

Ruta: este worker es el escritor delegado; tareas inline.

## Evidencia
(pendiente)

## Siguiente paso
T1.
