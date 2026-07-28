# Pipeline de personaje

Cómo se pasa de una tabla de números a un personaje animado, y dónde tocar cada
cosa. Todo ocurre en `src/character/`.

```
rig.ts     tabla de huesos, pose de bind, esqueleto por instancia
   ↓
geo.ts     toolkit: tube · ellipsoid · revolve · blade + ruido determinista
   ↓
parts.ts   piezas en espacio de bind, cada una declara su material y sus huesos
   ↓
build.ts   agrupa por material, calcula pesos de skin, emite la BufferGeometry
   ↓
materials.ts  hornea albedo + rugosidad + normal desde el mismo ruido
   ↓
clips.ts   poses como deltas euler locales en grados
   ↓
animator.ts  mezcla por capas + IK de mirada
   ↓
index.ts   el subsistema: API pública estrecha
```

---

## 1. `rig.ts` — la tabla de huesos

31 huesos declarados como `[nombre, padre, posición, pistaUp?, dirHoja?]` en
metros, espacio de bind: pies en `y = 0`, mirando a +Z, derecha del personaje en
X negativa.

El `Rig` deriva de esa tabla: rotaciones de mundo con **+Y a lo largo del
hueso**, transformadas locales, y `tail[]` (el extremo de cada hueso, su hijo
primario o un muñón de 7 cm si es hoja).

`BRANCH = /^(Clavicle|UpLeg|Tail)/` marca los hijos que cuelgan de una
bifurcación pero **no** continúan la cadena principal. Sin eso, `Hips` apuntaría
al promedio de columna, piernas y cola, y toda la pelvis nacería torcida.

**Tocar aquí cuando:** cambian proporciones, hace falta un hueso nuevo (abanico
de plumas, mandíbula, dedos articulados).

**Coste de tocar aquí:** invalida los pesos de skin y todas las baselines.
Hazlo en la fase de bloqueo, no después.

### Por qué la bind pose no es una T

Es la silueta de reposo real: alas plegadas en Z, columna encorvada, cuello en
S, patas digitígradas cargadas. La geometría se modela donde los miembros están
de verdad, así los pesos nunca tienen que sobrevivir a una rotación de hombro de
90°. Autorizar el ala abierta y cerrarla con animación es lo que produce el
pinzamiento clásico del codo.

---

## 2. `geo.ts` — el toolkit

Cuatro primitivas cubren el personaje entero:

| primitiva | para qué | notas |
|---|---|---|
| `tube(path, radius, opts)` | miembros, cuello, pico, dedos, tarsos | marcos de transporte paralelo: el anillo no gira sobre sí mismo en una curva |
| `ellipsoid(rx, ry, rz)` | cráneo, masas | |
| `revolve(profile, segments)` | piezas de revolución | |
| `blade(path, halfWidth, opts)` | plumas, membranas, correas | lámina sin grosor, se dibuja `DoubleSide` |

`radius(t, a)` recibe el parámetro del recorrido y el ángulo del anillo, así que
la misma llamada hace un miembro cónico, una sección ovalada o una cresta. El
helper `ellipseR(rx, rz, a)` de `parts.ts` da secciones elípticas.

**Convención UV:** `u`,`v` se guardan en **metros de superficie** (u alrededor
del anillo, v a lo largo del recorrido). `build.ts` divide por el tamaño de tile
del material al escribir el atributo, así la misma densidad física de texel vale
en una garra, en un antebrazo y en una pluma sin ajuste por pieza.

**Trampa con `blade`:** el ancho sale de `cross(tangente, up)`. Para una pluma
de ala plegada, que cuelga en un plano vertical, hay que pasarle el eje
**lateral** como `up`, no el vertical. Se lee raro y es correcto.

---

## 3. `parts.ts` — las piezas

Cada función devuelve `{ mesh, material, bind }`:

- `mesh` — `MeshData` en espacio de bind.
- `material` — uno de `feather` | `down` | `skin` | `horn` | `eye`.
- `bind` — los huesos **candidatos** para el peso de skin.

`bind` es lo importante. La restricción evita que la gola acabe pesada al ala,
que pasa justo por al lado. Un `bind` de un solo hueso da una pieza rígida
(garras, ojos).

Las piezas actuales: `torso`, `keel`, `neck`, `ruff`, `head` (cráneo + pico +
cera + ojos), `wingArm`, `wingFeathers` (primarias + secundarias), `leg`
(pantalón + tarso + dedos + garras), `tail`.

---

## 4. `build.ts` — skinning y agrupación

Agrupa por material para que cada uno sea **un grupo contiguo = una draw call**.
El orden es `MATERIAL_ORDER` y es fijo: el índice de material de un grupo no
puede bailar entre builds o las baselines se invalidan sin motivo.

**Pesos:** distancia inversa a los segmentos de hueso candidatos, top 3,
normalizada. La potencia es 4 y es deliberada — con 2 la piel se vuelve gomosa y
un vértice del pecho sigue notando la mano; con 8 el reparto es casi rígido y
aparece la grieta clásica en el codo.

**Instancias:** `createInstance()` comparte la geometría y da esqueleto propio.
Veinte buitres cuestan veinte esqueletos, no veinte mallas. `frustumCulled` va a
`false` porque el culling usa la bounding sphere de la pose de bind y con las
alas abiertas el personaje se sale de ella y parpadea en los bordes.

---

## 5. `materials.ts` — el horneado

Cada conjunto entrega albedo + rugosidad + normal. La normal sale de un Sobel
sobre el mismo campo de altura que alimenta el albedo.

Un stream de ruido por material (`mk(salt)`): cambiar el detalle de uno no
desplaza el grano de los demás, así una baseline sólo se mueve donde tocaste.

**Presupuesto de albedo** (lineal, antes del tone mapping):

| conjunto | rango | nota |
|---|---|---|
| `feather` | 0,030–0,058 base, hasta ~0,10 con desgaste | plumaje real; se ajusta con exposición, nunca subiendo esto |
| `down` | 0,18–0,56 | crema sucio de la gola |
| `skin` | 0,09–0,19 | cabeza calva; por encima lee como casco blanco plano |
| `horn` | 0,16–0,42 | queratina de pico, tarso y garras |

El plumaje se modela por **solape**: rejilla a tresbolillo de 6×5 plumas por
tile de 0,30 m (~5×6 cm por pluma, el tamaño real de una pluma de manto), con
el retículo deformado por ruido para que no se vea como rejilla. El escalón
entre plumas es lo que manda en el mapa de altura; las barbas son detalle
secundario dentro de cada una.

---

## 6. `clips.ts` — las poses

Deltas **euler locales en grados** sobre la bind pose:

```
x  flexión   — positivo dobla el hueso hacia adelante
y  torsión   — giro sobre el eje del propio hueso
z  lateral   — positivo inclina hacia la derecha del personaje
```

Esto hace que un ciclo de marcha se lea como anatomía y no como sopa de
cuaterniones, y permite mezclar capas con un lerp de los arrays de deltas.

**La regla de espejo** (ver `ARCHITECTURE.md`): x igual, y/z opuestos. Un par
que no la siga da un personaje asimétrico invisible en tres cuartos.

Bases: `perch`, `alert`, `stalk`, `lope`, `threat`, `feed`.
Aditivas: `wingSpreadAdd`, `ruffleAdd`, `hitAdd`.

**Una capa, un dueño.** Si una base y una aditiva tocan los mismos huesos con la
misma intención, se suman y se disparan. `threat` no abre las alas: eso lo posee
`wingSpreadAdd`, que el director rampa a 1 al entrar en amenaza.

**La estabilización de cabeza** en `gait()` es el detalle que vende al animal: el
cuello deshace el balanceo del torso y la cabeza se queda casi fija en el
espacio. Sin ella el personaje camina como un humano disfrazado.

---

## 7. `animator.ts` — el runtime

Tres capas en orden:

1. **Base** con crossfade. La fase de locomoción la manda la velocidad real de
   suelo dividida por la zancada (`STRIDE`), así los pies no patinan. Las bases
   estáticas avanzan con el reloj a su propio ritmo, para que dos personajes no
   respiren sincronizados.
2. **Aditivas** encima del resultado mezclado.
3. **IK** después de escribir los huesos.

**IK de mirada:** CCD sobre `Neck → Neck1 → Neck2 → Head`, apuntando el eje del
hueso `Head` (que va hacia `Beak`) al objetivo. Dos límites de naturaleza
distinta, y hacen falta los dos:

- **Topes por hueso** (14/18/22/30°) — controlan el **reparto**.
- **Cono** desde el frente del actor, pleno hasta 75°, desvanecido hasta 115° —
  controla el **alcance**. Sin él, dos pasadas de CCD enroscaban el cuello 168°.

Todo está preasignado. `update()` no reserva memoria.

**Anclaje de pelvis (`solveGround`):** mide el dedo más bajo y sube la cadera lo
justo para que no atraviese el plano. **Sólo sube, nunca baja** — si bajara
también, mataría el rebote de `lope`, donde el personaje sí despega. Es la mitad
barata del IK de apoyo y elimina la clase de fallo más tonta: poses de agachado
autorizadas a ojo que hunden las garras bajo el suelo.

Lo que **falta** del IK de apoyo: sonda de suelo por pie, solución de dos huesos
por pata y planta alineada a la normal del terreno. Hasta que exista, el
personaje sólo puede pisar un plano horizontal.

---

## 8. `index.ts` — la API pública

Deliberadamente estrecha. Todo lo que el resto del programa puede hacerle al
personaje:

```ts
setState(name, blendSeconds)   // base con crossfade
setSpeed(mps)                  // velocidad de suelo -> fase de locomoción
setSpread(0..1)                // apertura de alas aditiva
lookAt(point | null, weight)   // objetivo de mirada en mundo
ruffle()                       // sacudida de plumas
hit(region, side)              // reacción a impacto
headWorld(out)                 // posición de la cabeza, para cámaras y audio
```

Si necesitas algo que no está aquí, añádelo aquí — no alcances los huesos desde
fuera. El día que el rig cambie, esta lista es lo único que hay que mantener
compatible.

---

## Añadir una pieza nueva

1. Escribe la función en `parts.ts`, devolviendo `{ mesh, material, bind }`.
2. Añádela a la lista de `parts` en `CharacterSystem.init()`.
3. Si necesita un material nuevo: añádelo a `MaterialName`, a `TILE`, a
   `MATERIAL_ORDER` (**al final**, para no desplazar los índices existentes),
   a `ROUGH_SCALE` y a `createMaterials()`.
4. `npm run shot` y compara. Vigila `drawCalls` — un material nuevo es una draw
   call nueva.

## Añadir un estado nuevo

1. Escribe la función en `clips.ts` y añádela a `CLIPS`.
2. Añade su velocidad a `SPEED` y su ritmo a `IDLE_RATE`.
3. Mapea una tecla en `KEY_TO_STATE` (`src/dev/director.ts`).
4. Añádelo al set por defecto de `scripts/capture.mjs` si es un estado que hay
   que vigilar.
5. Captura en `front` **y** en `profile` antes de darlo por bueno.
