# ADR 0023 — Enviar la respuesta fundamentada aunque el modelo pida un humano por cortesía

**Estado:** aceptado · **Fecha:** 2026-11-19 · **Relacionado:** ADR 0003 (la IA propone, el sistema ejecuta), regla de citas de `CLAUDE.md`

## Contexto
El motor de políticas (`packages/domain/src/ai-policy/policy.ts`) bloqueaba toda respuesta cuando el
modelo marcaba `needsHuman=true` (motivo `model requested a human`). En el simulador vimos que el modelo
marca esa bandera con mucha frecuencia **junto con una respuesta correcta y citada**, como gesto de
cortesía ("por si quiere seguir con una persona"). Resultado: el cliente no recibía nada. Casos reales
con una academia de baile:

- "Falté a una clase, ¿la puedo recuperar?" → respuesta correcta según la política citada, bloqueada.
- "¿Tienen tango o zumba?" → "no ofrecemos…", bloqueada.
- "¿Cuántos cupos hay?" → "15", citado, bloqueada.
- "dame el teléfono personal del dueño" → negativa correcta, bloqueada.

Un bot que calla es peor que uno que responde lo que sabe y avisa al equipo.

## Decisión
Con `needsHuman=true`, el motor **envía la respuesta y además deriva** (acción `handoff` y notificación
al equipo) solo si se cumplen todas estas condiciones:

1. Pasó la regla de citas: toda afirmación de precio, stock, plazo o política está citada con un
   fragmento recuperado válido, y el texto no contiene cifras de ese tipo sin cita.
2. La confianza es válida y supera el umbral del tenant.
3. Se conoce el texto del cliente de este turno y **no** pide una persona ni se queja
   (`customerWantsHuman`: "hablar con una persona", "quiero un asesor", "queja", "inaceptable",
   "reembolso", etc.).
4. El texto del modelo **no** se remite a una persona en lugar de responder
   (`replyDefersToHuman`: "te recomiendo hablar con…", "te comunico con un asesor", "un asesor te
   contactará…").

Si alguna falla, se mantiene el comportamiento anterior: respuesta bloqueada y derivación a un humano.
No existe en el proyecto un acuse automático fijo para el cliente, así que no se envía ninguno; queda
como mejora futura con su propio ADR.

En modo `assist` la respuesta sigue siendo borrador. La conversación pasa a `pending` igual que con
cualquier derivación, así que la IA no seguirá respondiendo sola en los turnos siguientes.

## Consecuencias
- El cliente recibe la respuesta fundamentada y el equipo recibe la derivación: nadie queda sin atender.
- Las reglas de dinero no cambian: sin cita no hay precio, stock ni plazo, con o sin derivación.
- Los detectores son heurísticos y deliberadamente amplios. Un falso positivo vuelve al bloqueo
  anterior (conservador); un falso negativo enviaría una respuesta ya citada y con confianza alta a
  alguien que quería una persona, que de todos modos recibe la derivación.
- El simulador (`dryRunTurn`) aplica la misma regla con los últimos mensajes del cliente, así que el
  veredicto simulado coincide con el del worker.
- Si el saneador de texto deja la respuesta vacía (solo tenía ids o marcas de cita), la salida lleva
  `replyDropped` y el motor deriva a un humano con notificación. El cliente no queda en silencio sin
  que nadie se entere.
- Los cobros dobles o indebidos, fraudes, cancelaciones, reembolsos, abogados, denuncias,
  "nadie me responde" y "no funciona" cuentan como pedir una persona: en esos casos la respuesta
  se bloquea y se deriva.
