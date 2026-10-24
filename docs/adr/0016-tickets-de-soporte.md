# ADR 0016 — Tickets de soporte entre clientes y el equipo de la plataforma

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0002, ADR 0007, ADR 0011

## Contexto
Los usuarios de cada empresa necesitan pedir ayuda (facturación, WhatsApp, IA, errores) sin salir
del panel, y el dueño del SaaS necesita responder desde el backoffice, con notas internas y
respuestas rápidas. Los tickets son datos de un tenant, pero el equipo de soporte los ve todos:
el mismo choque con RLS que resolvió el ADR 0011.

## Decisión
**Tablas (migración 0068).** `support_tickets` y `support_messages` son tablas de tenant
(`tenant_id`, RLS, FK compuesta). Cada ticket guarda el usuario que lo abrió (`created_by`), la
empresa, categoría (`billing | whatsapp | ai | bug | other`), prioridad (`low | normal | high |
urgent`), estado (`open | in_progress | waiting_customer | resolved`), el admin asignado y dos marcas
de no leído: `tenant_unread` (hay respuesta del soporte sin abrir) y `admin_unread` (el cliente
escribió algo que ningún admin abrió). Las marcas son por ticket, no por usuario: suficiente para
un aviso en el menú. `support_canned_responses` es de plataforma: sin privilegios para `crmwsp_app`.

**Lado del tenant (`/support`, TenantGuard).** Cualquier miembro abre tickets; owner/admin ven todos
los de su empresa y el resto de roles solo los suyos (un ticket ajeno responde 404). Crear tickets
tiene rate limit por usuario y empresa (10 por hora, el limitador en memoria existente).

**Defensa en la base, no solo en la API.**
- La política RLS de `support_messages` para el rol de app **oculta las notas internas** y solo
  permite insertar mensajes públicos `tenant_user`. Un fallo en la API no puede filtrar ni
  falsificar una nota interna o una respuesta del soporte.
- El rol de app no puede borrar tickets ni mensajes, y en `support_tickets` solo puede actualizar
  las columnas del flujo del cliente (estado, marcas de no leído, fechas). Asignación, prioridad y
  asunto solo cambian desde las funciones de plataforma (permisos por columna).

**Lado de plataforma (`/platform/support`, PlatformAdminGuard).** Igual que el ADR 0011: 404 para
quien no es admin, comprobación de `platform_admins` en cada petición, y acceso entre tenants
**solo** por funciones `SECURITY DEFINER` `platform_support_*` (listar con filtros, hilo con notas
internas, responder/nota, cambiar estado/prioridad/asignación, marcar leído, contador, CRUD de
respuestas rápidas). Toda escritura se audita en `platform_audit_events` (`support.reply`,
`support.update`, `support.canned_*`). Las funciones solo devuelven datos del ticket, su empresa
(id y nombre) y nombre/email de quien lo abrió: nunca conversaciones ni contactos.

**Reglas de estado (`@crmwsp/domain`, repetidas en SQL).** Respuesta pública del soporte →
`waiting_customer` (salvo `resolved`); nota interna → no cambia nada; respuesta del cliente sobre
`waiting_customer` o `resolved` → `open`; el cliente puede cerrar (→ `resolved`) un ticket no
resuelto. El admin puede poner cualquier estado.

**Tiempo real (reutiliza ADR 0007).** Mismo `RealtimeHub` (Redis pub/sub + SSE). Evento
`support.ticket_updated { ticketId }` (solo ids): al canal del tenant cuando responde el soporte o
cambia el ticket, y a un canal nuevo `platform:support:events` cuando el cliente escribe. El
backoffice lo consume en `GET /platform/support/events` (detrás del mismo guard). Las notas
internas solo se avisan al canal de plataforma. No hay un stack de tiempo real nuevo.

**Respuestas rápidas.** Plantillas de plataforma con variables `{{nombre}}`, `{{negocio}}`,
`{{ticket}}` y `{{asunto}}`, que se expanden al insertarlas en la caja de respuesta (una sola
pasada, las variables desconocidas quedan escritas para que se vean antes de enviar).

## Consecuencias
- El aislamiento por tenant no cambia: la única vía entre tenants sigue siendo un conjunto cerrado
  de funciones auditables con tests.
- v1 es solo texto: sin adjuntos (se pueden añadir reutilizando el almacenamiento S3 de ADR 0005).
- El aviso de no leídos es por ticket, no por usuario; tampoco hay email ni notificación de equipo
  (`notifications`) por respuesta: el contador del menú y el SSE cubren el caso.
- El rate limit es en memoria por réplica (mismo TODO que el resto de limitadores).
- La migración 0068 se creó en paralelo con cambios de facturación: puede requerir renumerarse al
  integrar ramas.
