# Plugin oficial WooCommerce con código de conexión

Rama: `feat/woocommerce-plugin`. Objetivo: el usuario genera un código en Integraciones → WooCommerce, lo pega en el plugin de WordPress y la tienda queda conectada (webhooks + clave REST) sin pasos manuales. La "licencia" es la cuenta de Vende+; revocable desde el panel.

## Tareas
- [x] T1 (d28e635) (opus, seguridad) DB + contratos + API: migración 0096 `integration_connect_codes` (hash SHA-256, 15 min, un solo uso, RLS system-only + SECURITY DEFINER issue/consume), schemas Zod, POST /integrations/commerce/woocommerce/connect-code (owner/admin), POST /public/woocommerce/connect (público, rate limit, 401 con jitter), helper compartido de upsert, tests (api + contracts + aislamiento db).
- [x] T2 (sonnet) Web: botón "Generar código de conexión" en el tile WooCommerce con cuenta regresiva y copiar; instrucciones de instalar el plugin.
- [x] T3 (66c3d61) (sonnet) Plugin PHP `integrations/wordpress/vendemas-woocommerce/`: pantalla de ajustes, canje del código, crea clave REST (ck/cs) y los 3 webhooks con secreto aleatorio, muestra estado, botón desconectar; readme.txt para WordPress.org; lint básico.

## Checks
`pnpm lint && pnpm typecheck && pnpm test` · plugin: `php -l` sobre cada archivo.

## Evidencia

- Checks: contracts 89 ✅, api 249 ✅ (19 skipped sin Postgres), web 202 ✅, lint/typecheck ✅. Pendiente: tests de DB connect-codes contra Postgres real (CI), php -l (sin PHP local), prueba en WordPress real, alta en wordpress.org.
