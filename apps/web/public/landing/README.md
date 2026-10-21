# Media de la landing

Suelta aquí los archivos y luego pon su ruta en `src/components/landing/media.ts` (campo `src`).
Mientras `src` esté vacío, la landing muestra un recuadro punteado que indica qué va en cada hueco.

| Clave en media.ts | Archivo sugerido | Qué poner | Tamaño |
| --- | --- | --- | --- |
| hero | hero-inbox.webp | Captura del inbox con una conversación real | 1600x1000 |
| showcaseAi | showcase-ai.webp | Respuesta de la IA con la cita al catálogo | 1200x900 |
| showcasePlaybook | showcase-playbook.webp | Pantalla del playbook de ventas | 1200x900 |
| showcaseQuotes | showcase-quotes.webp | Presupuesto o pedido con estado de pago | 1200x900 |
| demoVideo | demo.mp4 + demo-poster.webp | Video demo 60-90 s (H.264) y su imagen de portada | 1920x1080 |
| LOGOS[0..4] | logo-1.svg ... logo-5.svg | Logos de clientes, fondo transparente | 240x96 |
| TESTIMONIALS[0..2].avatar | testimonial-1.webp ... | Foto de cada persona | 160x160 |

Notas: usa WebP/AVIF para imágenes, mantén cada imagen bajo ~250 KB y el video bajo ~8 MB.
Solo material propio: sin imágenes de stock externas. Los testimonios se escriben en `TESTIMONIALS` (media.ts) y deben ser reales.
