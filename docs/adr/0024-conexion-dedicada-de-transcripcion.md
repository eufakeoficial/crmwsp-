# ADR 0024 — Conexión dedicada para transcribir audios

- Estado: aceptada
- Fecha: 2026-11-20
- Relacionada: ADR 0008 (IA BYOK con proveedores compatibles con OpenAI)

## Contexto

ADR 0008 fija una sola conexión de IA activa por tenant (índice único parcial
`llm_connections_tenant_active_unique`). Muchos clientes usan OpenRouter, que no ofrece
`/audio/transcriptions`: su prueba de conexión deja `capabilities.transcription = false` y las
notas de voz de sus clientes llegan a la IA como `[audio not transcribed]`. La IA no entiende lo
que el cliente pidió y deriva o responde mal.

## Decisión

Se permite una **segunda conexión opcional, solo para transcribir audios entrantes**.

- `llm_connections.purpose` (`chat` | `transcription`, por defecto `chat`). Las filas existentes
  quedan como `chat` sin intervención.
- El índice único pasa a ser por `(tenant_id, purpose) WHERE is_active`: como máximo una conexión
  activa de chat y una de transcripción por tenant. La RLS por `tenant_id` no cambia.
- Toda consulta de "la conexión activa" filtra `purpose = 'chat'` (helper
  `isActiveChatConnection`). La conexión de transcripción **nunca** responde, extrae pedidos ni
  genera embeddings.
- La key se cifra igual que la de chat (mismo propósito de cifrado, AAD ligado al tenant); solo se
  devuelven sus últimos caracteres. Las URL `custom` pasan por la misma política anti-SSRF.
- La prueba hace una transcripción real de 0,1 s de silencio con el modelo elegido. Verifica key,
  endpoint y modelo; no verifica calidad ni idioma.

### Orden de uso al transcribir una nota de voz

1. Conexión `transcription` activa, con key y última prueba OK.
2. Si no, la conexión `chat` cuando su prueba confirmó transcripción.
3. Si no, `[audio not transcribed]` (comportamiento anterior).

Si la key dedicada no se puede descifrar, se vuelve al paso 2 sin registrar la key.

### Coste y presupuesto

La transcripción se apunta en `usage_ledger` como `transcription_seconds`, con
`meta.purpose` y `meta.llmConnectionId`. El presupuesto mensual del tenant suma todo el ledger,
así que el gasto en audio cuenta contra el mismo límite y la misma barrera previa al turno.

## Consecuencias

- Los tenants con OpenRouter pueden entender notas de voz añadiendo una key de OpenAI.
- Riesgo: cualquier consulta nueva que lea `llm_connections` filtrando solo `is_active` podría
  tomar la conexión de transcripción. Se mitiga con el helper y un test de aislamiento.
- No se abre la puerta a más propósitos sin un ADR nuevo (el CHECK solo admite los dos valores).
