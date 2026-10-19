# Infraestructura de desarrollo

Servicios locales que necesitan `apps/api`, `apps/worker` y `apps/web`. Requiere Docker con Compose v2.

## Levantar

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Servicios:

| Servicio | Imagen | Puerto(s) | Credenciales |
|---|---|---|---|
| PostgreSQL 16 + pgvector | `pgvector/pgvector:pg16` | 5432 | `crmwsp` / `crmwsp`, db `crmwsp` |
| Redis 7 | `redis:7-alpine` | 6379 | — |
| RustFS (S3-compatible) | `rustfs/rustfs:1.0.1` | 9000 (API S3), 9001 (consola) | `rustfsadmin` / `rustfsadmin` |
| Mailpit (SMTP) | `axllent/mailpit:v1.31.3` | 1025 (SMTP), 8025 (UI) | — |

Dos contenedores de un solo uso se ejecutan y terminan solos:

- `postgres-init`: activa la extensión `vector` y crea el rol de aplicación `crmwsp_app` (sin `BYPASSRLS`, ver `docs/adr/0002`). El superusuario `crmwsp` queda reservado para migraciones.
- `s3-init` (`amazon/aws-cli:2.37.5`): crea el bucket `crmwsp-dev` en RustFS si no existe.

MinIO ya no se usa: retiró sus imágenes de los registries públicos (ver `docs/adr/0005-s3-local-sin-minio.md`). En producción el almacenamiento es Cloudflare R2 o AWS S3; en dev la app usa el AWS SDK v3 con `forcePathStyle: true` (`S3_FORCE_PATH_STYLE`).

Después copia `.env.example` a `.env` en la raíz; los valores por defecto ya apuntan a estos servicios.

## Consolas

- RustFS: <http://localhost:9001> (`rustfsadmin` / `rustfsadmin`)
- Mailpit: <http://localhost:8025>

## Estado y logs

```bash
docker compose -f infra/docker-compose.dev.yml ps
docker compose -f infra/docker-compose.dev.yml logs -f postgres
```

## Parar

```bash
docker compose -f infra/docker-compose.dev.yml down
```

## Parar y borrar volúmenes (datos)

```bash
docker compose -f infra/docker-compose.dev.yml down -v
```

## Imágenes de producción (API y worker)

Dockerfiles multi-stage en `infra/docker/` (`Dockerfile.api`, `Dockerfile.worker`). Etapa de build: `pnpm install --frozen-lockfile` y bundle con esbuild (los paquetes `@crmwsp/*` van dentro de `dist`); imagen final `node:22-slim` solo con `dist` y las dependencias de producción (`pnpm deploy --prod --legacy`). El contexto es la raíz del repo:

```bash
docker build -f infra/docker/Dockerfile.api -t crmwsp-api .
docker build -f infra/docker/Dockerfile.worker -t crmwsp-worker .
```

Cada Dockerfile tiene su `.dockerignore` junto a él (BuildKit). Estas imágenes no se han construido todavía (sin daemon de Docker en el entorno de desarrollo del ticket F1-J). Variables del worker: `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_MASTER_KEY`, `ENCRYPTION_MASTER_KEY_ID` (entero 1-255). Sin master keys el worker arranca pero el envío saliente queda deshabilitado.

Pendiente de verificar con daemon (gate F1-J): `docker build` real de ambas imágenes y el `HEALTHCHECK` de la API dentro del contenedor. Verificado sin Docker: `pnpm install --frozen-lockfile`, `pnpm --filter <app> --prod deploy --legacy` + `dist` arrancan (`/health` OK) con el `node_modules` desplegado. La API sale con 143 tras SIGTERM (cierre ordenado con `enableShutdownHooks`, Nest re-emite la señal); el worker sale con 0. `pnpm` se obtiene vía corepack a partir de `packageManager` del `package.json` raíz.
