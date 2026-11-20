# ADR 0025 — La IA entiende las fotos del cliente

- Estado: aceptada
- Fecha: 2026-11-20
- Relacionada: ADR 0008 (IA BYOK), ADR 0023 (política de envío y citas), ADR 0024

## Contexto

Hasta ahora una imagen entrante solo se leía como comprobante de pago (flujo de recibos, con un
pedido `pending_payment`). En cualquier otro caso la IA veía el texto `[image]` y respondía a
ciegas. Los clientes envían fotos de productos, del local, de diseños de referencia o capturas de
pantalla.

## Decisión

Cuando el cliente envía una foto corriente y la conexión de chat tiene `capabilities.vision = true`,
el turno normal incluye **una** imagen y el modelo responde a la intención del cliente.

- **Precedencia:** si el contacto tiene un pedido `pending_payment`, manda el flujo de comprobantes
  (sin cambios, nunca marca pagado). La foto corriente no se evalúa en ese caso.
- **Qué imagen:** la última foto del cliente posterior al último mensaje no-cliente (una por turno).
- **Límites:** JPEG/PNG/WEBP, máximo 5 MB (`MAX_TURN_IMAGE_BYTES`, menor que el de comprobantes).
  No se valida la resolución: solo bytes. Si `attachments.size_bytes` supera el tope, la foto se omite **sin descargarla**; la comprobación tras la descarga queda como segunda barrera. Descarga por el `MediaLoader` existente (ligado al tenant).
  Nunca se registran bytes, URLs ni payloads del proveedor.
- **Modelo y coste:** se usa `capabilities.visionModel` (o `modelCheap`) en todos los intentos del
  turno. Los tokens van al ledger como `llm_tokens` con `meta.vision = true`; el contador
  `ai_messages` del plan sube una vez por turno, como siempre.
- **Mismo gate de dinero:** la imagen es contexto, no fuente. Precio, stock y plazo siguen exigiendo
  cita a `knowledge_chunks`; el motor de políticas (ADR 0023) es la autoridad final.
- **Prompt injection:** la foto y el texto dentro de ella son datos no confiables
  (`IMAGE_RULES`, bloque `<customer_image>`); solo se añaden al prompt cuando hay foto.
- **Personas y atributos sensibles:** no se identifica a personas reales ni se infieren atributos
  sensibles; si se pide, se rechaza con cortesía y se deriva.
- **Respaldo:** sin visión, tipo/tamaño no admitido o fallo de descarga, el turno sigue sin la foto
  (el modelo ve un marcador), la respuesta queda **siempre como borrador** y comienza con
  "El cliente envió una imagen que no pude ver".

## Fuera de alcance

- El simulador no admite imágenes.
- La calidad real de la lectura depende del modelo y no se verifica con tests (proveedores
  simulados).

## Detección de visión

La prueba de conexión de chat envía además un PNG de 64x64 (determinista, algunos proveedores rechazan imágenes diminutas) como `image_url` (data URI) al mismo modelo que usa el turno (helper compartido `resolveVisionModel`: `visionModel` o `modelCheap`). Éxito: `capabilities.vision = true`. Rechazo claro (HTTP 400/404/415/422): `false`. Errores de red, auth o cuota: queda sin cambios y no hace fallar la prueba. La prueba conserva `visionModel` y demás claves guardadas. Ajustes de IA muestra "Lectura de imágenes: disponible / no disponible" (sin visión, la IA no ve las fotos). La sonda verifica que el endpoint acepta imágenes, no la calidad de la lectura.

## Consecuencias

- Más coste por turno con foto (tokens de imagen), acotado por el presupuesto mensual existente.
- Un cliente puede enviar una foto engañosa; el gate de citas y la revisión humana de borradores
  limitan el daño.
