# ADR 0007 — Tiempo real del inbox con Server-Sent Events

- **Estado:** aceptada
- **Fecha:** 2026-10-19
- **Ticket:** F1-F

## Contexto
El inbox necesita enterarse en vivo de mensajes entrantes, cambios de estado de entrega (`sent`/`delivered`/`read`/`failed`) y cambios de conversación (asignación, estado, leído). El worker ya publica esos eventos en Redis pub/sub en `tenant:<id>:events`. El flujo es **unidireccional** servidor → navegador: todas las acciones del usuario ya son endpoints REST con guard de tenant, CSRF e idempotencia.

## Decisión
`GET /events` con **SSE** (`text/event-stream`) en apps/api, en lugar de WebSocket.

- Autenticación: la cookie de sesión (SessionGuard global). Tenant por `x-tenant-id` o, como `EventSource` no permite cabeceras, por `?tenantId=` **solo en esta ruta GET de lectura**; la membership se valida igual que en `TenantGuard`. Al ser GET sin efectos, el CSRF no aplica.
- Una **única conexión Redis subscriber por proceso** (`RealtimeHub`): se suscribe a `tenant:<id>:events` mientras haya al menos un cliente local de ese tenant y hace el fan-out en memoria. Al desconectarse el último cliente se da de baja del canal. No se abre una conexión Redis por cliente.
- Los eventos se validan con `inboxEventSchema` (`@crmwsp/contracts`) antes de reenviarse; solo llevan ids (`type`, `conversationId`, `messageId`), nunca texto ni datos del contacto: el cliente vuelve a pedir por REST lo que necesite.
- Heartbeat (comentario `: ping`) cada 25 s para que proxies y balanceadores no corten la conexión; `retry: 5000` para la reconexión automática de `EventSource`.
- Tope de 5 streams SSE simultáneos por usuario y proceso (`SSE_MAX_CONNECTIONS_PER_USER`); el siguiente recibe 429 `RATE_LIMITED`. Evita agotar memoria y sockets por pestañas o clientes con fugas.
- Best effort: si se pierde un evento (reconexión, reinicio), el cliente refresca por REST. No hay replay con `Last-Event-ID`.

## Por qué no WebSocket
- No necesitamos canal cliente → servidor; WebSocket añade un protocolo, autenticación y CSRF propios (handshake con cookie, *cross-site WebSocket hijacking*) y una dependencia (`@nestjs/websockets` + adaptador) sin beneficio.
- SSE es HTTP normal: pasa por la misma pila de guards, cookies y proxies, y `EventSource` reconecta solo.

## Consecuencias
- Cada pestaña abierta mantiene una conexión HTTP larga; con HTTP/2 en el borde no consume el límite de 6 conexiones por origen del navegador.
- Escalado horizontal sin estado compartido: cada réplica de la API tiene su propio subscriber y recibe todo lo publicado en Redis.
- Si en el futuro hace falta comunicación bidireccional (indicador de "escribiendo", presencia), se reabre con un ADR nuevo.
