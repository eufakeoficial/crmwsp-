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
