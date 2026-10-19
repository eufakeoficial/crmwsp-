# ADR 0004 — WhatsApp vía BSP y OpenAI como único proveedor de IA

**Estado:** aceptado · **Fecha:** 2026-10-19

## Contexto
Usar Meta Cloud API directamente para dar servicio a terceros exige ser Tech Provider verificado por Meta (empresa verificada, Business Manager, revisión de app). No disponemos de esa estructura. Además, el coste por token de otros proveedores de IA no encaja con un plan de 99 USD/mes.

## Decisión
1. **WhatsApp a través de un BSP** (360dialog o Gupshup; Twilio como alternativa). El BSP da de alta el número y la WABA del cliente, gestiona plantillas y factura las conversaciones de Meta. Nosotros integramos su API y webhooks detrás de `WhatsAppProvider`. El BSP concreto se fija al firmar condiciones ISV por escrito.
2. **OpenAI como único proveedor de IA.** Modelo barato por defecto para clasificación, extracción y respuestas simples; modelo potente solo cuando el policy engine lo requiera. Structured Outputs para acciones, Whisper para audio, `text-embedding-3-small` para conocimiento. BYOK por tenant o créditos con límite.

## Alternativas descartadas
- Meta Cloud API directo: inviable sin verificación como Tech Provider.
- Librerías no oficiales (Baileys, whatsapp-web.js): riesgo de baneo del número del cliente; incompatible con un SaaS de pago.
- Varios proveedores de IA: más código, más evaluación, sin ahorro real.

## Consecuencias
- Dependemos del BSP para onboarding y precios de Meta; se mitiga con el adaptador y un segundo BSP en Escala 1.
- Los prompts y evaluaciones se escriben para los modelos de OpenAI; cambiar de proveedor en el futuro requiere re-evaluar la suite adversarial.
