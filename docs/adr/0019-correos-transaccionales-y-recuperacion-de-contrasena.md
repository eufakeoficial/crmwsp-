# ADR 0019 — Correos transaccionales de marca y recuperación de contraseña

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0006, ADR 0013, ADR 0015, ADR 0017

## Contexto
Las plantillas de marca Vende+ (`emailing/`) no se usaban: la app solo enviaba un correo genérico.
Faltaban los avisos de pagos, prueba gratis, referidos, bienvenida y no existía recuperación de
contraseña.

## Decisión
- Las plantillas viven en `packages/mailer/src/templates` y se exportan desde `@crmwsp/mailer`
  (`templateMessage`, `emailContextFromEnv`). El logo siempre se carga desde una URL https absoluta
  (`EMAIL_ASSETS_URL` o `https://www.vendemas.chat/brand`).
- Los correos de pagos y del ciclo de vida se envían desde el tick del worker de suscripciones
  (cada 5 min), siempre **después** de que la liquidación hizo commit: un correo fallido nunca
  revierte un pago. Cada correo reclama antes una clave en `email_dispatches` (0074): sale **como
  mucho una vez** (un envío fallido no se reintenta). Las reglas de cuándo toca cada aviso son
  dominio puro (`packages/billing/src/notifications.ts`) con ventanas acotadas para que un deploy
  no envíe correos históricos.
- Recuperación de contraseña: token de 32 bytes, guardado solo como SHA-256 en
  `password_reset_tokens` (tabla de sistema, como `sessions`), un solo uso, 30 minutos; pedir uno
  nuevo invalida los anteriores. `POST /auth/password/forgot` responde siempre 200 (sin revelar si
  la cuenta existe; correo y auditoría en segundo plano) y usa el limitador de auth.
  `POST /auth/password/reset` cambia el hash y revoca todas las sesiones del usuario en la misma
  función SQL, y se audita.
- No existe un mecanismo de baja de avisos: todos los correos se envían como **de servicio**. Los
  que antes eran "opcionales" (recordatorio de WhatsApp, prueba por terminar, referido) se
  reclasificaron como servicio. No se creó `/unsubscribe`.

## Consecuencias
- Un fallo de SMTP pierde ese aviso (se registra en el log del worker). Se prefirió a duplicar
  correos de cobro.
- Las fechas de estos correos se formatean en UTC.
- Pendiente: correo de respuesta a ticket (rama de soporte), preferencias de avisos con baja.
