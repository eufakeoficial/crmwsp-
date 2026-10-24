# Feature: 360dialog como segundo BSP (Coexistence)

## Objetivo
Permitir que un tenant conecte un numero que ya vive en la app WhatsApp Business **sin borrarlo**,
usando 360dialog (Partner "Integrated Onboarding" / Connect) con Meta Embedded Signup en modo
Coexistence, detras de la interfaz existente `WhatsAppProvider`.

## Problema
Gupshup rechaza numeros que ya estan registrados en la app WhatsApp Business: obliga a migrarlos
(perdiendo la app) o a comprar un numero nuevo. Coexistence permite usar la app y la Cloud API a la vez.

## Alcance
- `Dialog360Provider` (texto, media, plantilla, reaccion, descarga de media, plantillas) + parseo de webhooks Cloud API.
- Router de proveedores por conexion (`conn.provider`) para worker/api.
- Webhook `POST /webhooks/360dialog/:webhookToken` -> `inbound_events` (dedupe) -> worker.
- Onboarding: `POST /channels/360dialog/connect` (callback Connect: client + channel ids) -> API key via Partner API (cifrada) -> registra webhook -> `channel_connections`.
- UI: boton "Conectar con 360dialog" + pagina callback.
- ADR 0014.
- Sin tabla nueva ni migracion (la funcion `ingest_inbound_event` ya recibe el proveedor).

## Fuera de alcance
- Eco de mensajes enviados desde la app (`smb_message_echoes`) y sincronizacion de historial.
- Facturacion/pricing de 360dialog.

## Restricciones
- Secretos solo en env vars (`D360_PARTNER_ID`, `D360_PARTNER_API_KEY`), nunca reales en el repo.
- API key del canal cifrada (mismo AAD `gupshup_api_key`, nombre historico compartido por todos los BSP).
- Todo acceso a datos por `withTenant`; ninguna tabla nueva.

## Tareas
- [x] T1 [1c78aeb] Provider 360dialog + parseo + tests (fixtures)
- [x] T2 [816de05] Router de proveedores + `WhatsAppConnection.provider` + worker usa router
- [x] T3 [9408b7b] Webhook 360dialog (api) con dedupe + tests
- [x] T4 [a4668d1] Onboarding endpoint + contratos + env example
- [x] T5 [4e5d4cf] UI boton + callback
- [x] T6 ADR + ARCHITECTURE
- [x] T7 Verificacion: typecheck y lint OK; tests OK salvo 1 fallo previo en packages/knowledge (CSV, ajeno); tests con DB omitidos (sin DATABASE_URL)

## Criterios de aceptacion
- Webhook 360dialog con mismo mensaje dos veces crea un solo evento (dedupe `msg:<id>`).
- Un canal `360dialog` envia por `waba-v2.360dialog.io` con `D360-API-KEY`.
- El connect guarda la API key cifrada y nunca la devuelve.
- Canales Gupshup siguen funcionando igual.

## Route / evidencia
Delegated direct (fork de un writer unico); mapeo previo > 5 lookups.

## Progreso
(commits se anotan aqui)
