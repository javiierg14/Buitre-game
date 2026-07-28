# BUITRE — contrato de motor

**Todo el que escriba código aquí lee esto antes. Es el único mecanismo de
coordinación del proyecto.**

Objetivo: un personaje 3D de juego en el navegador cuya calidad visual y táctil
aguante una comparación de cerca. WebGL2 + Three.js r180, **sin un solo asset
externo** — toda la geometría, las texturas, la animación y (cuando llegue) el
audio se generan proceduralmente en el arranque desde una semilla.

Esa restricción no es estética. Un asset externo hace que el personaje deje de
ser reproducible desde una semilla, y sin reproducibilidad las baselines de
regresión visual no significan nada.

---

## Reglas duras

1. **Eres dueño de tu carpeta. Nunca edites fuera de ella.** Otra persona (u
   otro agente) es dueña de cada una de las demás, y tu edición se perderá o le
   romperá el arranque.
2. **Nunca importes el módulo de otro subsistema.** Consíguelo en runtime:
   `const r = ctx.get('render')`. Esto es lo que hace seguro el trabajo en
   paralelo. La única excepción son los **tipos** (`import type`) y los
   utilitarios puros de `src/core/`.
3. **Sin dependencias npm nuevas.** Sólo `three`. Sin CDN, sin imágenes, sin
   HDRI, sin modelos, sin audio: el prototipo tiene que correr entero sin red.
4. **Sin `Math.random()` en gameplay ni en visuales.** Usa `ctx.rng` (ver
   `src/core/rng.ts`) o un `ctx.rng.fork()` que guardes en `init()`. La
   reproducibilidad de las capturas depende de ello.
5. **No reserves memoria por frame.** Preasigna vectores, matrices y arrays en
   `init()` y reutilízalos. Un `new THREE.Vector3()` dentro de `update()` es un
   bug, no un detalle de estilo.
6. **Libera lo que creas.** Geometrías, materiales, texturas y render targets se
   liberan en `dispose()`.
7. `npm run build` tiene que pasar y `npm run shot` tiene que producir una
   captura después de tu cambio. Si rompes el arranque, nadie más puede
   trabajar.

---

## Interfaz de subsistema

```ts
export class MiSistema implements System {
  static readonly id = 'misistema';        // único; por aquí te alcanzan
  static readonly deps = ['render'] as const; // ids que arrancan antes

  init(ctx: Ctx): void | Promise<void> {}  // construye recursos; puede esperar
  fixedUpdate(h: number, ctx: Ctx): void {}// opcional, 120 Hz, determinista
  update(dt: number, ctx: Ctx): void {}    // opcional, una vez por frame
  lateUpdate(dt: number, ctx: Ctx): void {}// opcional, tras todos los update()
  resize(w: number, h: number, ctx: Ctx): void {} // opcional
  dispose(): void {}                        // opcional
}
```

`ctx` ofrece: `scene`, `camera`, `canvas`, `config`, `events`, `input`, `time`,
`rng`, `get(id)`, `peek(id)`, `has(id)`.

- `time` — `{ elapsed, raw, dt, fixed, alpha, scale, frame }`. Usa `alpha` para
  interpolar transformadas renderizadas entre pasos de física.
- `config.q` — el preset de calidad activo (ver `src/core/config.ts`). Respeta
  `q.limbSegments`, `q.textureSize`, `q.featherCount`, `q.shadowMapSize`,
  `q.maxDpr`. **Un preset es un presupuesto, no una sugerencia.** Si necesitas
  más de lo que concede, baja el detalle; no subas el presupuesto.

El orden de `engine.add()` en `src/main.ts` no importa: el `Registry` ordena
topológicamente por `static deps` y lanza en ciclos o dependencias ausentes.

---

## Mapa de propiedad

| id | carpeta | posee |
|---|---|---|
| `render` | `src/render/` | WebGLRenderer, tone mapping, IBL procedural, todas las luces, sombras |
| `character` | `src/character/` | rig, geometría procedural, materiales, skinning, runtime de animación |
| `stage` | `src/stage/` | suelo y atrezo del banco de pruebas (desechable) |
| `orbit` | `src/dev/orbit.ts` | cámara de revisión y encuadres reproducibles |
| `director` | `src/dev/director.ts` | andamiaje que conduce al personaje desde el teclado |
| `ui` | `src/ui/` | HUD de diagnóstico. **Sólo lee**, no conduce nada |

Compartido, propiedad del responsable (no editar sin acordarlo): `src/core/`,
`src/main.ts`, `scripts/`, `vite.config.ts`.

### Por qué `ui` no puede conducir

Si el HUD pudiera cambiar el estado del personaje, una captura automatizada y
una sesión manual dejarían de ser el mismo programa, y el primer desacuerdo
entre ambas costaría un día de depuración. El HUD lee; el `director` conduce;
los hooks de prueba conducen. Tres caminos, un solo dueño del estado.

---

## Eventos entre subsistemas

Se emiten y escuchan por `ctx.events`. Los payloads son objetos planos.

| evento | payload | lo emite |
|---|---|---|
| `resize` | `{ width, height }` | engine |

El bus está montado y probado, pero el proyecto todavía no lo necesita: con dos
subsistemas de dominio, `ctx.get()` es más directo y más fácil de seguir. **Si
añades un evento, añade su fila aquí en el mismo commit.** Una tabla de eventos
desactualizada es peor que no tenerla.

---

## Convención de espacio

Metros. Pies en `y = 0`. El personaje mira a **+Z**.

Como Y es arriba y Z adelante en un sistema diestro, la **derecha del personaje
cae en X negativa**: todo hueso `*R` vive en `x < 0`. Equivocarse aquí pone la
garra buena en el lado malo y no se nota hasta el encuadre frontal.

### Ejes de hueso

El local **+Y corre a lo largo del hueso** hacia su hijo; el local +Z apunta
aproximadamente adelante. Un futuro subsistema de física puede adoptar el
esqueleto para un ragdoll sin que la pose salte.

### La regla de espejo

Los ejes locales de un par R/L **no** son simétricos. Con la misma pista de
`up`, los ejes Y y Z salen espejados y el X sale anti-espejado. Por tanto, una
pose simétrica se autoriza así:

```
x (flexión)  → MISMO signo en ambos lados
y (torsión)  → signo OPUESTO
z (lateral)  → signo OPUESTO
```

Un `P.d()` de un par que no siga esto produce un personaje asimétrico que **no
se ve en el encuadre `hero`**. Sólo aparece en `front`. Por eso `front` está en
el set de capturas por defecto.

---

## Presupuestos actuales

Medidos, no declarados — `npm run shot` los imprime y `npm run inspect` los
verifica contra umbral.

| magnitud | actual | techo |
|---|---|---|
| triángulos del personaje | 8 246 | 20 000 |
| huesos | 31 | 48 |
| grupos de material (= draw calls del personaje) | 5 | 8 |
| draw calls de la escena | 8 | 40 |
| build del personaje | ~1.1 s | 2 s |
| programas de shader | 13 | 25 |

---

## Listón de calidad

Los no negociables, heredados de la referencia y adaptados:

- **Ninguna superficie plana.** Todo material necesita variación de albedo,
  mapa de normal, variación de rugosidad y una capa de detalle visible a 0,5 m.
- **Ninguna iluminación uniforme.** Clave, relleno y contraluz separados, más
  sombra de contacto real.
- **Valores físicamente plausibles.** Albedo lineal en 0,02–0,9; los metales son
  0 o 1; la imagen se ajusta con exposición, no con multiplicadores de color.
  El plumaje real vive en 0,03–0,11: si se ve negro plano, sube la exposición,
  no el albedo.
- **Nada perfectamente recto, limpio ni repetido.** Desgaste en los bordes,
  suciedad en los recovecos, alabeo sutil, rotación y escala variadas.
- **La silueta manda.** Si el personaje no es reconocible en negro a 40 m, está
  mal proporcionado; ninguna cantidad de textura lo arregla.
