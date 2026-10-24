# Agenda UI y alta manual de contactos

## Objetivo
Exponer en la web la agenda (API de reservas ya existente) y permitir crear contactos a mano.

## Alcance autorizado
apps/web/src/**, apps/api/src/contacts/**, apps/api/src/bookings/**, packages/contracts/src/**, packages/domain/src/**.

## Tareas
- [x] T1 Agenda UI: recursos, servicios, horario semanal y excepciones, disponibilidad, calendario de reservas (dia/semana) con crear/reprogramar/cancelar. Entrada "Agenda" en el nav.
- [x] T2 POST /contacts (guard de tenant, ActivationGuard, limite de plan, E.164, duplicado 409 con enlace) + formulario "Nuevo contacto".
- [x] T3 "Nueva oportunidad" en Pipeline si la API existe.

## Ruta
T2 API inline (un controlador + contrato + test unitario). T1 y formularios web delegados a mano propia por ser acotado y sin API nueva.

## Verificacion
pnpm typecheck, pnpm lint, pnpm turbo run test --continue (tests con DB se omiten en local).

## Progreso
T2: 6750ed6. T1: 9fd09ee. T3: POST /opportunities ya existia; solo UI (dialogo + ContactPicker compartido).
