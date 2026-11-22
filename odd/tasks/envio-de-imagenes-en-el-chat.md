# envio-de-imagenes-en-el-chat — Enviar fotos (y luego otros archivos) desde el Inbox

Estado: PLAN, sin código escrito. Rama sugerida: `feat/envio-imagenes-chat` (desde `main`).
Decisión a registrar: `docs/adr/0026-envio-de-imagenes-desde-el-inbox.md` (se escribe en la etapa 0).

## Objetivo
Que un agente, administrador o propietario pueda adjuntar una foto en el chat del Inbox y enviarla al
cliente por WhatsApp, con una leyenda opcional. Hoy solo se envía texto y plantillas.

## Punto de partida (verificado en el código)
- `Composer.tsx` no ofrece adjuntos: el comentario dice que la API de envío solo acepta texto y plantillas.
- `POST /conversations/:id/messages` (`conversations.controller.ts`) valida `sendMessageRequestSchema`
  = `{ text, clientMessageId }` (`packages/contracts/src/inbox.ts`).
- El adaptador YA tiene `sendMedia(conn, to, { type, url, caption?, filename? })` en `WhatsAppProvider`
  (`packages/whatsapp/src/provider.ts`), implementado en Gupshup y 360dialog. `type` admite image, audio,
  video y document. Solo falta usarlo desde la API.
- `messages` ya tiene `storage_key`, `mime_type` y `external_media_id` (`packages/db/src/schema/messages.ts`),
  hoy usados por las fotos que RECIBE el cliente.
- Hay almacenamiento de objetos: `apps/api/src/storage/object-storage.ts` (lo usa `commerce/media.controller.ts`
  para fotos de productos) y `apps/worker/src/media/*` para descargar medios entrantes.
- Regla de ventana de 24 h: fuera de ella solo se puede enviar plantilla (`/template-messages`).
  Un mensaje con imagen libre debe respetar la misma regla.

## Decisiones fijas (no reabrir sin ADR nuevo)
- Todo envío sigue pasando por `WhatsAppProvider`; nada de llamar a Meta directo.
- Idempotente: `clientMessageId` como en el envío de texto. Un reintento no manda dos veces.
- Respetar `assertSubscriptionActive`, `assertConversationVisible` y los roles `owner|admin|agent`
  (el lector NO envía). Todo acceso a datos por `withTenant`.
- Los archivos subidos viven bajo un prefijo por tenant; nunca una URL pública permanente sin firma.

## Riesgos y preguntas abiertas (resolver en la etapa 0)
1. Gupshup y 360dialog descargan la imagen desde una URL: hace falta una URL accesible desde afuera
   (firmada y con vencimiento corto) o subir primero el medio al proveedor. Elegir una.
2. Límites de WhatsApp para imagen: JPEG/PNG, hasta 5 MB. Validar tipo real (magic bytes), no solo extensión.
3. Seguridad: el archivo viene del usuario. Validar tipo y tamaño en el servidor, nombre de archivo
   saneado, sin ejecutar ni interpretar contenido. Rate limit por tenant.
4. Costo/limites del plan: ¿cuenta contra algún tope? Decidir si se mide.
5. `FORCE ROW LEVEL SECURITY` y tests de aislamiento entre tenants para cualquier tabla o columna nueva.

## Etapas (cada una se entrega y se prueba sola)

### Etapa 0 — Diseño (sin código de producto)
- [ ] E0.1 Resolver las preguntas 1, 2 y 4 y escribir el ADR 0026.
- [ ] E0.2 Definir el contrato: `sendMediaMessageRequestSchema` (tipo, caption opcional hasta 1024,
      `clientMessageId`) y el nombre de la ruta.
Salida: ADR aprobado. Sin cambios en producción.

### Etapa 1 — Subida segura del archivo (backend)
- [ ] E1.1 Endpoint de subida: `POST /conversations/:id/media` (multipart) que valida rol, visibilidad,
      tipo real y tamaño, y guarda en `object-storage` bajo `tenants/<tenantId>/outbound/…`.
- [ ] E1.2 Devuelve un `uploadId` y una URL firmada de vida corta.
- [ ] E1.3 Tests: rechaza tipo falso, archivo grande, otro tenant, rol lector, conversación no visible.
Salida: se puede subir y obtener una URL válida. Todavía no se envía nada al cliente.

### Etapa 2 — Envío de la imagen (backend)
- [ ] E2.1 `POST /conversations/:id/media-messages`: toma `uploadId` + caption + `clientMessageId`,
      aplica ventana de 24 h, suscripción activa y visibilidad, crea el `message` (direction outbound,
      `storage_key`, `mime_type`) y encola el envío por el worker con `provider.sendMedia`.
- [ ] E2.2 Idempotencia por `clientMessageId` y manejo de fallo del proveedor (estado `failed` visible).
- [ ] E2.3 Tests con el proveedor simulado: envío, reintento sin duplicar, fuera de ventana, error del proveedor.
Salida: por API se manda una imagen real a un número de prueba.

### Etapa 3 — Interfaz en el Inbox (web, celular y escritorio)
- [ ] E3.1 Botón de adjuntar en `Composer.tsx` (abre cámara/galería en celular).
- [ ] E3.2 Vista previa, leyenda opcional, progreso y botón de cancelar antes de enviar.
- [ ] E3.3 Mostrar la imagen enviada en `MessageBubble` con estado (enviando, enviado, fallo y reintentar).
- [ ] E3.4 Mensajes de error claros: tipo no permitido, pesa más de 5 MB, fuera de la ventana de 24 h.
Salida: un agente envía una foto desde el celular y la ve en la conversación.

### Etapa 4 — Pulido y operación
- [ ] E4.1 Auditoría del envío (quién envió qué y cuándo) en `audit_events`.
- [ ] E4.2 Limpieza de archivos subidos que nunca se enviaron (tarea programada en el worker).
- [ ] E4.3 Prueba real de punta a punta con un número verdadero y documentación en `docs/runbooks/`.

### Etapa 5 — Extensiones (opcionales, cada una con su decisión)
- [ ] E5.1 Enviar fotos del catálogo de productos en un toque.
- [ ] E5.2 Documentos (PDF) y luego audio y video, reutilizando `sendMedia`.
- [ ] E5.3 Que la IA pueda proponer una foto del catálogo (siempre con aprobación humana).

## Criterios de aceptación
- Un agente envía una foto con leyenda y el cliente la recibe en WhatsApp.
- Un reintento o doble toque no envía dos veces.
- Fuera de la ventana de 24 h se bloquea con un mensaje claro.
- Un lector no puede enviar; un archivo no permitido se rechaza en el servidor.
- `pnpm lint && pnpm typecheck && pnpm test` en verde, incluidos los tests de aislamiento de tenant.

## Orden de trabajo (regla del proyecto)
Migración (si hace falta) y contratos → dominio con tests → worker y adaptadores → endpoints con guard de
tenant → interfaz → ADR. Conventional Commits en español, una etapa por PR.

## Fuera de alcance
Edición de imágenes, galería de archivos, envío masivo con imagen y stickers.
