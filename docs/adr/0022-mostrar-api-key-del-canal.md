# ADR 0022 — Mostrar la API key del canal al dueño

**Estado:** aceptado · **Fecha:** 2026-11-19 · **Relacionado:** ADR 0004 (WhatsApp vía BSP), regla de secretos de `CLAUDE.md`

## Contexto
La regla del proyecto dice que los secretos (API keys de BSP, claves BYOK) van cifrados y jamás salen
en logs, respuestas ni commits. Hasta ahora la tarjeta del canal solo mostraba una pista (`apiKeyHint`).
Los dueños nos piden recuperar la API key de Gupshup para configurarla en otra herramienta o comprobar
cuál está guardada sin entrar al panel del BSP. Negarlo los empuja a copiar la key en notas o capturas,
que es peor.

## Decisión
Abrimos **una única excepción auditada**: `POST /channels/:id/reveal-api-key` devuelve la API key
descifrada del canal, con estos controles:

- **Solo el dueño** del tenant (`@Roles("owner")`); admin, agente y lector reciben 403. El canal debe ser
  del tenant (RLS + 404) y de un proveedor que guarde la key en `credentials_encrypted` (Gupshup o
  360dialog); si no, 400.
- **Contraseña en cada petición.** Se verifica con `verifyPassword` contra el hash del usuario actual
  (mismo `auth_login` SECURITY DEFINER que el login). Si no hay hash se verifica un hash ficticio para no
  delatar por tiempo. Contraseña incorrecta → 403 con mensaje genérico.
- **Límite de 5 intentos por hora** por (usuario, tenant), contando éxitos y fallos, sobre el mismo
  `CounterStore` de Redis que el login (con su degradación a memoria). Exceso → 429.
- **Descifrado con la caja ligada al tenant** (`GUPSHUP_API_KEY_PURPOSE`, `tenantId`), igual que al cifrar.
- **Respuesta `{ apiKey, expiresInSeconds: 30 }` con `Cache-Control: no-store`.** La web muestra la key
  30 segundos con cuenta atrás y botón Copiar; luego la borra del estado. Nunca va a `localStorage`,
  `sessionStorage` ni a la URL, y la contraseña se borra del estado al enviarla.
- **Auditoría** en `audit_events`: `channel.api_key_revealed` y `channel.api_key_reveal_failed`
  (motivo `wrong_password` o `rate_limited`), con IP y `channelId`. El diff nunca lleva la key, ni una
  pista de ella, ni la contraseña.
- **Sin logs.** El endpoint no escribe logs; Fastify no registra cuerpos y el filtro de errores solo
  registra errores no controlados. Un test e2e captura el logger y comprueba que la key no aparece.

## Riesgo residual
- **Contraseña robada:** quien tenga la sesión y la contraseña del dueño puede leer la key. Lo acotan el
  límite por hora, la auditoría (visible para el dueño) y que la key se puede rotar en Gupshup.
- **Pantalla o portapapeles** del dueño durante los 30 segundos o tras copiar: fuera de nuestro control.
- **Redis caído:** el límite pasa a contarse por proceso (más permisivo con varias réplicas).

## Consecuencias
- Es la única ruta que devuelve un secreto de BSP; cualquier otra excepción necesita su propio ADR.
- Si añadimos 2FA, este endpoint debe pedirla además de la contraseña.
