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
