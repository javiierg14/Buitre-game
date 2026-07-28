#!/usr/bin/env node
/**
 * Inspector de canvas — la puerta de QA.
 *
 * No pregunta "¿se ve bien?", que es irrespondible por un script. Mide cuatro
 * cosas que sí se pueden medir y que atrapan los fallos reales de un prototipo
 * 3D: canvas en negro, escena plana sin detalle, silueta que no se separa del
 * fondo, y presupuesto de render desbocado.
 *
 * Cada métrica trae un umbral y un veredicto. Un fallo devuelve código 1, así
 * que esto se puede colgar de CI tal cual.
 *
 *   node scripts/inspect-canvas.mjs
 *   node scripts/inspect-canvas.mjs --state threat --framing front --mobile
 */

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { PNG } from 'pngjs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 5178);
const STATE = args.state ?? 'perch';
const FRAMING = args.framing ?? 'hero';
const MOBILE = Boolean(args.mobile);

/**
 * Umbrales. Salen de lo que separa una escena real de una rota, no de un ideal
 * estético: subirlos convierte el inspector en un crítico de arte, y entonces
 * deja de ser fiable como puerta.
 */
const THRESHOLDS = {
  nonBlankRatio: 0.35,     // fracción de píxeles que no son el color de fondo
  colorEntropy: 3.2,       // bits sobre el histograma de luminancia
  edgeDensity: 0.015,      // fracción de píxeles con gradiente fuerte
  luminanceContrast: 0.28, // p95 - p05 de luminancia
  subjectCoverage: 0.02,   // fracción del cuadro que ocupa el personaje
  maxDrawCalls: 40,
  maxFrameTriangles: 400000,
};

const server = await startServer(PORT);
let browser;
try {
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const context = await browser.newContext(
    MOBILE ? devices['Pixel 7'] : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  );
  const page = await context.newPage();

  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });

  await page.goto(`http://127.0.0.1:${PORT}/?capture&deterministic&seed=1234`, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__BUITRE__', null, { timeout: 30000 });
  await page.evaluate(({ state, framing }) => {
    const h = window.__BUITRE__.hooks;
    h.seed(1234);
    h.hideDebugUi(true);
    h.setState(state);
    h.setFraming(framing);
    h.setLook([0, 1.55, 6]);
  }, { state: STATE, framing: FRAMING });
  for (let i = 0; i < 30; i++) await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => window.__BUITRE__.hooks.setPaused(true));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const stats = await page.evaluate(() => window.__BUITRE__.hooks.stats());
  const buf = await page.locator('#stage').screenshot();
  const png = PNG.sync.read(buf);
  const m = measure(png);

  const rows = [
    ['nonBlankRatio', m.nonBlankRatio, THRESHOLDS.nonBlankRatio, '>='],
    ['colorEntropy', m.colorEntropy, THRESHOLDS.colorEntropy, '>='],
    ['edgeDensity', m.edgeDensity, THRESHOLDS.edgeDensity, '>='],
    ['luminanceContrast', m.luminanceContrast, THRESHOLDS.luminanceContrast, '>='],
    ['subjectCoverage', m.subjectCoverage, THRESHOLDS.subjectCoverage, '>='],
    ['drawCalls', stats.drawCalls, THRESHOLDS.maxDrawCalls, '<='],
    ['frameTriangles', stats.frameTriangles, THRESHOLDS.maxFrameTriangles, '<='],
  ];

  const label = `${STATE}/${FRAMING}${MOBILE ? '/mobile' : ''}`;
  console.log(`\ninspector · ${label} · ${png.width}x${png.height}\n`);
  let failed = 0;
  for (const [name, value, limit, op] of rows) {
    const ok = op === '>=' ? value >= limit : value <= limit;
    if (!ok) failed++;
    const v = typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(4) : value;
    console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name.padEnd(20)} ${String(v).padStart(10)}  ${op} ${limit}`);
  }

  console.log('\n  contexto:');
  for (const [k, v] of Object.entries(stats)) console.log(`    ${k.padEnd(18)} ${v}`);

  if (problems.length) {
    console.error('\n  errores de página:');
    for (const p of problems) console.error(`    ${p}`);
  }

  if (failed || problems.length) {
    console.error(`\n${failed} métrica(s) fuera de umbral, ${problems.length} error(es) de página\n`);
    process.exitCode = 1;
  } else {
    console.log('\ntodas las métricas dentro de umbral, consola limpia\n');
  }
} finally {
  await browser?.close();
  server.kill();
}

/* ------------------------------------------------------------------ */

function measure(png) {
  const { width: w, height: h, data } = png;
  const n = w * h;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(64);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l;
    hist[Math.min(63, (l * 64) | 0)]++;
  }

  // El fondo es el color modal de la fila superior: en este plató es el cielo,
  // y usar el modo en vez de "negro puro" hace que la métrica siga sirviendo
  // cuando alguien cambie el fondo.
  const topHist = new Map();
  for (let x = 0; x < w; x++) {
    const i = x * 4;
    const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
    topHist.set(key, (topHist.get(key) ?? 0) + 1);
  }
  const bg = [...topHist.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);

  let nonBlank = 0;
  let subject = 0;
  for (let i = 0; i < n; i++) {
    const dr = (data[i * 4] >> 3) - bg[0];
    const dg = (data[i * 4 + 1] >> 3) - bg[1];
    const db = (data[i * 4 + 2] >> 3) - bg[2];
    const d = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
    if (d > 2) nonBlank++;
    // El sujeto es lo notablemente más oscuro que su entorno: el buitre es
    // negro sobre un plató claro, así que esto lo aísla sin segmentación.
    if (lum[i] < 0.10) subject++;
  }

  // Entropía de Shannon sobre el histograma de luminancia.
  let entropy = 0;
  for (const c of hist) {
    if (!c) continue;
    const p = c / n;
    entropy -= p * Math.log2(p);
  }

  // Densidad de bordes: Sobel simplificado sobre la luminancia.
  let edges = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + w] - lum[i - w];
      if (Math.hypot(gx, gy) > 0.06) edges++;
    }
  }

  const sorted = Float32Array.from(lum).sort();
  const p05 = sorted[(n * 0.05) | 0];
  const p95 = sorted[(n * 0.95) | 0];

  return {
    nonBlankRatio: nonBlank / n,
    subjectCoverage: subject / n,
    colorEntropy: entropy,
    edgeDensity: edges / n,
    luminanceContrast: p95 - p05,
  };
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
  const bin = resolve('node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [bin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
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
