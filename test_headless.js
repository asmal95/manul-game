// Headless-тест смерти в пропасти. Запуск из папки проекта: node test_headless.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const { performance } = require('perf_hooks');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

function elStub() { return { textContent: '', style: {}, addEventListener(){} }; }
const ctxStub = new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop(){} });
  if (p === 'canvas') return {};
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
(async () => {
  let t = 1000;
  await new Promise(r => setTimeout(r, 50)); // дать boot() загрузить "картинки"
  t = await frames(5, t);
  const g = (expr) => vm.runInContext(expr, sandbox);
  console.log('lives на старте:', g('lives'));
  // 1) стоим на обычной земле 2 сек — должны жить
  t = await frames(120, t);
  console.log('lives после стояния на земле:', g('lives'), '(ждём 3)');
  // 2) телепорт над пропастью БЕЗ моста (колонки 45-46, там только гриб)
  vm.runInContext('player.x = 45*16; player.y = 150; player.vx = 0; player.vy = 0;', sandbox);
  let guard = 0;
  while (g('lives') === 3 && guard++ < 600) t = await frames(10, t);
  console.log('lives после падения в яму:', g('lives'), '(ждём 2), кадров:', guard * 10);
  console.log('y игрока:', g('player.y'), 'dying:', g('dying'));
  // 3) ждём респаун
  t = await frames(120, t);
  console.log('после респауна: lives =', g('lives'), 'x =', g('player.x'), 'y =', g('player.y'));
  // 4) переход на 2 уровень: все грибы + касание выхода
  // (встаём НА землю у выхода: y=EXIT.y-8, иначе телепорт внутрь стены)
  vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
  guard = 0;
  while (g('levelIdx') === 0 && guard++ < 100) t = await frames(10, t);
  console.log('levelIdx:', g('levelIdx'), '(ждём 1), EXIT:', JSON.stringify(g('EXIT')), 'lives:', g('lives'), '(жизни сохранены)');
  // 5) финал 2 уровня
  vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
  guard = 0;
  while (!g('won') && guard++ < 100) t = await frames(10, t);
  console.log('won:', g('won'), '(ждём true)');
  if (g('lives') === 2 && g('levelIdx') === 1 && g('won') === true) console.log('TEST PASS: смерть, переход и финал работают');
  else { console.log('TEST FAIL'); process.exit(1); }
})();
