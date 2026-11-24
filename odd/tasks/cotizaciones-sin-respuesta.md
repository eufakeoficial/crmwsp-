# Cotizaciones sin respuesta (Etapa 1A) — bandeja

- Fuente: `VendePlus_Guia_de_implementacion_GLM.md` (raíz del proyecto CRMWSP), Etapa 1A.
- Rama: `feat/cotizaciones-sin-respuesta` (desde `origin/main`). Sin commits: pendiente de que el usuario lo pida.
- Instrucciones del repo: `CLAUDE.md` (orden migración → contracts → domain → endpoints → UI).
- Espejo Engram: pendiente (sin herramienta de memoria en esta sesión).
- Ruta por tarea: mapeo delegado a exploradores de solo lectura; escritura inline.

## Objetivo

Que el vendedor encuentre un presupuesto enviado y olvidado, abra el chat exacto y registre que lo
revisó, sin salir de la bandeja y también en móvil.

## Problema

Los presupuestos enviados que el cliente no responde quedan enterrados en la bandeja. La regla
`quote_unanswered` existe, pero solo crea recordatorios automáticos y depende del plazo de cola
(`quotes.sent_at`), no del envío confirmado.

## Diseño

- `quote_sends(tenant_id, quote_id UNIQUE, message_id)`: vínculo presupuesto → mensaje de envío.
  Lo escribe `POST /quotes/:id/send` en la misma transacción. Backfill desde
  `audit_events(action = 'quote.sent').diff.messageId` solo cuando el mensaje existe en la misma
  empresa; el resto queda sin vínculo (cobertura desconocida).
- `quote_unanswered_reviews(tenant_id, quote_id, message_id UNIQUE, reviewed_by, reviewed_at)`:
  marca «revisada». Idempotente (`ON CONFLICT DO NOTHING`); la primera escritura gana. Auditada
  como `quote.unanswered_reviewed`.
- Elegibilidad en SQL con reloj de base de datos:
  `status = 'sent'`, `valid_until > now()`, conversación `status <> 'resolved'`,
  mensaje `status IN (sent, delivered, read)` con `sent_at`,
  `ref = coalesce(m.sent_at, q.sent_at)`,
  `ref + delay <= now() < ref + delay + 168 h`,
  sin mensajes `inbound` del contacto en la misma conversación con
  `created_at >= coalesce(m.created_at, q.sent_at)`,
  sin revisión, y con la visibilidad de la bandeja (`visibilityWhere`).
- `delay` = `tenants.settings.followUps.quoteUnanswered.delayHours` (por defecto 48), sin depender
  de `enabled`.
- Orden `(eligible_at, quote_id)`; cursor keyset con microsegundos (`inbox/cursor.ts`).
- Endpoints: `GET /quotes/unanswered` (página + `counts.eligible` + `counts.unknownCoverage`),
  `POST /quotes/unanswered/:quoteId/review` (owner/admin/agent; 404 si no visible, 409 si ya no
  está pendiente). `GET /inbox/counts` suma `unanswered` (opcional en el contrato).
- La revisión no cambia la cotización ni los `follow_ups`; se muestra el `follow_ups` en estado
  `scheduled` del presupuesto.
- UI: carpeta «Presupuestos sin respuesta» (`FolderId = "unanswered"`), filas con cliente, número,
  importe con moneda, antigüedad, responsable o «Sin asignar», recordatorio programado; acciones
  abrir chat y «Marcar como revisada» (lectores y «ver como» no). Filtro y scroll se conservan al
  volver del chat.

## Tareas

- [x] T1 DB — migración `0104_quote_unanswered.sql` + journal, schema `quote-sends.ts`, test de aislamiento.
- [x] T2 Contracts — schemas de lista, conteos y revisión; `unanswered` opcional en `InboxCounts`; tests.
- [x] T3 Domain — ventana de tiempo, estados de envío confirmado; tests.
- [x] T4 API — servicio + controlador, conteo en `/inbox/counts`, vínculo en el envío, e2e.
- [x] T5 Web — API client, hook, lista, carpeta, integración en `InboxView`; tests unitarios y de navegador.
- [x] T6 Verificación — pruebas focalizadas, `pnpm typecheck`, `pnpm lint`, EXPLAIN con volumen.

## Evidencia (24 nov 2026, local: Postgres 16 + Redis 7 en Docker)

- `pnpm typecheck` → 16/16 tareas; `pnpm lint` → 16/16 tareas.
- contracts 17 archivos / 112 tests; domain 34 / 400; web 51 / 321.
- db (3 archivos de aislamiento): 106 tests; api (e2e nuevo + inbox-v2): 18 tests.
- Playwright Chromium (escritorio + viewport teléfono): 5/5.
- EXPLAIN con 20 000 presupuestos enviados, 200 000 mensajes, 5 000 chats, 190 casos elegibles, rol
  de aplicación con RLS: lista (página + conteos) mediana 44 ms (máx. 79); conteo de la carpeta
  mediana 21 ms. Sin índices nuevos: `messages_tenant_conversation_created_idx` y las claves
  primarias resuelven todo.

## Limitaciones conocidas

- El filtro vive en estado del componente: al salir de la página de la bandeja se pierde (igual que
  el resto de filtros de la bandeja).
- `GET /inbox/counts` cuesta ~20 ms más por llamada con ese volumen.
- La comprobación de «respuesta del cliente» lee todos los mensajes del chat por caso (índice por
  chat, no por rango de fechas): rápido con chats de decenas/cientos de mensajes.
- Backfill local enlazó 0 filas (la base local no tenía eventos `quote.sent`); se probó con filas
  sembradas en el test de aislamiento.
