# ADR 0009 — Mercado objetivo: ecommerce general y servicios generales

**Estado:** aceptado · **Fecha:** 2026-10-20 · **Modifica:** `docs/STRATEGY.md` §6 y §10 (vertical de lanzamiento)

## Contexto
La estrategia inicial proponía lanzar en un único vertical de servicios con presupuestos (instalaciones, reformas, talleres). El dueño del producto decide que CRMWSP sea **horizontal**: tiendas que venden productos por WhatsApp (ropa y productos con variantes de talla/color) y negocios de servicios en general.

## Decisión
1. El núcleo es genérico: inbox, IA con catálogo citado, pipeline, presupuestos/pedidos y cobro verificado.
2. **Catálogo de ecommerce**: productos `physical | service | digital`, variantes (talla, color… en `options`), stock por variante sin sobreventa (reserva atómica, confirmación al pagar, liberación al cancelar), fotos por producto/variante y enlace de video (YouTube u otro, solo enlace).
3. **Pedidos** (`orders`) además de presupuestos (`quotes`): un pedido nace del chat (la IA o el agente lo arma), se cobra con enlace de pago confirmado por webhook y se marca enviado/entregado. Un presupuesto aceptado puede convertirse en pedido.
4. **Medios en WhatsApp**: enviar fotos, videos y documentos desde el inbox y desde la ficha del producto; la IA puede proponer enviar la ficha (foto + precio citado), siempre pasando por el policy engine.
5. Los "kits verticales" pasan a ser **plantillas de arranque** opcionales (tienda de ropa, servicios), no el foco.
6. Etapas por defecto del pipeline, genéricas: Nuevo, Contactado, Interesado, Presupuesto/Carrito enviado, Negociación, Ganado, Perdido.

## Consecuencias
- Más superficie de producto (variantes, stock, envíos) frente a un único vertical; se compensa reutilizando el mismo motor de presupuestos/cobro.
- La IA debe citar precio **y** stock por variante; sin stock citado no promete disponibilidad.
- Pedidos desde audio/foto de lista (antigua Fase 6) siguen después del MVP.
