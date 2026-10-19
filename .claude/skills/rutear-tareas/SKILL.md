---
name: rutear-tareas
description: Rutea cada tarea de un trabajo de implementación multi-paso al modelo adecuado (Fable/Sonnet/Opus) según complejidad y la delega vía el tool Agent, para ahorrar contexto del orquestador y costo. Use when starting substantial multi-step implementation, delegating tickets to sub-agents, splitting a feature into tickets, or when the user mentions "rutear tareas", "ahorrar tokens", "qué modelo uso", "delegá por complejidad", or asks which model should do a task.
---

# Rutear tareas por complejidad

Instructivo PARA EL ORQUESTADOR. No es un middleware: no intercepta solo. El
orquestador (vos) clasifica cada tarea, elige modelo y delega con el tool
`Agent(subagent_type:"general-purpose", model: "...")`. Delegar aísla la salida
de herramientas del sub-agente de tu contexto (ahorra tokens de orquestación); el
modelo barato donde alcanza ahorra costo.

## Clasificación → modelo

| Complejidad | Modelo | Ejemplos |
|---|---|---|
| Mecánico / verificable fácil | **fable** | inventarios, tablas, extracción de rutas, documentación |
| Normal con contrato cerrado | **sonnet** | UI, reglas, tests, un ticket acotado por vez |
| Seguridad · dinero · concurrencia · migraciones · arquitectura · **revisión** | **opus** | HMAC/auth, sesiones, ledger/pagos, diseño, revisar diffs |

Regla: si dudás entre dos tiers, subí uno. Nunca mandes dinero/seguridad a Fable.

## Contrato de delegación (en el prompt del Agent)

- `## Allowed edit surfaces`: rutas exactas que el ticket puede tocar, una por línea. El writer se niega a escribir fuera y para si faltan.
- **Leé el código REAL, no el doc**: los shapes de respuesta salen del RETURN del service/handler, no del controller ni del contrato escrito. Este es el origen más común de bugs que `tsc` no atrapa.
- Un ticket = 1–3 archivos. Nada de `git add .` ni commits desde el sub-agente.
- Verificación obligatoria: correr `tsc`/tests y reportar **exit code**.
- Cerrar con bloque `## Key Learnings` (1–5 ítems) para memoria pasiva.

## Gate de revisión (Opus)

Antes de commitear el trabajo de Fable/Sonnet, **Opus revisa el diff real** (no el
resumen del sub-agente):

1. ¿Tocó solo las superficies permitidas? (git status)
2. ¿Los shapes del cliente coinciden con el service real? (el bug que tsc no ve)
3. Spot-check: re-correr 1 comando reportado (tsc/test).
4. Si falla algo: devolvé la corrección **al mismo sub-agente** (SendMessage), no la absorbas vos.

Solo después del gate verde → commit por ticket (Conventional Commits, rutas explícitas).

## Ficha de evidencia por ticket

```
Ticket / archivos tocados:
Pruebas (comando → exit code):
Riesgos / pendientes:
Gate solicitado:
```

## Qué NO es

- No elige modelo "solo"; vos aplicás esta tabla al delegar.
- No reemplaza los triggers de delegación ni los gates de seguridad de CLAUDE.md: los complementa.
- No autoriza tocar dinero/producción sin la autorización que ya exige el proyecto.
