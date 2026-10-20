# ADR 0010 — Aceptación pública de presupuestos y conversión a pedido

**Estado:** aceptado · **Fecha:** 2026-10-20 · **Relacionado:** ADR 0002, ADR 0003

## Contexto
Un presupuesto enviado por WhatsApp lleva un enlace para que el cliente final lo acepte sin cuenta. Ese
enlace es la única superficie pública (`@Public`) del dominio de ventas y tiene que respetar el
aislamiento por tenant (ADR 0002). Después, un presupuesto aceptado se convierte en pedido, y hay que
decidir qué importes y qué variante usa ese pedido si el catálogo cambió entre medias.

## Decisión
**Token.** `<tenantId>.<secreto>`, donde el secreto son 32 bytes aleatorios en base64url (43 caracteres).
Solo se guarda `sha256(secreto)` en `quotes.accept_token_hash`, con un índice único parcial
`(tenant_id, accept_token_hash)` (migración 0016). El `tenantId` solo fija el contexto RLS
(`withTenant`); la búsqueda se hace por hash dentro de ese tenant. Cualquier fallo (formato, tenant
inexistente, secreto incorrecto o de otro tenant) responde el mismo 404. Rate limit por IP.
- `GET /public/quotes/:token` devuelve un resumen sin ids internos, sin datos del contacto y sin
  `knowledge_chunk_id`.
- `POST /public/quotes/:token/accept`: solo `sent` y no caducado → `accepted`. Si ya está `accepted`,
  es idempotente (200). `draft`, `rejected`, `expired` o `valid_until` vencido → 409. Se audita con
  `actor_type = system` y `diff.actor = "public"` (el enum no tiene valor `public`).

**Conversión presupuesto → pedido.** El pedido copia los importes **del presupuesto aceptado**
(precio unitario, descuento, IVA y total por línea), no los precios actuales del catálogo: lo aceptado
por el cliente es el contrato. El servidor recalcula los totales con la misma regla half-even
(`computeLineTotal`), así que coinciden con el presupuesto. La variante sale de `quote_items.variant_id`
(0016, FK compuesta con `ON DELETE SET NULL (variant_id)`). Solo en presupuestos anteriores a 0016
(sin `variant_id`) se usa el fallback: variante única activa o etiqueta generada exacta; si no, 400.
Si la variante guardada ya no existe, 400.

**Pagos manuales.** `mark-paid` es solo para owner/admin, con motivo obligatorio. Mientras `orders` no
tenga columna `verified_by` (Fase 4), el audit guarda `verifiedBy = "manual"`. Un pedido `paid` no se
cancela (409): devolver stock comprometido pasa por un flujo de reembolso.

## Consecuencias
- Filtrar un token no expone otros tenants ni otros presupuestos; rotarlo es reenviar el presupuesto.
- Cambiar precios en el catálogo no altera pedidos de presupuestos ya aceptados.
- El stock se reserva al confirmar el pedido, no al aceptar el presupuesto.
- Pendiente para Fase 4: columna `orders.verified_by` (`webhook | reconciliation | manual`).
