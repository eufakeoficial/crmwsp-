# fix-prelanzamiento

Objetivo: corregir los hallazgos verificados de la revisión previa al lanzamiento (F1–F10) sobre
`feat/integracion`, con tests y un commit por hallazgo. Rama: `fix/prelanzamiento`.

Fuera de alcance: BYOK vs tope de `ai_messages` (decisión de producto pendiente).

Restricciones: migraciones nuevas desde 0090 (journal escrito a mano); no tocar migraciones de main
(≤0059). Verificación de registro: CI de GitHub Actions (Postgres). Ruta: delegated direct (un
único writer, este agente).

## Tareas
- [ ] F1 (HIGH) 360dialog: dueño cross-tenant, clientId verificado, `state` de un solo uso.
- [ ] F2 (HIGH) email_lifecycle_candidates: cursor keyset + exclusión de ya enviados.
- [ ] F3 (MEDIUM) ActivationGuard bloquea escrituras en restricted/payment_required.
- [ ] F4 (MEDIUM) correo pago-por-vencer con ciclo real; variante "vence hoy".
- [ ] F5 (MEDIUM) UX de modo setup + import de contactos (dedupe + error localizado).
- [ ] F6 (LOW) forgot-password: límite por email; Referrer-Policy y limpieza del token.
- [ ] F7 (LOW) cupones: sobrepaso de max_redemptions marcado para revisión.
- [ ] F8 (LOW) SECURITY DEFINER: precio derivado del plan; tenant desde contexto.
- [ ] F9 (LOW) pestaña "Modo dueño" duplicada.
- [ ] F10 (LOW) Agenda 24:00.

## Evidencia
(se completa por tarea: commit, checks)
