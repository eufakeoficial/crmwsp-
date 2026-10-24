# ADR 0014 — 360dialog como segundo BSP: onboarding Coexistence

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0002, ADR 0004

## Contexto
Gupshup rechaza números que ya están registrados en la app WhatsApp Business: el negocio tendría que
borrar el número de la app (perdiendo su flujo diario) o comprar un número nuevo. Muchos negocios de
servicios atienden desde la app y no aceptan ninguna de las dos cosas.

Meta ofrece **Coexistence** (Embedded Signup): el mismo número funciona a la vez en la app WhatsApp
Business y en la Cloud API. 360dialog lo expone a sus partners con el flujo "Connect" (Integrated
Onboarding).

## Decisión
- 360dialog es un segundo BSP detrás de `WhatsAppProvider` (`Dialog360Provider`, base
  `https://waba-v2.360dialog.io`, cabecera `D360-API-KEY`). El valor `360dialog` del enum
  `channel_provider` ya existía; **no hay migración ni tabla nueva**.
- `RoutingWhatsAppProvider` despacha por `conn.provider` (envíos) y por la cabecera interna `x-bsp`
  (parseo de webhooks, tomada de `inbound_events.provider`). API y worker usan
  `createDefaultWhatsAppProvider()`; los canales Gupshup no cambian.
- Webhook `POST /webhooks/360dialog/:webhookToken`: mismo patrón que Gupshup (token opaco por
  conexión que resuelve el tenant en `ingest_inbound_event`, 401 uniforme, `inbound_events` con
  `dedupe_key` = `msg:<id>` / `status:<id>:<estado>`, luego cola). 360dialog reenvía el cuerpo de la
  Cloud API de Meta, que ya entendía el parser v3 de Gupshup (se reutiliza `parseV3`). No hay firma:
  la autenticidad es el token de la URL, igual que en ADR 0004.
- Onboarding: el tenant pulsa "Conectar con 360dialog (mantén tu WhatsApp Business)", el Hub devuelve
  a `/app/channels/360dialog/callback?client=…&channels=[…]` y la web llama a
  `POST /channels/360dialog/connect` (owner/admin). El API, con las credenciales de partner del
  entorno (`D360_PARTNER_ID`, `D360_PARTNER_API_KEY`), crea la API key del canal, la guarda cifrada
  (mismo AAD `gupshup_api_key`, nombre histórico compartido por todos los BSP), registra la URL del
  webhook en el canal y crea la `channel_connection` (`external_app_id` = id de canal 360dialog). Es
  idempotente: un canal ya conectado no regenera la key (regenerarla revoca la anterior).
- Plantillas: 360dialog las identifica por nombre+idioma; `external_id` se guarda como
  `nombre|idioma`. Envío, alta y sync funcionan sin credenciales de Partner extra.
- El token del webhook de un canal 360dialog no se rota desde la UI: la URL está registrada en 360dialog.

## Consecuencias
- Un tenant puede seguir usando la app WhatsApp Business y recibir en el Inbox los mensajes de clientes.
- Fuera de alcance: eco de mensajes enviados desde la app (`smb_message_echoes`) e historial; hoy se ignoran.
- Las rutas exactas de la Partner API (`api_keys`, listado de canales) siguen la referencia de 360dialog
  y deben validarse en su sandbox antes de producción; el teléfono cae a un campo manual si el Hub no lo expone.
- Requisitos externos: cuenta Partner de 360dialog, verificación del negocio en Meta y las dos
  variables de entorno; sin ellas el botón no aparece y el endpoint responde 503.
