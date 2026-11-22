# ADR 0026 — Envío de imágenes desde el Inbox

- Estado: propuesta
- Fecha: 2026-11-21
- Relacionada: ADR 0013 (suscripción restringida), ADR 0025 (fotos del cliente), plan en `odd/tasks/envio-de-imagenes-en-el-chat.md`

## Contexto

El Inbox solo envía texto y plantillas (`sendMessageRequestSchema` = `{ text, clientMessageId }`).
El adaptador de WhatsApp ya expone `sendMedia(conn, to, { type, url, caption?, filename? })` en
Gupshup y 360dialog, y `messages` ya tiene `storage_key`, `mime_type` y `external_media_id`.
Falta la API, la subida del archivo y la interfaz.

## Decisión

1. **Entrega de la imagen al proveedor: URL firmada y temporal.** El archivo se guarda en nuestro
   almacenamiento de objetos bajo `tenants/<tenantId>/outbound/<uuid>.<ext>` y el worker genera, justo
   al enviar, una URL con `ObjectStorage.signedGetUrl(key, expiresInSeconds)` de vida corta (minutos).
   Ese enlace es lo que recibe `provider.sendMedia`. No hay URL pública permanente. Se descartó subir
   primero el medio a la API del proveedor: más pasos, otra superficie y otro modo de fallo.
2. **Dos pasos:** subida (`POST /conversations/:id/media`, multipart) que devuelve un `uploadId`, y
   envío (`POST /conversations/:id/media-messages`) con `uploadId`, leyenda opcional y `clientMessageId`.
   Separarlos permite vista previa y cancelar sin enviar nada al cliente.
3. **Validación en el servidor, no en el navegador:** tipo real por firma del archivo (JPEG o PNG),
   tamaño máximo 5 MB, nombre saneado, nunca se interpreta el contenido. El límite de 5 MB y los
   formatos son los de WhatsApp para imágenes; se confirman contra la documentación del proveedor
   en la etapa 1 antes de fijarlos.
4. **Mismas reglas que el texto:** roles `owner|admin|agent` (el lector no envía), conversación visible
   para quien envía, suscripción activa, ventana de 24 h (fuera de ella solo plantilla), idempotencia por
   `clientMessageId` y acceso a datos siempre por `withTenant`.
5. **Envío por el worker**, igual que el texto: la API crea el `message` outbound en estado pendiente y
   encola; un fallo del proveedor deja el mensaje en `failed`, visible y reintentable.
6. **Sin costo nuevo por ahora:** el envío de imágenes dentro de la ventana de 24 h no se mide contra
   ningún tope del plan. Se reevalúa si el almacenamiento crece.
7. **Limpieza:** los archivos subidos que nunca se enviaron se borran con una tarea programada del worker.

## Consecuencias

- Reutiliza `sendMedia` y `signedGetUrl`; no se agregan dependencias.
- La URL firmada sale del sistema por un instante: debe vencer rápido y no registrarse en logs.
- Requiere almacenamiento de objetos configurado en el entorno; si falta, el botón de adjuntar se oculta
  y la API responde un error claro, sin romper el envío de texto.
- Tablas o columnas nuevas, si las hubiera, llevan `tenant_id`, RLS forzada y tests de aislamiento.

## Pendiente de confirmar en la etapa 1

- Límites exactos de imagen de WhatsApp y de cada proveedor (Gupshup y 360dialog).
- Vida útil de la URL firmada: lo bastante larga para que el proveedor descargue, lo más corta posible.
