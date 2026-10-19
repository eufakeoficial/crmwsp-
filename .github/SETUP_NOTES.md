# Notas de integración — T5 (CI + commitlint)

Este ticket no toca `package.json` (lo crea otro agente). Para que `commitlint` y `husky`
funcionen, el orquestador debe añadir al **`package.json` raíz**:

## devDependencies

```json
{
  "devDependencies": {
    "@commitlint/cli": "^19.8.0",
    "@commitlint/config-conventional": "^19.8.0",
    "husky": "^9.1.7"
  }
}
```

## scripts

```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

`prepare` corre en `pnpm install` e instala los hooks desde `.husky/`. El hook
`.husky/commit-msg` ejecuta `pnpm exec commitlint --edit "$1"`, que resuelve
`commitlint.config.cjs` en la raíz (`extends: ['@commitlint/config-conventional']`).

## Requisitos del workflow `.github/workflows/ci.yml`

- `packageManager` en `package.json` raíz (hoy `"packageManager": "pnpm@10.28.0"`):
  `pnpm/action-setup@v4` toma la versión de ahí y falla si falta.
- `pnpm-lock.yaml` commiteado: el install usa `--frozen-lockfile`.
- Scripts raíz: `lint`, `typecheck`, `test`, `db:migrate`. Si alguno falta, CI falla
  a propósito.
- `pnpm db:migrate` corre con `DATABASE_URL_MIGRATOR` (superusuario `crmwsp`) y `pnpm test` con
  `DATABASE_URL` (rol `crmwsp_app`, NOBYPASSRLS, ADR 0002) y `REDIS_URL`, contra los
  servicios `postgres` (`pgvector/pgvector:pg16`) y `redis:7`. Orden: lint → typecheck → roles → migrate → test.
- Cache de Turborepo en `.turbo` (añadir `.turbo` a `.gitignore`).

## Tras integrar

1. `pnpm install` (ejecuta `prepare` → husky instala los hooks).
2. Verificar: `git commit -m "mensaje sin tipo"` debe ser rechazado por commitlint.
3. Borrar este archivo o moverlo a `docs/` una vez aplicado.
