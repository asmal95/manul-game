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
// кадры с произвольным dt (симуляция лага; loop режет dt на 0.033)
async function framesDt(n, t0, dt) {
  let t = t0;
  for (let i = 0; i < n; i++) { t += dt; const cb = rafCb; rafCb = null; cb(t); await new Promise(r => setTimeout(r, 0)); }
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
  // 2) телепорт над пропастью БЕЗ моста (колонки 45-46, там только добыча M)
  vm.runInContext('player.x = 45*16; player.y = 150; player.vx = 0; player.vy = 0;', sandbox);
  let guard = 0;
  while (g('lives') === 3 && guard++ < 600) t = await frames(10, t);
  console.log('lives после падения в яму:', g('lives'), '(ждём 2), кадров:', guard * 10);
  console.log('y игрока:', g('player.y'), 'dying:', g('dying'));
  // 3) ждём респаун
  t = await frames(120, t);
  console.log('после респауна: lives =', g('lives'), 'x =', g('player.x'), 'y =', g('player.y'));
  // 4) переход на 2 уровень: вся добыча + касание выхода
  // (встаём НА землю у выхода: y=EXIT.y-8, иначе телепорт внутрь стены)
  vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
  guard = 0;
  while (g('levelIdx') === 0 && guard++ < 100) t = await frames(10, t);
  console.log('levelIdx:', g('levelIdx'), '(ждём 1), EXIT:', JSON.stringify(g('EXIT')), 'lives:', g('lives'), '(жизни сохранены)');
  // 5) переход на 3 уровень («Лисье логово»)
  vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
  guard = 0;
  while (g('levelIdx') === 1 && guard++ < 100) t = await frames(10, t);
  console.log('levelIdx:', g('levelIdx'), '(ждём 2), лис на уровне:', g('foes.length'), '(ждём 3)');
  // 6) кривой стамп: сдвиг вбок +8px и лагодрыг 40мс (вонзание ~15px за кадр).
  // Со старым порогом penetration<12 такой прыжок убивал игрока, теперь — лису.
  vm.runInContext('player.x = foes[0].x + 8; player.y = foes[0].y - 25; player.vx = 0; player.vy = 400;', sandbox);
  t = await framesDt(3, t, 40);
  console.log('лиса0 alive:', g('foes[0].alive'), '(ждём false), lives:', g('lives'), '(ждём 2)');
  // 7) касание сбоку 2-й лисы — смерть, минус жизнь, респаун
  vm.runInContext('player.x = foes[1].x + 2; player.y = foes[1].y + 2; player.vx = 0; player.vy = 0;', sandbox);
  guard = 0;
  while (g('lives') === 2 && guard++ < 100) t = await frames(5, t);
  console.log('lives после касания лисы:', g('lives'), '(ждём 1)');
  t = await frames(120, t); // ждём респаун
  console.log('после респауна: lives =', g('lives'), 'x =', g('player.x'), 'лиса0 всё ещё мертва:', g('foes[0].alive') === false);
  // 8) переходы до 7 уровня («Схрон», idx 6)
  while (g('levelIdx') < 6) {
    vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
    guard = 0;
    const li = g('levelIdx');
    while (g('levelIdx') === li && guard++ < 100) t = await frames(10, t);
  }
  console.log('levelIdx:', g('levelIdx'), '(ждём 6)');
  // 9) коробочка: прыжок стоя на ней -> used, дроп падает и подбирается (+1 к taken)
  console.log('коробок:', g('boxes.length'), '(ждём 3), total:', g('total'), '(ждём 10)');
  vm.runInContext('player.x = boxes[0].x; player.y = boxes[0].y - 24; player.vx = 0; player.vy = 0;', sandbox);
  t = await frames(10, t); // приземлиться на коробку
  vm.runInContext('player.buffer = 0.12;', sandbox);
  guard = 0;
  while (!g('boxes[0].used') && guard++ < 50) t = await frames(5, t);
  console.log('box0 used:', g('boxes[0].used'), '(ждём true), дропов:', g('drops.length'), '(ждём 1)');
  t = await frames(30, t); // дроп падает на землю
  const takenBefore = g('taken');
  vm.runInContext('player.x = drops[0].x; player.y = drops[0].y - 10; player.vx = 0; player.vy = 20;', sandbox);
  guard = 0;
  while (g('taken') === takenBefore && guard++ < 50) t = await frames(5, t);
  console.log('taken:', g('taken'), '(ждём ' + (takenBefore + 1) + ')');
  // 10) переход на 8 уровень и финал
  while (g('levelIdx') < 7) {
    vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
    guard = 0;
    const li = g('levelIdx');
    while (g('levelIdx') === li && guard++ < 100) t = await frames(10, t);
  }
  console.log('levelIdx:', g('levelIdx'), '(ждём 7)');
  vm.runInContext('taken = total; player.x = EXIT.x + 4; player.y = EXIT.y - 8; player.vx = 0; player.vy = 0;', sandbox);
  guard = 0;
  while (!g('won') && guard++ < 100) t = await frames(10, t);
  console.log('won:', g('won'), '(ждём true)');
  if (g('lives') === 1 && g('levelIdx') === 7 && g('won') === true) console.log('TEST PASS: смерть, лисы, коробки, переходы и финал работают');
  else { console.log('TEST FAIL'); process.exit(1); }
})();
