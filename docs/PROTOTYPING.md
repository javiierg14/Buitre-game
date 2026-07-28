# Cómo se trabaja este prototipo

Método destilado de dos referencias, y de lo que costó levantar el primer
personaje de este repo. No es teoría: cada regla de aquí corresponde a un fallo
concreto que se cometió y se arregló en el primer día.

---

## El principio: evidencia, no afirmaciones

Un prototipo 3D miente con facilidad. El código compila, la consola está limpia,
y el personaje está en negro absoluto fuera de cámara. La única defensa es
**medir**, y medir automáticamente.

Nada se declara terminado sin:

```bash
npm run typecheck            # el proyecto compila
npm run build                # el bundle de producción sale
npm run shot                 # el set de capturas se produce sin errores de página
npm run inspect              # las métricas medidas pasan sus umbrales
npm run inspect -- --mobile  # y también en viewport móvil
```

`npm run inspect` mide cinco cosas sobre el píxel real y dos sobre el
presupuesto de render. No pregunta "¿se ve bien?" — eso no lo puede responder un
script. Pregunta:

| métrica | qué atrapa |
|---|---|
| `nonBlankRatio` | canvas negro, escena vacía, cámara mirando al vacío |
| `colorEntropy` | escena plana, un solo color, texturas que no se aplicaron |
| `edgeDensity` | falta de detalle geométrico o de mapa de normal |
| `luminanceContrast` | iluminación uniforme, sin clave/relleno/contraluz |
| `subjectCoverage` | el personaje ocupa una fracción irrisoria del cuadro |
| `drawCalls` | los materiales se fragmentaron en llamadas de dibujo |
| `frameTriangles` | el presupuesto de malla se desbocó |

Los umbrales están calibrados para separar **roto de funcionando**, no bueno de
excelente. Subirlos convierte el inspector en un crítico de arte y deja de ser
fiable como puerta.

---

## Las fases

Se recorren en orden. Saltarse una se paga con intereses.

### 1. Cimiento — el contrato antes que el código

Antes de la primera línea de personaje: `ARCHITECTURE.md`, el `Registry`, el
bucle de frame, el RNG determinista y los presets de calidad.

Suena a burocracia y es lo contrario: es lo que permite que el trabajo se pueda
repartir después sin que dos cambios se pisen. El contrato de subsistema
(`static id`, `static deps`, sin imports cruzados) cuesta media hora y es lo que
hace que `stage` se pueda borrar entero sin tocar `character`.

**Puerta:** el motor arranca con un subsistema vacío y `npm run shot` produce un
PNG.

### 2. Bloqueo — silueta antes que superficie

El rig y las proporciones. Nada de texturas, nada de plumas individuales.

La pregunta de esta fase es una sola: **¿se reconoce en negro?** Se juzga con
`--framing profile` y `--framing front`, no con el `hero` bonito.

El error caro de esta fase es autorizar la pose de bind en T. La pose de bind
tiene que ser la **silueta de reposo real** — en este personaje, alas plegadas
en Z, columna encorvada, cuello en S. Modelar donde los miembros están de verdad
significa que los pesos de skin nunca tienen que sobrevivir a una rotación de
hombro de 90°, que es de donde salen casi todos los pinzamientos.

**Puerta:** silueta legible en perfil y frontal, `subjectCoverage` en umbral.

### 3. Volumen — la geometría procedural

Las piezas: torso, cuello, cabeza, alas, patas, cola. Con material plano.

Aquí se juzga masa y proporción, no detalle. Si el torso es pequeño respecto de
las patas, se arregla ahora; después de texturar, tocar proporciones invalida
todas las baselines.

**Puerta:** `edgeDensity` en umbral con materiales planos — si no llega, el
problema es geométrico y ninguna textura lo va a tapar.

### 4. Iluminación — antes que las texturas

Contraintuitivo y es la lección más cara del primer día: el primer render salió
casi negro y la reacción instintiva fue subir el albedo de las plumas. Habría
sido un error. El plumaje real vive en albedo lineal 0,03–0,11; a exposición
neutra eso ES negro. La corrección correcta era exposición 1,55, clave a 5,2,
contraluz a 3,4 y un fondo que no fuera negro.

**Una silueta oscura sobre fondo negro no tiene silueta.**

Se ilumina antes de texturar porque el juicio sobre una textura depende
enteramente de la luz que la revela.

**Puerta:** `luminanceContrast` y `nonBlankRatio` en umbral.

### 5. Superficie — materiales procedurales

Albedo + rugosidad + normal, horneados desde el mismo generador de ruido que
deforma la geometría. La normal sale de un Sobel sobre el mismo campo de altura
que se ve en el albedo: derivar ambos del mismo campo es lo que hace que el
relieve y el color coincidan.

Lección concreta: el primer plumaje era un seno de barbas sobre ruido y leía
como pana. Lo que lo convirtió en plumas fue modelar **el solape** — una rejilla
a tresbolillo de plumas de contorno donde el escalón entre una pluma y la
siguiente es lo que manda en el mapa de altura. Las barbas son un detalle
secundario dentro de cada pluma.

**Puerta:** `colorEntropy` y `edgeDensity` en umbral; sin regresión en draw
calls (una textura nueva no debe partir un grupo de material).

### 6. Movimiento — capas y límites

El árbol de mezcla: base con crossfade, aditivas encima, IK al final.

Dos lecciones del primer día, ambas de la misma familia:

- **Una capa, un dueño.** La pose `threat` y la aditiva `wingSpreadAdd` abrían
  las alas las dos a la vez. Sumaban ~100° en el húmero y las alas salían
  disparadas por encima de la cabeza. La pose de amenaza ahora sólo hace cuerpo,
  cuello y patas; la apertura la posee la aditiva.
- **Los topes por hueso controlan el reparto, no el alcance.** El IK de mirada
  tenía topes de 14/18/22/30° por hueso y aun así enroscaba el cuello 168°,
  porque corría dos pasadas. Hacía falta un segundo límite de otra naturaleza:
  un **cono** desde el frente del actor, con desvanecido entre 75° y 115°. Fuera
  del cono, el personaje tiene que girar el cuerpo — que es exactamente el coste
  que el gameplay quiere que el jugador pueda leer.

**Puerta:** las capturas de cada estado se producen sin poses rotas, y el
encuadre `front` confirma simetría.

### 7. Verificación — el set de captura

`npm run shot` produce un set fijo de encuadres y estados. Fijo es la palabra
clave: sirve para comparar el de hoy con el de la semana pasada.

---

## Reglas que se ganaron a golpes

**Autoriza en la pose de reposo, no en T-pose.** Ver fase 2.

**El encuadre `front` va en el set por defecto.** Una asimetría por signo de
espejo equivocado es invisible en tres cuartos. Sólo aparece de frente. Es el
fallo más común al autorizar poses con deltas euler.

**Los hooks de prueba tienen que ser reales.** Un hook que no hace nada produce
baselines que pasan siempre y no significan nada. Y tienen que apuntar al dueño
correcto del estado: `setSpread` llama al `director`, no al `character`, porque
el director reescribe la apertura cada frame desde su rampa y se comería un
valor puesto a mano.

**Fija la mirada explícitamente en captura.** Si se deja al director, el objetivo
depende de dónde estaba el puntero, y el puntero sin inicializar apunta al
propio personaje: el cuello se enrosca y la captura no es reproducible.

**Mata el servidor por su binario, no por `npx`.** Matar el shim de `npx` deja
vite huérfano ocupando el puerto y la siguiente captura falla con un error que
no se parece en nada a la causa.

**Un preset es un presupuesto.** Las texturas se hornean en JS puro; 1024² × 4
mapas costaba ~4 s de arranque. A la densidad de tile del personaje
(0,12–0,30 m), 512 da ~1,7 mm/texel, por debajo de lo que la malla puede
mostrar. El preset `high` usa 512 y el arranque cayó a ~1,1 s.

---

## Cuando algo se ve mal

En este orden. Es el orden de coste creciente y de probabilidad decreciente.

1. **¿La cámara está donde crees?** `--framing profile` y `--framing front`.
2. **¿Es la luz?** Sube exposición antes de tocar albedo. Siempre.
3. **¿Es la silueta?** Míralo pequeño. Si no se reconoce a 40 m, es proporción.
4. **¿Es un signo de espejo?** Encuadre `front`, capa por capa.
5. **¿Es el skinning?** Aísla poniendo la pose de bind y compara.
6. **¿Es la textura?** Lo último. Casi nunca es la textura.

---

## Lo que falta y por qué está anotado aquí

Un prototipo honesto lleva su lista de deudas escrita, no escondida:

- **IK de apoyo (foot IK), a medias.** Hay anclaje de pelvis: el animador mide
  el dedo más bajo y sube la cadera lo justo para que no atraviese el plano
  (sólo sube, nunca baja, para no matar el rebote de `lope`). Falta lo otro
  dos tercios: sonda de suelo por pie, solución de dos huesos por pata y planta
  alineada a la normal. Sin eso el personaje no puede pisar terreno irregular.
- **Abanico de rémiges.** Con el ala abierta las primarias siguen apiladas en
  un plano y leen como una hoja, no como un abanico. La solución dentro de esta
  arquitectura son 2–3 huesos de abanico bajo `Hand` que las separen; es un
  cambio de rig y de bind, no un parche de textura.
- **LOD.** Un solo nivel de detalle. `q.limbSegments` y `q.featherCount` ya
  parametrizan la densidad, así que el LOD es construir dos variantes y
  cambiarlas por distancia — el andamiaje está, falta el conmutador.
- **Baselines de regresión visual.** El set de captura es reproducible pero
  todavía no hay comparación contra una baseline guardada.
- **Audio.** Fuera de alcance en esta iteración.
