# OpenShorts Basket Roadmap

Ultima actualizacion: 2026-02-14

Este documento es la fuente de verdad para:
- direccion de producto
- hitos tecnicos
- preguntas abiertas
- decisiones temporales
- bitacora de cambios

## 1) Objetivo

Pivotear OpenShorts a un sistema enfocado en baloncesto que:
- reciba videos largos de partidos
- detecte eventos de tiro/canasta
- genere varios clips verticales (9:16) centrados en la jugada
- guarde metadata por clip

## 2) Estado actual

Implementado:
- `BASKETBALL_MODE=1` para evitar flujo de transcripcion/Gemini
- tracking con YOLO detect + YOLO pose en `main.py`
- heuristicas de evento:
  - `detect_shot_made()` (balon + aro, si hay clase aro)
  - `detect_shot_attempt()` fallback por arco del balon
- extraccion de multiples clips en skip-analysis
- metadata compatible con polling del dashboard
- `/api/process` funciona en modo baloncesto sin requerir key de Gemini
- UI con controles de:
  - cantidad de clips objetivo
  - segundos antes del evento
  - segundos despues del evento
- UI con configuracion de backend remoto (Colab/ngrok) para usar GPU externa
- soporte frontend para override de API base URL + header `ngrok-skip-browser-warning`

Limitaciones conocidas:
- sin clase aro dedicada, la deteccion de canasta anotada no es totalmente confiable
- la heuristica de tiro puede dar falsos positivos
- UI aun no expone `min gap` ni controles de confianza

## 3) Decisiones por defecto (vigentes)

- modelo detect: `yolo11n.pt`
- modelo pose: `yolo11n-pose.pt`
- clips por job: `4`
- ventana por evento: `-4s / +6s`
- separacion minima entre eventos: `7s`
- deteccion en ambos aros (sin lock de lado)
- slow-motion: desactivado por ahora

## 4) Preguntas abiertas (con decision temporal)

P1. Que modelo usar para aro y cual class id?
- Temporal: fallback sin aro (`shot_attempt`).
- Siguiente paso: integrar modelo custom y setear `BASKET_HOOP_CLASS_ID`.

P2. Cuantos clips por video?
- Temporal: 4.
- Siguiente paso: mantener control en UI y validar con usuarios.

P3. Ventana final por jugada?
- Temporal: 4s antes + 6s despues.
- Siguiente paso: ajustar por tipo de jugada y retencion.

P4. Un aro o ambos?
- Temporal: ambos (mas recall, menos precision).
- Siguiente paso: agregar modo lock izquierda/derecha.

P5. Slow-motion siempre o por confianza?
- Temporal: apagado.
- Siguiente paso: habilitar solo en eventos de alta confianza.

## 5) Hitos

M0. Estabilidad y documentacion
- estabilizar flujo local + dashboard
- mantener roadmap/bitacora al dia
- mejorar logs para debugging

M1. Deteccion de eventos mas robusta
- score de confianza por evento
- deduplicacion y ranking de eventos
- opcion de lock por lado de cancha

M2. Upgrade de modelos
- detector custom de aro
- mejorar tracking de balon lejano/rapido
- evaluar ByteTrack/BoT-SORT

M3. Producto (UI)
- exponer `min gap` y controles de sensibilidad
- mostrar timeline de eventos detectados
- mejorar mensajes de estado para usuario final

M4. Calidad de highlights
- slow-mo en eventos de alta confianza
- mejor framing en fase de release/aro
- metadata enriquecida (`event_type`, `confidence`, timestamps)

## 6) Backlog priorizado

P0:
- agregar `min gap` en UI
- agregar score de confianza en metadata
- reducir falsos positivos en `detect_shot_attempt()`

P1:
- documentar e integrar modelo custom de aro
- guardar `events.json` por job para auditoria
- pruebas de integracion para contrato de salida en skip-analysis

P2:
- pipeline opcional de slow-mo
- lock por lado de cancha
- OCR de marcador como senal adicional

## 7) Bitacora de cambios

2026-02-13:
- pivot de tracking (face/speaker -> player/ball/pose)
- modo baloncesto fuerza skip-analysis en `main.py`
- fix de salida en modo API cuando `-o` es carpeta
- extraccion multi-clip basada en eventos detectados
- controles UI para cantidad de canastas y ventana pre/post
- README y roadmap pasados a espanol

2026-02-14:
- integracion de backend remoto via Colab/ngrok desde configuracion del dashboard
- script `set-colab-api.sh` para setear `dashboard/.env.local` rapido
- `vite.config.js` actualizado para `VITE_PROXY_TARGET` + headers ngrok

## 8) Regla de mantenimiento

Cada cambio relevante debe actualizar:
- `Estado actual`
- `Decisiones por defecto`
- `Preguntas abiertas`
- `Bitacora de cambios`
