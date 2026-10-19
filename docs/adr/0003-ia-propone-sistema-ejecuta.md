# ADR 0003 — La IA propone, el sistema ejecuta

**Estado:** aceptado · **Fecha:** 2026-10-19

## Contexto
Los modelos pueden inventar precios, plazos o descuentos. El producto promete acciones verificables, no respuestas plausibles.

## Decisión
- El modelo devuelve salida estructurada validada con Zod: respuesta opcional, lista de acciones, citas a `knowledge_chunks`, confianza y `needs_human`.
- Un policy engine determinista clasifica cada acción en `auto`, `approve` o `deny` según tipo, importe, confianza y presencia de citas.
- Toda afirmación sobre precio, stock, plazo o política sin cita válida se bloquea y deriva a humano.
- Las acciones económicas o destructivas siempre requieren aprobación humana.
- Pagos se confirman solo por webhook del PSP o conciliación; nunca por imagen.

## Consecuencias
- Más latencia y tokens por turno a cambio de trazabilidad completa en `ai_actions`.
- Los prompts se versionan y se evalúan con una suite adversarial antes de desplegarse.
