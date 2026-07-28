# Buitre

Prototipo de personaje 3D para juego, en Three.js. **Sin un solo asset externo**:
geometría, esqueleto, texturas y animación se generan proceduralmente en el
arranque a partir de una semilla.

El personaje es *El Buitre*: humanoide encorvado, cabeza calva con pico
ganchudo, gola de plumón, alas plegadas en Z contra el costado y patas
digitígradas escamosas.

---

## Arrancar

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

| tecla | |
|---|---|
| `1`–`6` | posado · alerta · acecho · trote · amenaza · comiendo |
| `7` `8` `9` | encuadre héroe · perfil · retrato |
| `R` | giro automático de cámara |
| `E` | abrir/cerrar alas |
| `Q` | activar/desactivar mirada al puntero |
| espacio | sacudida de plumas |
| `H` | reacción a impacto |
| arrastrar / rueda | orbitar y acercar |

Parámetros de URL: `?q=low|medium|high`, `?state=threat`, `?framing=profile`,
`?seed=1234`, `?deterministic`, `?spin`.

---

## Verificar

```bash
npm run verify                # typecheck + build + capturas + métricas, en orden
```

O por partes:

```bash
npm run typecheck
npm run build
npm run shot                  # set de capturas reproducible -> shots/
npm run inspect               # métricas medidas contra umbral
npm run inspect -- --mobile   # y en viewport móvil
```

`npm run shot` y `npm run inspect` levantan vite, conducen la escena por los
hooks de prueba, pausan el reloj y miden el píxel real. Devuelven código 1 si
algo falla, así que sirven tal cual como puerta de CI.

En una máquina sin GPU (o en CI) se usa SwiftShader automáticamente. Si tu
Chromium no es el que Playwright descargó, apúntalo con `CHROMIUM_PATH`.

---

## Estado medido

| | |
|---|---|
| triángulos del personaje | 8 246 |
| huesos | 31 |
| grupos de material | 5 (una draw call cada uno) |
| draw calls de la escena | 8 |
| build del personaje | ~1,1 s |
| dependencias en runtime | `three` |

---

## Documentación

| | |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Léelo antes de escribir código.** El contrato de subsistemas, el mapa de propiedad, las convenciones de espacio y la regla de espejo. |
| [`docs/PROTOTYPING.md`](docs/PROTOTYPING.md) | El método: las siete fases, sus puertas de evidencia, y las reglas que se ganaron a golpes. |
| [`docs/CHARACTER-PIPELINE.md`](docs/CHARACTER-PIPELINE.md) | El pipeline `rig → geo → parts → build → materials → clips → animator`, y cómo añadir piezas y estados. |

---

## Estructura

```
src/
  core/        motor: registry, bucle de frame, RNG determinista, entrada, presets
  render/      renderer, tone mapping, IBL procedural, luces, sombras
  character/   EL personaje: rig, geometría, materiales, skinning, animación
  stage/       suelo y atrezo del banco de pruebas (desechable)
  dev/         cámara de revisión y director de teclado (andamiaje)
  ui/          HUD de diagnóstico (sólo lee)
scripts/       harness de captura e inspector de QA
docs/          método y pipeline
```

---

## Origen

El cimiento sintetiza dos referencias:

- [`mshumer/Claude-of-Duty`](https://github.com/mshumer/Claude-of-Duty) — el
  contrato de motor como mecanismo de coordinación, el registro de subsistemas
  desacoplados, el RNG determinista, y el pipeline de personaje procedural
  (rig → piezas → skinning → capas de animación con deltas euler).
- [`majidmanzarpour/threejs-game-skills`](https://github.com/majidmanzarpour/threejs-game-skills)
  — el método de verificación: scaffold Vite + TypeScript, hooks de prueba
  deterministas, inspección de canvas con métricas medidas, y puertas de
  evidencia antes de declarar nada terminado.

## Deudas conocidas

Anotadas en `docs/PROTOTYPING.md`, no escondidas. Las dos principales: **el IK de
apoyo está a medias** (hay anclaje de pelvis, falta sonda por pie y solución de
dos huesos, así que el personaje sólo pisa plano horizontal) y **las rémiges no
abren en abanico** (con el ala abierta siguen apiladas en un plano).
