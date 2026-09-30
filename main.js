// Манул-платформер v0.1 — ванилла, без зависимостей
const TILE = 16, W = 480, H = 270;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Уровень: 60x16 тайлов (960x256 px). Камера следует за котом.
// Уровни: каждый — имя + ASCII-карта + список пропастей [x0,x1] (режутся кодом, ряды 12+).
// Легенда: # земля, P мост, A аномалия (низкая гравитация), M добыча (перепёлка/крыса), S спавн,
// E выход (маркер, не solid), T земля-фон (тоже solid), F лиса (враг, не solid), . пусто.
const LEVELS = [
  { name: 'Опушка', pits: [[30,32],[45,46]], map: [
"............................................................",
"............................................................",
"............................................................",
"............................................................",
"....................M...................M....................",
"..................#####.................#####.........M.....",
"............................................................",
"............................................................",
"......M...........M.AAAA............M.....M.................",
"................AAAAAAAA.........######......AAAAAA..........",
"........MM......AAAAAAAA...AAA......AAA....AA..AA.AAAAAA....",
"S.....######PPPPAAAAAAAA...AAAPPPPPPAAA.M..AA..AA.AAAAAA..E..",
"####################AAAA################################..###",
"####################AAAA################################..###",
"TTTTTTTTTTTTTTTTTTTTAAAA################################..TTT",
"TTTTTTTTTTTTTTTTTTTTAAAA################################..TTT",
  ] },
  { name: 'Чаща', pits: [[18,20],[33,35],[47,49]], map: [
"............................................................",
"............................................................",
"............................................................",
"............................................................",
"............M.......................................M.......",
"..........#####...................................#####.....",
"............................................................",
"...............PPP............................PPP...........",
"...................M.....................M..................",
".........######.......AAAA..............AAAA.....######.....",
"........M.............AAAA....M.........AAAA....M...........",
".S...............PPPPPAAAA......PPPPP...AAAA..PPPPP.....E...",
"######################AAAA##############AAAA################",
"TTTTTTTTTTTTTTTTTTTTTTAAAATTTTTTTTTTTTTTAAAAATTTTTTTTTTTTTTT",
"TTTTTTTTTTTTTTTTTTTTTTAAAATTTTTTTTTTTTTTAAAAATTTTTTTTTTTTTTT",
"TTTTTTTTTTTTTTTTTTTTTTAAAATTTTTTTTTTTTTTAAAAATTTTTTTTTTTTTTT",
  ] },
  { name: 'Лисье логово', pits: [[27,29],[43,45]], map: [
"............................................................",
"............................................................",
"............................................................",
"............................................................",
"...........M................................................",
".........#####........................M.....................",
".......................M....................................",
"...............PPP...................AAAA...................",
"..........M...........AAAA...........AAAA..........M........",
"........######........AAAA...........AAAA.........######....",
"................M................M..............M....M......",
".S....F...............AAAAPPPPP..F...AAAA.PPPPP...F......E..",
"######################AAAA###########AAAA###################",
"TTTTTTTTTTTTTTTTTTTTTTAAAATTTTTTTTTTTAAAATTTTTTTTTTTTTTTTTTT",
"TTTTTTTTTTTTTTTTTTTTTTAAAATTTTTTTTTTTAAAATTTTTTTTTTTTTTTTTTT",
"TTTTTTTTTTTTTTTTTTTTTTAAAATTTTTTTTTTTAAAATTTTTTTTTTTTTTTTTTT",
  ] },
];
// A = аномалия (низкая гравитация), M = добыча, S = спавн, E = выход, F = лиса,
// # = земля, P = платформа-мост, T = земля-фон (тоже solid)

// вырезаем пропасти один раз на старте (по списку pits каждого уровня)
for (const lv of LEVELS){
  for (const pit of lv.pits){
    for (let x=pit[0]; x<=pit[1]; x++) for (let y=12; y<lv.map.length; y++)
      lv.map[y] = lv.map[y].substring(0,x) + '.' + lv.map[y].substring(x+1);
  }
}
let LEVEL = LEVELS[0].map, ROWS = LEVEL.length, COLS = LEVEL[0].length, levelIdx = 0;
let EXIT = {x: 0, y: 0, w: 24, h: 32};

function load(src){ return new Promise(res=>{ const i=new Image(); i.src=src; i.onload=()=>res(i); i.onerror=()=>res(null); }); }

const player = { x:0, y:0, w:16, h:24, vx:0, vy:0, onGround:false, face:1, coyote:0, buffer:0, anim:0 };
let shrooms = [], taken = 0, total = 0, won = false;
let foes = []; // лисы: {x,y,w,h,dir,vy,sx,sy,alive,anim,grounded}
let camX = 0;
// жизни по-марио: упал в пропасть — минус жизнь, все кончились — game over
let lives = 3, dying = 0, gameover = false, spawnX = 0, spawnY = 0;
// зона выхода (совпадает с зелёной поляной в рендере)
let t0 = 0, finalTime = 0, lastSec = -1, exitHint = false;

function fmt(s){ const m=Math.floor(s/60), ss=Math.floor(s%60); return m+':'+String(ss).padStart(2,'0'); }

function solidAt(tx, ty){
  if (tx<0 || tx>=COLS) return true;
  if (ty<0) return true;
  if (ty>=ROWS) return false; // дна нет — упавший в пропасть летит вниз до экрана смерти
  const c = LEVEL[ty][tx];
  return c==='#' || c==='P' || c==='T';
}
function tileAt(px, py){
  const row = LEVEL[Math.floor(py/TILE)];
  if (!row) return '#';
  const c = row[Math.floor(px/TILE)];
  return c === undefined ? '#' : c;
}
function inAnomaly(px, py){
  // проверяем центр тела
  const c = tileAt(px, py);
  return c === 'A';
}

function reset(full){
  if (full === undefined) full = true; // R/кнопка/старт — полный рестарт с 1 уровня
  if (full){ levelIdx = 0; lives = 3; }
  LEVEL = LEVELS[levelIdx].map; ROWS = LEVEL.length; COLS = LEVEL[0].length;
  EXIT = {x: 0, y: 0, w: 24, h: 32};
  shrooms = []; taken = 0; won = false;
  foes = [];
  dying = 0; gameover = false; wasAnom = false;
  t0 = performance.now(); finalTime = 0; lastSec = -1; exitHint = false;
  document.getElementById('timer').textContent = '⏱ 0:00';
  for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++){
    const c = LEVEL[y][x];
    if (c==='S'){ spawnX=x*TILE+2; spawnY=y*TILE-20; player.x=spawnX; player.y=spawnY; }
    if (c==='M'){ shrooms.push({x:x*TILE, y:y*TILE, got:false, kind:(shrooms.length%2===0)?'q':'r'}); }
    if (c==='E'){ EXIT.x=x*TILE; EXIT.y=y*TILE; }
    if (c==='F'){ foes.push({x:x*TILE-2, y:y*TILE+2, w:20, h:14, dir:-1, vy:0, sx:x*TILE-2, sy:y*TILE+2, alive:true, anim:Math.random()*2, grounded:false}); }
  }
  total = shrooms.length;
  player.vx = 0; player.vy = 0;
  document.getElementById('level').textContent = '🌲 ' + (levelIdx+1) + '/' + LEVELS.length;
  document.getElementById('msg').textContent = 'Собери всю добычу — перепёлок и крыс!';
  updateHud();
}
function updateHud(){
  document.getElementById('shrooms').textContent = `⭐ ${taken}/${total}`;
  document.getElementById('lives').textContent = '🐱×' + lives;
  if (won) document.getElementById('msg').textContent = '✅ Лес пройден за ' + fmt(finalTime) + '! R или ⟳ — ещё раз';
}

// смерть по-марио: подброс вверх, падение сквозь мир, затем респаун или конец игры
function startDeath(){
  lives--; dying = 1.4; player.vy = -280; player.vx = 0;
  sfx.die(); updateHud();
  document.getElementById('msg').textContent = lives>0 ? 'Ой! Осталось жизней: ' + lives : '';
}
function respawn(){
  player.x = spawnX; player.y = spawnY; player.vx = 0; player.vy = 0;
  player.coyote = 0; player.buffer = 0; wasAnom = false;
  for (const f of foes){ if (f.alive){ f.x = f.sx; f.y = f.sy; f.vy = 0; f.dir = -1; } }
    document.getElementById('msg').textContent = taken===total ? 'Вся добыча собрана! Беги на зелёную поляну →' : 'Собери всю добычу — перепёлок и крыс!';
}
function doGameOver(){
  gameover = true; finalTime = (performance.now()-t0)/1000;
  document.getElementById('msg').textContent = '💀 Игра окончена. R или ⟳ — заново';
}

const keys = {};
addEventListener('keydown', e=>{
  ac(); // разблокировать звук по первому жесту
  keys[e.code] = true;
  if (['Space','ArrowUp','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code==='Space'||e.code==='KeyW'||e.code==='ArrowUp') player.buffer = 0.12;
  if (e.code==='KeyR'){ sfx.click(); reset(); }
  if (e.code==='KeyM') toggleMute();
});
addEventListener('keyup', e=> keys[e.code] = false);

// --- Звук: синтез через Web Audio API, без файлов ---
// Как и пиксель-арт, «рисуем кодом»: осциллятор (форма волны) + огибающая громкости.
let AC = null, muted = false;
function ac(){
  try{
    if (!AC) AC = new (window.AudioContext||window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }catch(e){ return null; }
}
function tone(f0, f1, dur, type, vol, delay){
  if (muted) return;
  const ctx = ac(); if (!ctx) return;
  const t = ctx.currentTime + (delay||0);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(Math.max(f0,1), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1,1), t+dur);
  g.gain.setValueAtTime(vol || 0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t+dur+0.03);
}
const sfx = {
  jump(){ tone(280, 620, 0.14, 'square', 0.09); },
  pickup(){ tone(880, 880, 0.07, 'sine', 0.11); tone(1318, 1318, 0.10, 'sine', 0.11, 0.07); },
  denied(){ tone(180, 110, 0.22, 'sawtooth', 0.09); },
  die(){ tone(250, 700, 0.16, 'square', 0.10); tone(700, 90, 0.45, 'square', 0.10, 0.16); },
  stomp(){ tone(500, 150, 0.15, 'square', 0.11); tone(900, 900, 0.08, 'sine', 0.10, 0.05); },
  win(){ const n=[523,659,784,1046]; for (let i=0;i<n.length;i++) tone(n[i], n[i], 0.14, 'triangle', 0.11, i*0.11); },
  anomaly(){ tone(200, 900, 0.35, 'sine', 0.05); },
  click(){ tone(600, 600, 0.05, 'square', 0.07); },
};
function toggleMute(){
  muted = !muted;
  document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
}

// --- Тач-кнопки для телефона (btn-left / btn-right / btn-jump) ---
function bindTouch(id, code){
  const el = document.getElementById(id);
  if (!el) return;
  const on = e => { e.preventDefault(); ac(); keys[code] = true; if (code==='Space') player.buffer = 0.12; };
  const off = e => { if (e) e.preventDefault(); keys[code] = false; };
  el.addEventListener('touchstart', on, {passive:false});
  el.addEventListener('touchend', off);
  el.addEventListener('touchcancel', off);
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
  // показать блок кнопок на тач-устройствах (дополнительно к CSS media)
  if ('ontouchstart' in window) document.getElementById('touch').style.display = 'flex';
}
bindTouch('btn-left', 'ArrowLeft');
bindTouch('btn-right', 'ArrowRight');
bindTouch('btn-jump', 'Space');
// кнопка рестарта: сразу сбрасывает уровень (аналог клавиши R)
(function(){
  const el = document.getElementById('btn-restart');
  if (!el) return;
  const go = e => { e.preventDefault(); sfx.click(); reset(); };
  el.addEventListener('touchstart', go, {passive:false});
  el.addEventListener('mousedown', go);
})();
(function(){ // кнопка mute в HUD
  const el = document.getElementById('btn-mute');
  if (!el) return;
  const go = e => { e.preventDefault(); ac(); toggleMute(); };
  el.addEventListener('touchstart', go, {passive:false});
  el.addEventListener('mousedown', go);
})();

// --- Лисы: патруль по платформе, разворот у стен и краёв ---
function foePhysics(dt){
  for (const f of foes){
    if (!f.alive) continue;
    f.anim += dt*6;
    f.vy += 980*dt;
    if (f.vy>520) f.vy=520;
    // горизонталь: стена впереди — разворот
    var nx = f.x + f.dir*55*dt;
    var edgeX = f.dir>0 ? nx+f.w : nx;
    var tx = Math.floor(edgeX/TILE);
    var ty = Math.floor((f.y+f.h/2)/TILE);
    if (solidAt(tx, ty)){ f.dir = -f.dir; }
    else {
      f.x = nx;
      // край платформы: стоим, а впереди внизу пусто — разворот
      var bx = Math.floor(((f.dir>0) ? f.x+f.w+1 : f.x-1)/TILE);
      var by = Math.floor((f.y+f.h+2)/TILE);
      if (f.grounded && !solidAt(bx, by)) f.dir = -f.dir;
    }
    // вертикаль
    f.y += f.vy*dt;
    f.grounded = false;
    var x0=Math.floor(f.x/TILE), x1=Math.floor((f.x+f.w)/TILE);
    var y0=Math.floor(f.y/TILE), y1=Math.floor((f.y+f.h)/TILE);
    for (var yy=y0; yy<=y1; yy++) for (var xx=x0; xx<=x1; xx++){
      if (!solidAt(xx, yy)) continue;
      var bxx=xx*TILE, byy=yy*TILE;
      if (f.x+f.w>bxx && f.x<bxx+TILE && f.y+f.h>byy && f.y<byy+TILE){
        if (f.vy>0){ f.y=byy-f.h-0.01; f.grounded=true; }
        else if (f.vy<0){ f.y=byy+TILE+0.01; }
        f.vy=0;
      }
    }
    // страховка: провалилась за мир — вернуть на спавн
    if (f.y > ROWS*TILE+40){ f.x=f.sx; f.y=f.sy; f.vy=0; f.dir=-1; }
  }
}

function physics(dt, anom){
  const G = anom ? 320 : 980;          // в аномалии почти луна
  const SPEED = 130, JUMP = anom ? -460 : -340;
  const left = keys.KeyA||keys.ArrowLeft, right = keys.KeyD||keys.ArrowRight;

  player.vx = (right?SPEED:0) - (left?SPEED:0);
  if (player.vx!==0) player.face = player.vx>0?1:-1;
  player.vy += G*dt;
  if (player.vy>520) player.vy=520;

  // coyote + buffer
  player.coyote -= dt; player.buffer -= dt;

  // --- X ---
  player.x += player.vx*dt;
  collide(true);
  // --- Y ---
  player.y += player.vy*dt;
  player.onGround = false;
  collide(false);

  if (player.buffer>0 && (player.onGround || player.coyote>0)){
    player.vy = JUMP; player.onGround=false; player.coyote=0; player.buffer=0;
    sfx.jump();
  }
  // variable jump: отпустил — режем скорость
  if (!(keys.Space||keys.KeyW||keys.ArrowUp) && player.vy<-140) player.vy = -140;

  player.anim += dt * (Math.abs(player.vx)>10 && player.onGround ? 10 : 3);
}

function collide(isX){
  const x0=Math.floor(player.x/TILE), x1=Math.floor((player.x+player.w)/TILE);
  const y0=Math.floor(player.y/TILE), y1=Math.floor((player.y+player.h)/TILE);
  for (let ty=y0;ty<=y1;ty++) for (let tx=x0;tx<=x1;tx++){
    if (!solidAt(tx,ty)) continue;
    const bx=tx*TILE, by=ty*TILE;
    if (player.x+player.w>bx && player.x<bx+TILE && player.y+player.h>by && player.y<by+TILE){
      if (isX){
        player.x = player.vx>0 ? bx-player.w-0.01 : bx+TILE+0.01;
        player.vx = 0;
      } else {
        if (player.vy>0){ player.y=by-player.h-0.01; player.onGround=true; player.coyote=0.1; }
        else if (player.vy<0){ player.y=by+TILE+0.01; }
        player.vy = 0;
      }
    }
  }
}

let IM = {};
async function boot(){
  const [idle,w1,w2,jump,grass,tree,anom,quail,rat,fox1,fox2] = await Promise.all([
    load('assets/sprites/manul_big_idle.png'), load('assets/sprites/manul_big_walk1.png'),
    load('assets/sprites/manul_big_walk2.png'), load('assets/sprites/manul_big_jump.png'),
    load('assets/tiles/grass.png'),
    load('assets/tiles/tree.png'), load('assets/tiles/anomaly.png'), load('assets/tiles/quail.png'), load('assets/tiles/rat.png'),
    load('assets/sprites/fox_walk1.png'), load('assets/sprites/fox_walk2.png'),
  ]);
  IM = {idle,w1,w2,jump,grass,tree,anom,quail,rat,fox1,fox2};
  reset();
  requestAnimationFrame(loop);
}

let last = 0, glitch = 0, wasAnom = false;
function loop(t){
  const dt = Math.min(0.033, (t-last)/1000 || 0.016); last = t;
  const cx = player.x+player.w/2, cy = player.y+player.h/2;
  const anom = inAnomaly(cx, cy);
  if (anom && !wasAnom) sfx.anomaly(); // свип при входе в аномалию
  wasAnom = anom;
  if (!won && !gameover){
    if (dying > 0){ // предсмертное падение: управление отключено, коллизий нет
      dying -= dt;
      player.vy = Math.min(player.vy + 980*dt, 520);
      player.y += player.vy*dt;
      if (dying <= 0){ if (lives > 0) respawn(); else doGameOver(); }
    } else {
      physics(dt, anom);
      foePhysics(dt);
      // лисы: прыжок сверху убивает, касание сбоку — смерть
      if (dying <= 0){
        for (const f of foes){
          if (!f.alive) continue;
          if (player.x < f.x+f.w && player.x+player.w > f.x &&
              player.y < f.y+f.h && player.y+player.h > f.y){
            // стамп по-мариовски: падаешь (vy>0) — лиса повержена, даже если задел криво.
            // проверка penetration убрана: на лагах (dt до 0.033) вонзание за кадр
            // превышало старые 12px и честный прыжок сверху засчитывался как смерть.
            var stomp = player.vy > 0;
            if (stomp){
              f.alive = false;
              player.vy = -300; player.onGround = false;
              sfx.stomp();
              document.getElementById('msg').textContent = '🦊 Лиса повержена! Прыгай на них сверху';
            } else {
              startDeath();
              break;
            }
          }
        }
      }
    }
  }

  // добыча (не собираем во время падения/смерти)
  for (const s of shrooms){
    if (dying > 0 || gameover) break;
    if (!s.got && Math.abs(cx-(s.x+8))<12 && Math.abs(cy-(s.y+8))<14){
      s.got=true; taken++; sfx.pickup(); updateHud();
      if (taken===total) document.getElementById('msg').textContent='Вся добыча собрана! Беги на зелёную поляну →';
    }
  }
  // таймер (стоит на паузе после победы или конца игры)
  const elapsed = (won || gameover) ? finalTime : (performance.now()-t0)/1000;
  const sec = Math.floor(elapsed);
  if (sec !== lastSec){ lastSec = sec; document.getElementById('timer').textContent = '⏱ ' + fmt(elapsed); }

  // выход: засчитывается только КАСАНИЕ зоны телом и только со всей добычей
  const touchExit = player.x < EXIT.x+EXIT.w && player.x+player.w > EXIT.x &&
                    player.y < EXIT.y+EXIT.h && player.y+player.h > EXIT.y;
  if (touchExit && !won){
    if (taken === total){
      if (levelIdx < LEVELS.length-1){
        levelIdx++; sfx.win(); reset(false); // дальше: жизни сохраняются, таймер заново
        document.getElementById('msg').textContent = '🌲 Уровень ' + (levelIdx+1) + ': ' + LEVELS[levelIdx].name + '!';
      } else {
        won = true; finalTime = (performance.now()-t0)/1000;
        sfx.win(); updateHud();
      }
    } else if (!exitHint){
      exitHint = true; sfx.denied();
      document.getElementById('msg').textContent = '🔒 Выход закрыт — добудь всё (осталось ' + (total-taken) + ')';
    }
  } else if (!touchExit && exitHint && !won){
    exitHint = false;
  document.getElementById('msg').textContent = taken===total ? 'Вся добыча собрана! Беги на зелёную поляну →' : 'Собери всю добычу — перепёлок и крыс!';
  }

  // падение в пропасть — смерть (а не тихий рестарт)
  if (player.y > ROWS*TILE+10 && dying <= 0 && !gameover && !won) startDeath();

  // камера
  camX = Math.max(0, Math.min(COLS*TILE-W, cx-W/2));

  // --- render ---
  // небо-лес градиент
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0b0e1a'); g.addColorStop(1,'#16281f');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  glitch = anom ? (glitch+dt*8)%2 : 0;
  ctx.save();
  if (anom) ctx.translate(Math.random()*2-1, Math.random()*2-1);

  const x0=Math.floor(camX/TILE)-1, x1=x0+W/TILE+3;
  for (let ty=0;ty<ROWS;ty++) for (let tx=Math.max(0,x0);tx<Math.min(COLS,x1);tx++){
    const c=LEVEL[ty][tx], dx=Math.round(tx*TILE-camX), dy=ty*TILE;
    if (c==='#'||c==='T'){ ctx.drawImage(IM.grass,dx,dy); if(ty>0&&LEVEL[ty-1][tx]==='.'&&IM.grass) ctx.drawImage(IM.grass,dx,dy); }
    else if (c==='P'){ ctx.fillStyle='#6b4a2f'; ctx.fillRect(dx,dy+4,TILE,8); ctx.fillStyle='#8a6238'; ctx.fillRect(dx,dy+4,TILE,2); }
    else if (c==='A'){ ctx.drawImage(IM.anom,dx,dy); }
  }
  // деревья-фон + добыча
  for (let ty=0;ty<ROWS;ty++) for (let tx=Math.max(0,x0);tx<Math.min(COLS,x1);tx++){
    if (LEVEL[ty][tx]==='T' && ty===14 && tx%6===2) ctx.drawImage(IM.tree, Math.round(tx*TILE-camX)-4, ty*TILE-32, 24, 32);
  }
  const bob = Math.sin(performance.now()/400)*2;
  for (const s of shrooms){
    if (s.got) continue;
    ctx.drawImage(s.kind==='q'?IM.quail:IM.rat, Math.round(s.x-camX), s.y+bob);
  }
  // выход-флаг (та же зона EXIT, что проверяется в логике)
  const open = taken===total;
  ctx.fillStyle = open ? '#7ee081' : '#5a3a3a';
  ctx.fillRect(Math.round(EXIT.x-camX), EXIT.y, EXIT.w, EXIT.h);
  ctx.fillStyle='#1a1c2c'; ctx.font='8px monospace';
  ctx.fillText(open?'GO!':'🔒', Math.round(EXIT.x-camX)+(open?4:7), EXIT.y+12);

  // лисы (рисуются под игроком)
  for (const f of foes){
    if (!f.alive) continue;
    var fspr = (Math.floor(f.anim)%2===0)?IM.fox1:IM.fox2;
    if (!fspr) continue;
    var fx = Math.round(f.x-camX)-6, fy = Math.round(f.y)-16;
    ctx.save();
    if (f.dir<0){ ctx.translate(fx+32,fy); ctx.scale(-1,1); ctx.drawImage(fspr,0,0,32,32); }
    else ctx.drawImage(fspr,fx,fy,32,32);
    ctx.restore();
  }
  // игрок (вид сбоку, смотрит вправо; влево — отзеркаливаем)
  let spr = IM.idle;
  if (!player.onGround) spr = IM.jump;
  else if (Math.abs(player.vx)>10) spr = (Math.floor(player.anim)%2===0)?IM.w1:IM.w2;
  const px = Math.round(player.x-camX)-8, py = Math.round(player.y)-8;
  ctx.save();
  if (player.face<0){ ctx.translate(px+32,py); ctx.scale(-1,1); ctx.drawImage(spr,0,0,32,32); }
  else ctx.drawImage(spr,px,py,32,32);
  ctx.restore();

  // виньетка аномалии
  if (anom){
    ctx.fillStyle='rgba(140,80,255,0.12)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#8ef7e2'; ctx.font='8px monospace';
    ctx.fillText('◈ АНОМАЛИЯ: низкая гравитация', 8, 12);
  }
  ctx.restore();

  // оверлей смерти / конца игры
  if (dying > 0 || gameover){
    ctx.fillStyle = 'rgba(10,10,20,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    if (gameover){
      ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 22px monospace';
      ctx.fillText('ИГРА ОКОНЧЕНА', W/2, H/2-16);
      ctx.fillStyle = '#eee'; ctx.font = '11px monospace';
      ctx.fillText('Время: ' + fmt(finalTime) + '   Добыча: ' + taken + '/' + total, W/2, H/2+8);
      ctx.fillStyle = '#ffd83d';
      ctx.fillText('R или ⟳ — заново', W/2, H/2+28);
    } else {
      ctx.fillStyle = '#ffd83d'; ctx.font = 'bold 16px monospace';
      ctx.fillText('Ой! Манул упал...', W/2, H/2);
    }
    ctx.textAlign = 'left';
  }

  requestAnimationFrame(loop);
}
boot();
