# ADR 0020 — Bandeja de correo de plataforma (contacto@vendemas.chat) sobre tickets

Estado: aceptado · Fecha: 2026-10-24 · Relacionado: ADR 0011 (platform admin), ADR 0016 (tickets),
ADR 0012 (webhooks)

## Contexto
Los clientes y prospectos escriben a contacto@vendemas.chat. El MX de vendemas.chat apunta a Resend
con recepción activada. Queremos atender esos correos desde el backoffice, con experiencia tipo Gmail,
sin abrir otro sistema y reutilizando los tickets de soporte, su auditoría y su tiempo real.

Hechos verificados en la documentación oficial:
- Recepción: Resend procesa el correo y hace POST a nuestro endpoint con el evento `email.received`
  (https://resend.com/docs/dashboard/receiving/introduction,
  https://resend.com/docs/dashboard/receiving/create-receiving-webhook).
- El webhook trae solo metadatos (`data.email_id`, `from`, `to`, `cc`, `bcc`, `subject`,
  `message_id`, metadatos de adjuntos). El cuerpo, las cabeceras y los adjuntos se piden aparte.
- Cuerpo: `GET https://api.resend.com/emails/receiving/{id}` devuelve `html`, `text`, `headers`,
  `message_id`, `attachments` (https://resend.com/docs/api-reference/emails/retrieve-received-email).
- Adjuntos: `GET https://api.resend.com/emails/receiving/{email_id}/attachments/{id}` devuelve un
  `download_url` válido ~1 hora (https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment,
  https://resend.com/docs/dashboard/receiving/attachments).
- Firma: cabeceras `svix-id`, `svix-timestamp`, `svix-signature`, sobre el cuerpo crudo
  (https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests). Especificación Svix
  (https://docs.svix.com/receiving/verifying-payloads/how-manual): contenido firmado
  `${id}.${timestamp}.${body}`, HMAC-SHA256 con la parte base64 del secreto tras `whsec_`, firmas
  `v1,<base64>` separadas por espacio, comparación en tiempo constante, tolerancia de timestamp a
  elección del receptor.

## Decisión
1. **Webhook** `POST /webhooks/resend` (público, sin token en la URL). Única autenticación: firma Svix
   verificada a mano con `node:crypto` (sin dependencia nueva), tolerancia 5 minutos, comparación
   `timingSafeEqual`. Sin `RESEND_WEBHOOK_SECRET`, firma inválida, alterada o vieja → 401 y nada se
   guarda. Otros tipos de evento → 200 sin guardar.
2. **Primero inbound_events**: `ingest_resend_event` (SECURITY DEFINER) inserta con provider `resend`,
   `tenant_id` NULL y `dedupe_key = resend:{email_id}`. Se encola en la cola `support-email` en cada
   entrega verificada con `jobId` estable (idempotente); si Redis falla se responde 503 y Resend
   reintenta.
3. **Worker**: lee el evento (`resend_event_get`), trae el correo completo con `RESEND_API_KEY`
   (solo GET), sanea el HTML, calcula hilo y llama `support_email_ingest`. Hilo, en orden:
   Message-ID en `In-Reply-To`/`References` → token `[Ticket #n]` del mismo remitente → mismo
   remitente + asunto normalizado en 30 días → ticket nuevo. Remitente que coincide con un usuario →
   ticket bajo su empresa activa más reciente (por fecha de membresía); si no, ticket **externo**
   sin empresa. Un usuario sin empresa activa también queda como externo.
4. **Esquema (0075)**: `support_tickets.channel ('app'|'email')`; `tenant_id` pasa a nullable con
   CHECK `tenant_id IS NOT NULL OR channel = 'email'`. Las políticas `tenant_isolation` comparan con
   `app.tenant_id`, así que las filas con NULL nunca son visibles para el rol de la app. El rol de la
   app tampoco puede insertarlas (WITH CHECK). Mensajes con `from_email`, `to_emails`,
   `email_message_id`, `resend_email_id` (único), `html` saneado, `attachments` (metadatos) y
   `auto_reason`. La bandeja de tickets 0068 y su contador filtran `channel = 'app'`.
5. **Backoffice** `/app/admin/email` ("Correo"): carpetas Bandeja de entrada, Asignados a mí,
   Resueltos, Enviados; lista con no leídos en negrita; hilo; respuesta con respuestas rápidas;
   correo nuevo a cualquier dirección. Todo vía funciones `platform_email_*` que re-chequean
   `platform_admins`. Tiempo real por el canal existente `platform:support:events`. Contador propio
   en AdminShell.
6. **Envío**: desde `Vende+ WSP <contacto@vendemas.chat>` con el mailer existente (se añadió
   `from`, `messageId`, `inReplyTo`, `references` y rechazo de inyección de cabeceras). Asunto
   `Re: … [Ticket #n]`. Se registra (y audita `support.email_send`) solo después de que el mailer
   aceptó el envío. Límite 60 correos/hora por admin. Nunca hay respuestas automáticas.
7. **HTML**: saneado conservador en servidor (sin scripts, handlers, iframes, formularios, `base`,
   `meta`, `url()` en estilos ni imágenes remotas; solo `cid:`/`data:image`) **y** render en
   `<iframe sandbox="">` con CSP `default-src 'none'` dentro del `srcdoc`. El saneado es defensa en
   profundidad; el control principal es el sandbox.
8. **Adjuntos**: se guardan solo metadatos. La descarga pasa por
   `GET /platform/support/email/threads/:id/attachments/:attachmentId` (admin): se valida que el
   adjunto pertenece al hilo, la URL sale de la API de Resend (nunca del cliente), se sirve como
   `application/octet-stream` + `attachment` + `nosniff`, tope 25 MB. Sin redirecciones abiertas.
9. **Abuso**: auto-respuestas, rebotes y correo masivo (`Auto-Submitted`, `Precedence`,
   `X-Autoreply`, MAILER-DAEMON/no-reply, `List-Id`) se guardan pero no reabren tickets; correo desde
   contacto@vendemas.chat se descarta (bucles); más de 20 correos/hora de un remitente se descartan;
   payload del webhook ≤ 256 KB, texto ≤ 200 000 caracteres, HTML ≤ 500 000.

## Configuración
- `RESEND_WEBHOOK_SECRET` (API): secreto `whsec_…` del webhook en Resend.
- `RESEND_API_KEY` (worker y API): clave de Resend; solo se usan GET de Receiving. Basta una clave
  con permiso de lectura/Full access según lo que Resend ofrezca para Receiving.
- Envío: el mailer SMTP existente (`SMTP_*`); el dominio vendemas.chat debe estar verificado para
  enviar como contacto@.
- URL a registrar en Resend: `https://<api-público>/webhooks/resend`, evento `email.received`.

## Consecuencias
- Si el servidor SMTP reescribe el `Message-ID`, el hilo del lado del cliente sigue funcionando por
  `References`/`In-Reply-To` del correo que recibió; del nuestro, por el token `[Ticket #n]` o por
  remitente + asunto.
- Correos de un usuario quedan visibles para su empresa en la pantalla de soporte del tenant
  (son tickets de esa empresa). Los externos solo los ve la plataforma.
- No se notifica por ahora a los admins fuera del backoffice (pendiente opcional).
- La ruta del webhook no pasa por el limitador de `/webhooks/:token`; la firma es barata de verificar.
