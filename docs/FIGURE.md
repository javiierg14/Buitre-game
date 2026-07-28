# Figura femenina — estado del prototipo

Escena `?scene=figure` (por defecto). Personaje femenino semirrealista generado
por código, sobre plató de estudio, a partir de un juego de referencias
fotográficas: pelirroja de melena larga ondulada, piel muy clara con pecas
marcadas, ojos azul verdoso, complexión delgada.

## Cómo verlo

```bash
npm install
npm run dev            # http://127.0.0.1:5173/
npm run shot           # renderiza el set a shots/ (lento sin GPU)
```

Parámetros de URL: `?scene=figure|buitre`, `?outfit=casual|dress`,
`?framing=retrato|busto|perfilFigura|tresCuartos|entera|espalda`, `?q=low|medium|high`.

## Cómo está construido

| Pieza | Técnica | Por qué |
|---|---|---|
| `sculpt.ts` | Brochas de caída gaussiana sobre malla + relajación laplaciana | Modelar una cara escribiendo coordenadas de vértices es inviable; empujar un elipsoide con brochas de influencia local es lo mismo que hace un escultor |
| `head.ts` | Warps globales (óvalo, mentón, nuca, plano facial) + ~30 brochas | El orden importa: los rasgos se esculpen sobre una silueta ya correcta |
| `eyes.ts` | Globo + iris con fibras radiales y anillo limbal + córnea con clearcoat + párpados/pestañas/cejas | Es la inversión con mejor retorno de todo el personaje |
| `hair.ts` | Mechones tubulares agrupados en *locks*, envolvente de volumen por altura, onda por mechón, ventana angular en la cara | Es el rasgo que identifica al personaje; con planos texturizados la silueta ondulada no sale |
| `skin.ts` | Texturas procedurales seamless, pecas en dos poblaciones (muchas tenues + pocas marcadas) | Las pecas son rasgo de identidad, no adorno |
| `body.ts` | Loft de secciones con superelipse + brochas | Las cápsulas pegadas fallan justo en la silueta de perfil |
| `clothing.ts` | El perfil del tronco desplazado hacia fuera | La prenda no puede atravesar el cuerpo si comparte su forma |
| `studio/` | Ciclorama, IBL de estudio, softboxes `RectAreaLight` | Las referencias son fotografía de estudio; con luces puntuales no sale esa caída |

Todo es determinista: la misma semilla da la misma figura, que es la condición
para que una captura de referencia signifique algo.

## Estado honesto

**Funciona**: la iluminación de estudio, el ciclorama, el volumen y color de la
melena, la silueta del cuerpo, las proporciones, las pecas y los materiales de
tela. De medio cuerpo para abajo el personaje se lee.

**No funciona todavía — la cara.** En primer plano sigue siendo una máscara
plana: la nariz apenas se insinúa, la boca no se lee y los ojos, pese a los
párpados y el iris con fibras, quedan como dos puntos. Las brochas mueven 1-2 cm
sobre una cabeza de 20 cm y el resultado se acerca más a un maniquí que a un
rostro.

Defectos concretos pendientes:

- Algunos mechones cruzan el rostro en diagonal pese a la ventana angular.
- El casquete del cuero cabelludo asoma como una banda en la coronilla.
- La camiseta de tirantes lee como vestido tubo; le falta caída y el hombro.
- Falta oclusión ambiental real; la pintada por color de vértice no basta en
  primer plano.

## Diagnóstico

Una cara humana es el peor caso posible para geometría procedural: cualquiera
detecta un rostro mal resuelto en una décima de segundo, y el margen de error
útil es de milímetros. El resto del personaje —cuerpo, pelo, ropa, luz— sí
tolera el método y de hecho sale razonable.

El camino realista para la cara no es seguir subiendo brochas, sino modelarla en
Blender y traerla por glTF, dejando en código lo que el código hace bien: pelo
por mechones, variación de material, iluminación y encuadres. Esa división
—assets modelados + runtime procedural— es la que usa la industria y la que
sacaría este prototipo del valle inquietante.

## Coste

Sin GPU, cada set completo de capturas tarda ~8 minutos en SwiftShader. El bucle
de iteración visual es el verdadero cuello de botella del método, no el
rendimiento en tiempo real.
