# ADR 0005 — Almacenamiento S3 local sin MinIO

**Estado:** aceptado · **Fecha:** 2026-10-19

## Contexto
El entorno de desarrollo (`infra/docker-compose.dev.yml`) necesita un servicio S3-compatible para adjuntos, comprobantes y documentos de conocimiento. El plan inicial era MinIO, pero MinIO retiró sus imágenes de Docker Hub y Quay en septiembre de 2026: `minio/minio` y `minio/mc` ya no se pueden descargar de forma anónima (verificado contra la API de Docker Hub y el registry v2). Las copias que circulan están congeladas en versiones antiguas, con CVE-2025-62506 sin parchear, y no recibirán actualizaciones. Basar el entorno de todos los desarrolladores y de CI en imágenes huérfanas no es aceptable.

## Decisión
- **RustFS (`rustfs/rustfs`) como S3 local de desarrollo**, con tag fijado (`1.0.1`). Es un reemplazo directo de MinIO: API S3, consola web, un solo contenedor, mismos puertos (9000 API, 9001 consola) y healthcheck HTTP (`/health`).
- **El bucket se crea con `amazon/aws-cli`** (servicio `s3-init`, tag fijado), de forma idempotente (`head-bucket` y, si no existe, `s3 mb`). Usar el CLI oficial de AWS evita depender de una herramienta propia del producto de almacenamiento.
- **La aplicación solo habla S3 genérico**: AWS SDK v3 (`@aws-sdk/client-s3`) configurado por `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` y `S3_FORCE_PATH_STYLE`. En dev `forcePathStyle: true` (RustFS solo sirve path-style); en prod `false`. Ningún código importa SDKs específicos de RustFS ni de MinIO.

## Alternativas descartadas
- **MinIO desde imágenes congeladas o compiladas por nosotros:** sin parches de seguridad (CVE-2025-62506) y con mantenimiento a nuestro cargo.
- **Garage (`dxflrs/garage`):** ligero y sólido, pero exige configuración TOML, `garage layout assign/apply` y creación de claves en un init; demasiada fricción para dev y publica tags por commit.
- **LocalStack (`localstack/localstack`):** muy conocido, pero pesado (emula decenas de servicios AWS) para usar solo S3.
- **Usar R2/S3 real en dev:** requiere credenciales por desarrollador, red y coste; rompe el desarrollo offline y los tests de CI.

## Consecuencias
- En producción no cambia nada: Cloudflare R2 o AWS S3, accedidos con el mismo cliente S3.
- Las diferencias de comportamiento entre RustFS y R2/S3 (políticas de bucket, URLs prefirmadas, virtual-hosted style) se cubren con tests de integración contra el proveedor real antes de producción.
- RustFS es un proyecto joven: mantenemos el tag fijado y, si se degrada, el cambio a Garage o LocalStack se limita al compose porque la app solo depende de la API S3.
