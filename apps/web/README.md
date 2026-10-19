# @crmwsp/web

Next.js 15 (App Router) + Tailwind 4. Habla con la API solo a través de su propio origen.

## Proxy a la API

`next.config.ts` reenvía `/api/*` a la API (`/api/auth/me` -> `GET {API_INTERNAL_URL}/auth/me`).
`API_INTERNAL_URL` vale `http://localhost:4000` por defecto.

- El navegador solo ve el origen de la web, así que la cookie `__Host-crmwsp_session` (ADR 0006) viaja sin CORS.
- Next reenvía la cabecera `Origin` original del navegador, pero el `Host` que ve la API es el de la API
  (`localhost:4000`). La comprobación CSRF de la API (`apps/api/src/common/csrf.ts`) acepta `Origin` si está en
  `WEB_ORIGINS` o coincide con el `Host`. Detrás del proxy no coincide, por lo que **`WEB_ORIGINS` debe incluir el
  origen de la web**, por ejemplo `WEB_ORIGINS=http://localhost:3000`. Sin eso, signup, login y logout responden 403.
- Las peticiones con `x-tenant-id` saltan la comprobación de `Origin`; las rutas públicas (signup/login/logout) no
  la llevan, por eso dependen de `WEB_ORIGINS`.
- La cookie lleva `Secure`. En `http://localhost` los navegadores (Chromium, Firefox) la aceptan por ser un origen
  seguro; en cualquier otro host http plano se descarta, así que hay que usar HTTPS fuera de localhost.

## Desarrollo

```
pnpm --filter @crmwsp/api build && API_PORT=4000 WEB_ORIGINS=http://localhost:3000 node apps/api/dist/main.js &
pnpm --filter @crmwsp/web dev      # http://localhost:3000
pnpm --filter @crmwsp/web test
```

## Notas

- `middleware.ts` solo comprueba que exista la cookie de sesión en `/app/*`; la validación real es `GET /auth/me`.
- El tenant activo se guarda en `localStorage` (con fallback en memoria) y se valida contra `me.tenants` en cada carga.
- `@crmwsp/contracts` exporta TypeScript: `transpilePackages` y un `extensionAlias` de webpack resuelven sus imports `.js`.

## Tiempo real (SSE)

`useTenantEvents` (`src/lib/hooks/use-tenant-events.ts`) abre un único `EventSource` por pestaña sobre
`/api/events?tenantId=<activo>` (ADR 0007), compartido por el contador del sidebar y el Inbox mediante
`TenantEventsProvider`. Se cierra al cambiar de tenant o desmontar, reconecta con backoff (1 s … 30 s) y refresca
por REST tras cada reconexión (los eventos son best effort). `EventSource` no expone el código HTTP, así que tras un
error se sondea la URL con `fetch`: con **429** (tope de 5 streams por usuario) no se reintenta y el Inbox avisa.

**¿El rewrite de Next bufferiza SSE?** No. Verificado con `next dev` y `next start`, con `Accept-Encoding: gzip`:
`retry:` y `: connected` llegan al instante y los eventos aparecen en el Inbox sin recargar. La API responde con
`cache-control: no-cache, no-transform` (Next no comprime la respuesta) y `x-accel-buffering: no`. Se mantiene el
rewrite (la opción más simple, sin código extra ni route handler que reenvíe cookies). En producción, cualquier
proxy delante de la web debe desactivar el buffering para `/api/events` (nginx lo respeta con `x-accel-buffering: no`;
en otros balanceadores, desactivar buffering/compresión de `text/event-stream` y un timeout de lectura > 25 s, que es
el intervalo del heartbeat). Si algún día un proxy lo impide, la alternativa es un route handler de streaming en
`app/api/events/route.ts` que reenvíe la cookie.
