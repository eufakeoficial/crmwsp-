# Prompts de IA para que el cliente complete pasos externos

Estado: implementado en feat/prompts-ia-clientes. Se implementa después de las ramas `feat/saldos-y-salud-canal` y `feat/perfil-whatsapp`, porque toca las mismas pantallas.

## Objetivo
Cada paso que el cliente tiene que hacer fuera de Vende+ (en Gupshup o en Meta) trae un botón **"Hacerlo con IA"**. El botón copia un prompt listo para pegar en Claude (Claude Code o la extensión de Chrome), ChatGPT o cualquier asistente de navegador, y la IA hace el paso por el cliente.

## Por qué
- Hoy muchos clientes ya tienen un asistente de IA en el navegador.
- En el alta del 2026-11-19, los pasos manuales en Gupshup (webhook, API key, app correcta) llevaron horas.
- Con la extensión de Claude y prompts concretos, esos mismos pasos se resolvieron en minutos.
- Si conectar el WhatsApp falla, el cliente se va.

## Reglas de cada prompt
- Va precargado con los datos del cliente que no son secretos: la URL de webhook, el nombre de la app, el número y los eventos que hay que marcar.
- Nunca incluye API keys, tokens, contraseñas ni datos de pago.
- Le pide a la IA que **se detenga y le pase el control al cliente** para pegar una API key, iniciar sesión, resolver un captcha o pagar.
- Termina con un **chequeo**: la IA recarga la página y confirma el resultado (por ejemplo, "la URL guardada coincide").
- Está en español neutro, es corto y tiene pasos numerados.

## Prompts a cubrir
- [x] P1. Configurar el webhook en Gupshup: app, URL, formato v2, eventos Mensaje/Enviado/Entregado/Leído/Error, interruptor encendido.
- [x] P2. Crear la API key de la app en Gupshup y llevar al cliente a pegarla en Vende+. Avisar que no acepte el autocompletado del navegador.
- [x] P3. Ir a recargar saldo en Gupshup (wallet), sin tocar el pago.
- [x] P4. Conseguir el ID de app y el Token de Partner, que se usan para el perfil y las plantillas.
- [x] P5. Pedir el cambio de nombre visible en Meta WhatsApp Manager, avisando que Meta lo aprueba.
- [x] P6. Completar el perfil de WhatsApp (foto, descripción) si la API no lo cubre.
- [x] P7. Verificar todo el canal: app correcta, últimos 4 caracteres de la API key, webhook que coincide y envío de prueba.

## Dónde va en la interfaz
- Un botón "Hacerlo con IA" junto a cada paso manual: guía de conexión de canal, tarjeta del canal, Perfil de WhatsApp y Saldos.
- Copia el prompt al portapapeles y muestra el aviso "Prompt copiado: pégalo en tu asistente de IA (Claude, ChatGPT…)".

## Criterio de aceptación
- Cada paso manual externo tiene su prompt, con los datos reales del tenant.
- Hay tests que verifican que ningún prompt contenga secretos (API key, tokens).
- El texto de la interfaz está en español neutro.
