# Runbook — Envío de imágenes desde el Inbox

Decisión y diseño: `docs/adr/0026-envio-de-imagenes-desde-el-inbox.md`. Plan por etapas:
`odd/tasks/envio-de-imagenes-en-el-chat.md`.

## Requisitos de entorno
- Almacenamiento S3 compatible configurado en **api** y en **worker** con las MISMAS variables:
  `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, y según el proveedor `S3_ENDPOINT`, `S3_REGION`,
  `S3_FORCE_PATH_STYLE`.
- Si faltan en la API, la subida responde 503 y el botón de adjuntar no funciona. Si faltan solo en el
  worker, el mensaje queda en estado `failed` con el error "object storage is not configured for image sends".
- El canal debe poder enviar medios (Gupshup o 360dialog con la ventana de 24 h abierta).

## Cómo funciona
1. El agente elige una imagen (JPG o PNG, hasta 5 MB). El navegador la valida y el servidor la vuelve a validar
   (tipo real por firma del archivo).
2. `POST /conversations/:id/media` la guarda en `tenants/<tenantId>/outbound/<conversationId>/<uploadId>.<ext>`
   y devuelve una vista previa firmada de 5 minutos. No se envía nada al cliente.
3. `POST /conversations/:id/media-messages` crea el mensaje (`type = image`, leyenda en `body`, fila en
   `attachments`) y encola el envío. Es idempotente por `clientMessageId`.
4. El worker firma una URL de 5 minutos justo al enviar y llama a `sendMedia` del proveedor.
5. Auditoría en `audit_events`: `message.media_uploaded` y `message.media_sent`.

## Prueba de punta a punta (con un número real)
1. En el Inbox, abrir una conversación con un número tuyo que haya escrito en las últimas 24 h.
2. Tocar el clip, elegir una foto JPG o PNG, escribir una leyenda y enviar.
3. Esperado: la imagen aparece en el hilo, pasa de "en cola" a "enviado" y llega al teléfono.
4. Probar también: una imagen de más de 5 MB (se rechaza), un archivo que no es imagen (se rechaza) y una
   conversación fuera de la ventana de 24 h (no se ofrece el envío de imagen).

## Problemas frecuentes
| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El clip no aparece | Conversación fuera de la ventana de 24 h, o es una nota | Usar plantilla; la imagen libre solo va dentro de la ventana |
| "No se pudo enviar la imagen" | Fallo de red o del proveedor | Reintentar: reutiliza la misma subida y no duplica |
| Mensaje en `failed` con error de storage | Faltan variables `S3_*` en el worker | Cargarlas en el servicio worker y reiniciar |
| 503 al subir | Faltan variables `S3_*` en la API | Cargarlas en el servicio api |
| Imagen enviada pero no se ve en el chat | El endpoint de adjuntos no firma la clave | Revisar `GET /attachments/:id/url` y el bucket |

## Limpieza de archivos (pendiente)
Los archivos subidos que nunca se enviaron y las imágenes ya enviadas **no se borran solos todavía**. Mientras
no exista la limpieza, el almacenamiento crece con el uso. Ver la etapa 4 del plan para la decisión de diseño.

## Límites conocidos
- Solo JPG y PNG (WhatsApp usa WebP solo para stickers).
- No hay envío masivo con imagen, edición ni galería de archivos.
- Probado con proveedor y almacenamiento simulados; la primera prueba real es la de arriba.
