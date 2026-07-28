#!/usr/bin/env node
/**
 * Harness de captura.
 *
 * Levanta el prototipo, fija semilla + estado + encuadre por los hooks de
 * prueba, pausa el reloj y guarda un PNG. Reproducible: la misma invocación da
 * el mismo píxel, que es la única razón por la que una baseline visual sirve
 * para algo.
 *
 *   node scripts/capture.mjs                          # el set completo
 *   node scripts/capture.mjs --state threat --framing profile
 *   node scripts/capture.mjs --out shots/ --width 1280 --height 720
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const WIDTH = Number(args.width ?? 1280);
const HEIGHT = Number(args.height ?? 800);
const OUT = resolve(args.out ?? 'shots');
const PORT = Number(args.port ?? 5177);
const SEED = Number(args.seed ?? 1234);
/** Frames a bombear antes de capturar: deja asentar el crossfade y la fase. */
const WARM = Number(args.warm ?? 30);

/** El set por defecto: cada fila es una lectura distinta del personaje. */
const SCENE = args.scene ?? 'figure';

const FIGURE_SET = [
  { state: 'casual', framing: 'retrato' },
  { state: 'casual', framing: 'busto' },
  { state: 'casual', framing: 'perfilFigura' },
  { state: 'casual', framing: 'tresCuartos' },
  { state: 'casual', framing: 'entera' },
  { state: 'dress', framing: 'entera' },
  { state: 'dress', framing: 'espalda' },
];

const BUITRE_SET = [
  { state: 'perch', framing: 'hero' },
  { state: 'perch', framing: 'profile' },
  { state: 'perch', framing: 'front' },
  { state: 'alert', framing: 'portrait' },
  { state: 'stalk', framing: 'hero' },
  { state: 'feed', framing: 'profile' },
  { state: 'threat', framing: 'hero' },
  { state: 'threat', framing: 'front' },
];

const DEFAULT_SET = SCENE === 'buitre' ? BUITRE_SET : FIGURE_SET;

const server = await startServer(PORT);
let browser;
try {
  browser = await chromium.launch({
    // SwiftShader: WebGL2 por software. Más lento, pero es la única forma de que
    // una captura dé el mismo píxel en un portátil y en CI sin GPU.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/?capture&deterministic&seed=${SEED}&q=high&scene=${SCENE}`, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__BUITRE__', null, { timeout: 30000 });

  await mkdir(OUT, { recursive: true });
  const set = args.state || args.framing
    ? [{
        state: args.state ?? 'perch',
        framing: args.framing ?? 'hero',
        ...(args.spread !== undefined ? { spread: Number(args.spread) } : {}),
      }]
    : DEFAULT_SET;

  const written = [];
  for (const shot of set) {
    await page.evaluate(({ state, framing, seed, spread }) => {
      const h = window.__BUITRE__.hooks;
      h.seed(seed);
      h.hideDebugUi(true);
      h.setPaused(false);
      h.setState(state);
      h.setFraming(framing);
      // Mirada fija y explícita: si se deja al director, el objetivo depende de
      // dónde estaba el puntero y la captura deja de ser reproducible.
      h.setLook([0, 1.55, 6]);
      if (spread !== undefined) h.setSpread(spread);
    }, { ...shot, seed: SEED });

    // Bombear frames a mano: `setPaused` congela el reloj, pero antes hay que
    // dejar que la fase y el IK lleguen a su sitio.
    for (let i = 0; i < WARM; i++) await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => window.__BUITRE__.hooks.setPaused(true));
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const name = `${shot.state}-${shot.framing}.png`;
    const buf = await page.locator('#stage').screenshot();
    await writeFile(join(OUT, name), buf);
    written.push(name);
    process.stdout.write(`  ${name}\n`);
  }

  const stats = await page.evaluate(() => window.__BUITRE__.hooks.stats());
  console.log('\nmétricas medidas:');
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(16)} ${v}`);

  if (errors.length) {
    console.error('\nerrores de página:');
    for (const e of errors) console.error(`  ${e}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${written.length} capturas en ${OUT} · consola limpia`);
  }
} finally {
  await browser?.close();
  server.kill();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

async function startServer(port) {
  // Se invoca el binario de vite directamente, no `npx`: matar el shim de npx
  // deja el servidor huérfano ocupando el puerto y la siguiente captura falla.
  const bin = resolve('node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [bin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Sin HMR: un guardado a mitad de captura recarga la página y Playwright
    // muere con "Execution context was destroyed".
    env: { ...process.env, BUITRE_NO_HMR: '1' },
  });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('vite no arrancó en 30 s')), 30000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('ready in') || String(d).includes('Local:')) {
        clearTimeout(timer);
        setTimeout(res, 300);
      }
    });
    child.on('exit', (code) => rej(new Error(`vite salió con ${code}`)));
  });
  return child;
}
