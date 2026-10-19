# ADR 0008 — IA con clave propia del cliente: cualquier proveedor compatible con la API de OpenAI

**Estado:** aceptado · **Fecha:** 2026-10-19 · **Modifica:** ADR 0004 (punto 2, "OpenAI como único proveedor")

## Contexto
Cada empresa cliente debe poder conectar su propia API key de IA (BYOK) para no depender de nuestros créditos y elegir el precio que le convenga. Se pidió poder usar OpenCode, pero la suscripción OpenCode Go está orientada a agentes de programación (ver `docs/STRATEGY.md` §9 y §14): usarla para atención al cliente arriesga el bloqueo de la cuenta del cliente y la caída silenciosa de su IA.

## Decisión
1. El `LLMProvider` admite **cualquier proveedor compatible con la API de OpenAI** (chat completions / responses, embeddings y transcripción cuando el proveedor los ofrezca), configurado por tenant con: `provider` (etiqueta), `baseUrl`, `apiKey` y modelo barato / modelo potente.
2. Proveedores recomendados y probados en la guía de la pantalla: **OpenAI** (por defecto), **OpenRouter** y **DeepSeek**. Otros se aceptan como "personalizado" con `baseUrl`.
3. No se ofrece OpenCode Go como opción.
4. La key se cifra con `@crmwsp/crypto` (purpose `llm_api_key`, AAD con el tenant). `baseUrl` solo `https://`, sin IPs privadas ni `localhost` en producción (anti-SSRF).
5. Pantalla **Configuración → IA**: guía paso a paso (dónde comprar la key con enlace directo, coste orientativo, cómo crearla), campo de key, botón **Probar conexión** (llamada mínima de verificación), selección de modelos, **límite de gasto mensual** con aviso al 80 % y apagado de la IA automática al 100 % (nunca del inbox).
6. Alternativa sin key propia: créditos del SaaS con límite, facturados por `usage_ledger`.
7. Capacidades por proveedor (embeddings, audio, salida estructurada) se detectan en "Probar conexión"; si faltan, la función correspondiente se desactiva con explicación en pantalla.

## Consecuencias
- La suite de evaluación adversarial (F6) debe correr contra cada proveedor recomendado antes de recomendarlo.
- La salida estructurada puede variar entre proveedores: el policy engine valida siempre con Zod y rechaza lo que no cumpla.
- Coste por conversación visible por tenant y proveedor en el panel de rentabilidad.
