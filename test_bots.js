// Боты проходимости геометрии. Запуск из папки проекта: node test_bots.js
// Проверяет то, что test_headless.js не покрывает: лесенки, взлёты из шахт, посадки.
// Связки собраны из проверенных конфигураций (ступени строго без перекрытий,
// см. AGENTS.md §6 и §9). Падение бота = править УРОВЕНЬ, а не бота.
// Правила телепортов (выстраданы, см. AGENTS.md §9):
// - телепорт ТОЛЬКО на поверхности (y=168 земля, y=150 мост, y=120/88/56 платформы),
//   никогда внутрь солида (иначе X-снап вышвырнет) и не впритык над землёй;
// - разбег до runToX БЕЗ прыжков, прыжок только с нужной точки;
// - Space держать всегда (иначе variable jump срежет прыжок до ~10px);
// - taken = total ставить только у выходов (иначе случайный переход ломает пробу).
const fs = require('fs'), vm = require('vm'), path = require('path');
const { performance } = require('perf_hooks');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

function elStub() { return { textContent: '', style: {}, addEventListener(){} }; }
const ctxStub = new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop(){} });
  return () => {};
}, set: () => true });
const canvasStub = { getContext: () => ctxStub, width: 480, height: 270 };
let rafCb = null;
const elements = {};
function getEl(id) {
  if (id === 'game') return canvasStub;
  if (!elements[id]) elements[id] = elStub();
  return elements[id];
}
function ImageStub() {}
Object.defineProperty(ImageStub.prototype, 'src', { set(v) { setTimeout(() => this.onload && this.onload(), 0); } });

const sandbox = {
  console, performance,
  window: {},
  document: { getElementById: getEl },
  addEventListener: () => {},
  requestAnimationFrame: (cb) => { rafCb = cb; },
  Image: ImageStub,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

async function frames(n, t0) {
  let t = t0;
  for (let i = 0; i < n; i++) { t += 16; const cb = rafCb; rafCb = null; cb(t); await new Promise(r => setTimeout(r, 0)); }
  return t;
}
const g = (expr) => vm.runInContext(expr, sandbox);
const run = (expr) => vm.runInContext(expr, sandbox);
let T = 1000;
async function setup(li) {
  run('levelIdx = ' + li + '; reset(false);');
  T = await frames(5, T);
  run('for (const f of foes) f.alive = false; taken = total;');
}
async function teleport(sx, sy) {
  run('player.x = ' + sx + '; player.y = ' + sy + '; player.vx = 0; player.vy = 0;');
  run('keys.ArrowRight = false; keys.ArrowLeft = false; keys.Space = false;');
  T = await frames(5, T);
}
let failures = 0;
function verdict(ok, name, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok ? '' : ' (' + extra + ')'));
  if (!ok) failures++;
}

// Связка: разбег до runToX, затем прыжки с направлением; ждём стоянку в зоне.
// jumpHold: сколько кадров держать Space после стейджинга (0 = всегда; для коротких хопов).
// dirHold: сколько кадров держать направление после стейджинга (0 = всегда; тапы под
// узкие цели — человек так и делает, глупый фулл-холд перелетает 16px-коробку).
async function probe(name, li, sx, sy, runToX, dir, ty, tx0, tx1, jumpHold, dirHold) {
  await setup(li);
  await teleport(sx, sy);
  const lives0 = g('lives');
  const key = dir > 0 ? 'ArrowRight' : 'ArrowLeft';
  let ok = false, why = 'таймаут', held = 0, jumped = false, steered = 0;
  for (let i = 0; i < 500; i++) {
    const x = g('player.x');
    const staged = dir > 0 ? x >= runToX : x <= runToX;
    if (!staged) run('keys.' + key + ' = true; keys.Space = false;');
    else {
      steered++;
      const hold = !jumpHold || held < jumpHold;
      const steer = !dirHold || steered < dirHold;
      run('keys.' + key + ' = ' + (steer ? 'true' : 'false') + '; keys.Space = ' + (hold ? 'true' : 'false') + '; if (player.onGround || player.coyote > 0) player.buffer = 0.12;');
      if (hold && g('player.onGround') === false) held++;
      if (!g('player.onGround')) jumped = true;
      if (jumped && g('player.onGround')) { held = 0; steered = 0; } // приземлился — новый хоп по новой
    }
    T = await frames(1, T);
    const nx = g('player.x'), ny = g('player.y');
    if (Math.abs(ny - ty) < 5 && nx > tx0 && nx < tx1 && g('player.onGround')) { ok = true; break; }
    if (g('lives') !== lives0) { why = 'умер'; break; }
  }
  if (!ok && why === 'таймаут') why = 'x=' + Math.round(g('player.x')) + ' y=' + Math.round(g('player.y'));
  verdict(ok, name, why);
}

// Взлёт: добежать до runToX без прыжков (например, сойти с моста в шахту),
// затем держать прыжок (луна из аномалии), меряем minY.
async function climb(name, li, sx, sy, runToX, dir, needY) {
  await setup(li);
  await teleport(sx, sy);
  const key = dir > 0 ? 'ArrowRight' : 'ArrowLeft';
  let minY = 1e9;
  for (let i = 0; i < 250; i++) {
    const x = g('player.x');
    const staged = dir > 0 ? x >= runToX : x <= runToX;
    if (!staged) run('keys.' + key + ' = true; keys.Space = false;');
    else run('keys.ArrowRight = false; keys.ArrowLeft = false; keys.Space = true; if (player.onGround || player.coyote > 0) player.buffer = 0.12;');
    T = await frames(1, T);
    const y = g('player.y');
    if (y < minY) minY = y;
  }
  verdict(minY < needY, name, 'minY=' + Math.round(minY));
}

// Посадка: падаем сверху, рулим к центру зоны без прыжков.
async function land(name, li, sx, ty, tx0, tx1) {
  await setup(li);
  await teleport(sx, 30);
  const lives0 = g('lives');
  const pcx = (tx0 + tx1) / 2;
  let ok = false, why = 'таймаут';
  for (let i = 0; i < 400; i++) {
    const cx = g('player.x') + 8;
    if (cx < pcx - 4) run('keys.ArrowRight = true; keys.ArrowLeft = false; keys.Space = false;');
    else if (cx > pcx + 4) run('keys.ArrowLeft = true; keys.ArrowRight = false; keys.Space = false;');
    else run('keys.ArrowRight = false; keys.ArrowLeft = false; keys.Space = false;');
    T = await frames(1, T);
    const nx = g('player.x'), ny = g('player.y');
    if (Math.abs(ny - ty) < 5 && nx > tx0 && nx < tx1 && g('player.onGround')) { ok = true; break; }
    if (g('lives') !== lives0) { why = 'умер'; break; }
  }
  if (!ok && why === 'таймаут') why = 'x=' + Math.round(g('player.x')) + ' y=' + Math.round(g('player.y'));
  verdict(ok, name, why);
}

(async () => {
  await new Promise(r => setTimeout(r, 50));
  T = await frames(5, T);
  // L4 «Мшистый овраг» (idx 3)
  await probe('L4 земля->L1', 3, 60, 166, 65, 1, 120, 90, 200);
  await probe('L4 L1->PPP', 3, 140, 118, 188, 1, 88, 235, 280);
  await probe('L4 PPP->L3', 3, 250, 86, 250, -1, 56, 100, 200);
  await probe('L4 мост2->R1', 3, 650, 150, 690, 1, 120, 730, 830);
  // L5 «Туманная чаща» (idx 4)
  await probe('L5 земля->L1', 4, 60, 166, 100, 1, 120, 120, 200);
  await climb('L5 взлёт из шахты', 4, 696, 168, 696, 1, 60);
  await land('L5 посадка на R-high', 4, 800, 56, 760, 860);
  // L6 «Сердце леса» (idx 5)
  await probe('L6 земля->L1', 5, 60, 166, 65, 1, 120, 90, 200);
  await probe('L6 L1->PPP', 5, 140, 118, 188, 1, 88, 235, 280);
  await probe('L6 PPP->L3', 5, 250, 86, 250, -1, 56, 100, 200);
  await climb('L6 взлёт с трамплина', 5, 728, 152, 728, 1, 60);
  await land('L6 посадка на R-high', 5, 810, 56, 776, 860);
  // L7 «Схрон» (idx 6): та же лесенка, что L4 + мост2->R1 + запрыг на коробку (верх y=144)
  await probe('L7 земля->L1', 6, 60, 166, 65, 1, 120, 90, 200);
  await probe('L7 L1->PPP', 6, 140, 118, 188, 1, 88, 235, 280);
  await probe('L7 PPP->L3', 6, 250, 86, 250, -1, 56, 100, 200);
  await probe('L7 мост2->R1', 6, 600, 150, 660, 1, 120, 714, 810);
  await probe('L7 запрыг на коробку', 6, 300, 168, 315, 1, 120, 376, 408);
  // L8 «Бурелом» (idx 7)
  await probe('L8 земля->L1', 7, 60, 166, 100, 1, 120, 120, 200);
  await climb('L8 взлёт с трамплина', 7, 744, 152, 744, 1, 60);
  await land('L8 посадка на R-high', 7, 810, 56, 792, 872);
  await probe('L8 запрыг на коробку', 7, 335, 168, 345, 1, 120, 408, 440);
  // L3 «Лисье логово» (idx 2): только верхнее звено (среднее бьётся головой — см. AGENTS.md §9)
  await probe('L3 PPP->L3', 2, 250, 86, 250, -1, 56, 100, 200);
  if (failures === 0) console.log('BOTS PASS: вся геометрия проходится');
  else { console.log('BOTS FAIL: ' + failures); process.exit(1); }
})();
