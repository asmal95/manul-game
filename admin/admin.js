// Конструктор уровней: логин, список, сетка 60x16, pits, сохранение, тест-драфт.
// Сервер — источник правды по валидации (422 + details показываем как есть).
(function(){
'use strict';
var COLS = 60, ROWS = 16, CELL = 10;
var TILES = ['.', '#', 'P', 'A', 'M', 'B', 'S', 'E', 'T', 'F'];
var COLORS = {'.': '#0b0e1a', '#': '#4a7c3a', 'P': '#8a6238', 'A': '#8b5cf6',
  'M': '#ffd83d', 'B': '#ff9f43', 'S': '#4aa8ff', 'E': '#7ee081',
  'T': '#2d5a3d', 'F': '#ff6b6b'};
var NAMES = {'.': 'пусто', '#': 'земля', 'P': 'мост', 'A': 'аномалия',
  'M': 'добыча', 'B': 'коробка', 'S': 'спавн', 'E': 'выход',
  'T': 'фон', 'F': 'лиса'};

var state = {levels: [], cur: null, brush: '#', dirty: false};
var $ = function(id){ return document.getElementById(id); };
var grid = $('grid'), gx = grid.getContext('2d');

function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({'Content-Type': 'application/json'}, opts.headers || {});
  opts.credentials = 'same-origin';
  return fetch(path, opts).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      return {ok: r.ok, status: r.status, body: j};
    });
  });
}

function blankMap(){
  var m = [];
  for (var y = 0; y < ROWS; y++){
    var row = '';
    for (var x = 0; x < COLS; x++) row += '.';
    m.push(row);
  }
  // земля по умолчанию внизу, как в игре
  m[12] = repeat('#', COLS); m[13] = repeat('#', COLS);
  m[14] = repeat('T', COLS); m[15] = repeat('T', COLS);
  m[11] = 'S' + m[11].slice(1, COLS - 1) + 'E';
  return m;
}
function repeat(s, n){ var r = ''; for (var i = 0; i < n; i++) r += s; return r; }

function draw(){
  // Что нарисовано — то и в игре: геометрия хранится напрямую,
  // превью 1-в-1 с картой уровня.
  var m = state.cur.map;
  for (var y = 0; y < ROWS; y++){
    for (var x = 0; x < COLS; x++){
      gx.fillStyle = COLORS[m[y][x]] || '#f0f';
      gx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  gx.strokeStyle = 'rgba(255,255,255,0.08)';
  gx.beginPath();
  for (var i = 0; i <= COLS; i++){ gx.moveTo(i * CELL + .5, 0); gx.lineTo(i * CELL + .5, ROWS * CELL); }
  for (var j = 0; j <= ROWS; j++){ gx.moveTo(0, j * CELL + .5); gx.lineTo(COLS * CELL, j * CELL + .5); }
  gx.stroke();
}

function setCell(x, y){
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  var row = state.cur.map[y];
  if (row[x] === state.brush) return;
  state.cur.map[y] = row.slice(0, x) + state.brush + row.slice(x + 1);
  state.dirty = true;
  draw();
}
function gridPos(e){
  var r = grid.getBoundingClientRect();
  var cx = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
  var cy = (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY);
  return [Math.floor((cx - r.left) / r.width * COLS), Math.floor((cy - r.top) / r.height * ROWS)];
}
var painting = false;
grid.addEventListener('mousedown', function(e){ painting = true; var p = gridPos(e); setCell(p[0], p[1]); e.preventDefault(); });
grid.addEventListener('mousemove', function(e){ if (painting){ var p = gridPos(e); setCell(p[0], p[1]); } });
window.addEventListener('mouseup', function(){ painting = false; });
grid.addEventListener('touchstart', function(e){ painting = true; var p = gridPos(e); setCell(p[0], p[1]); e.preventDefault(); }, {passive: false});
grid.addEventListener('touchmove', function(e){ if (painting){ var p = gridPos(e); setCell(p[0], p[1]); e.preventDefault(); } }, {passive: false});
grid.addEventListener('touchend', function(){ painting = false; });

function buildPalette(){
  var pal = $('palette');
  pal.innerHTML = '';
  TILES.forEach(function(t){
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = t + ' ' + NAMES[t];
    b.style.borderColor = COLORS[t];
    if (t === state.brush) b.className = 'on';
    b.onclick = function(){
      state.brush = t;
      Array.prototype.forEach.call(pal.children, function(c){ c.className = ''; });
      b.className = 'on';
    };
    pal.appendChild(b);
  });
}

function fillForm(l){
  $('f-name').value = l.name || '';
  $('f-slug').value = l.slug || '';
  $('f-ord').value = l.ord || 0;
  $('f-status').value = l.status || 'draft';
  $('errs').innerHTML = '';
  $('save-msg').textContent = '';
  state.dirty = false;
  draw();
}

function refreshList(){
  var sel = $('level-list');
  sel.innerHTML = '';
  state.levels.forEach(function(l){
    var o = document.createElement('option');
    o.value = l.id;
    o.textContent = '#' + l.id + ' [' + l.status + '] ' + l.name;
    sel.appendChild(o);
  });
  if (state.cur) sel.value = state.cur.id;
}

function selectLevel(id){
  var found = null;
  state.levels.forEach(function(l){ if (String(l.id) === String(id)) found = l; });
  if (!found) return;
  state.cur = JSON.parse(JSON.stringify(found)); // копия для редактирования
  refreshList();
  fillForm(state.cur);
}

function collect(){
  return {
    name: $('f-name').value,
    slug: $('f-slug').value.trim(),
    ord: parseInt($('f-ord').value, 10) || 0,
    status: $('f-status').value,
    pits: [],
    map: state.cur.map
  };
}

function showErrs(res){
  var ul = $('errs');
  ul.innerHTML = '';
  var list = res.body.details || [res.body.error || ('HTTP ' + res.status)];
  list.forEach(function(msg){
    var li = document.createElement('li');
    li.textContent = msg;
    ul.appendChild(li);
  });
  $('save-msg').textContent = '';
}

function reload(){
  return api('/api/admin/levels').then(function(res){
    if (!res.ok) return false;
    state.levels = res.body.levels || [];
    if (state.cur && state.cur.id){
      var keep = null;
      state.levels.forEach(function(l){ if (l.id === state.cur.id) keep = l; });
      state.cur = keep ? JSON.parse(JSON.stringify(keep)) : null;
    }
    if (!state.cur && state.levels.length){
      state.cur = JSON.parse(JSON.stringify(state.levels[0]));
    }
    refreshList();
    if (state.cur) fillForm(state.cur);
    return true;
  });
}

function showEditor(login){
  $('login').hidden = true;
  $('editor').hidden = false;
  $('who').textContent = 'вошёл: ' + login;
}

$('login').addEventListener('submit', function(e){
  e.preventDefault();
  $('login-err').textContent = '';
  api('/api/admin/login', {method: 'POST', body: JSON.stringify({
    login: $('login-name').value, password: $('login-pass').value})}).then(function(res){
    if (!res.ok){ $('login-err').textContent = res.body.error || ('HTTP ' + res.status); return; }
    $('login-pass').value = '';
    showEditor(res.body.login);
    reload();
  });
});
$('btn-logout').onclick = function(){
  api('/api/admin/logout', {method: 'POST'}).then(function(){
    location.reload();
  });
};
$('level-list').onchange = function(e){ selectLevel(e.target.value); };
$('btn-new').onclick = function(){
  state.cur = {id: 0, name: 'Новый уровень', slug: '', ord: state.levels.length, status: 'draft', pits: [], map: blankMap()};
  refreshList();
  fillForm(state.cur);
};
$('btn-dup').onclick = function(){
  if (!state.cur) return;
  var c = JSON.parse(JSON.stringify(state.cur));
  c.id = 0; c.name = c.name + ' (копия)'; c.slug = ''; c.status = 'draft';
  state.cur = c;
  refreshList();
  fillForm(state.cur);
  $('save-msg').textContent = 'копия — нажми Сохранить';
};
$('btn-del').onclick = function(){
  if (!state.cur || !state.cur.id) return;
  if (!confirm('Удалить «' + state.cur.name + '»?')) return;
  api('/api/admin/levels/' + state.cur.id, {method: 'DELETE'}).then(function(res){
    if (!res.ok){ showErrs(res); return; }
    state.cur = null;
    reload();
  });
};
$('btn-save').onclick = function(){
  if (!state.cur) return;
  var body = JSON.stringify(collect());
  var req;
  if (state.cur.id){
    req = api('/api/admin/levels/' + state.cur.id, {method: 'PUT', body: body});
  } else {
    req = api('/api/admin/levels', {method: 'POST', body: body});
  }
  req.then(function(res){
    if (!res.ok){ showErrs(res); return; }
    state.levels = state.levels.filter(function(l){ return l.id !== res.body.id; });
    state.levels.push(res.body);
    state.levels.sort(function(a, b){ return (a.ord - b.ord) || (a.id - b.id); });
    state.cur = JSON.parse(JSON.stringify(res.body));
    refreshList();
    fillForm(state.cur);
    $('save-msg').textContent = 'сохранено #' + res.body.id;
  });
};
$('btn-test').onclick = function(){
  if (!state.cur || !state.cur.id){ alert('Сначала сохрани уровень'); return; }
  window.open('/?draft=' + state.cur.id, '_blank');
};

// вход: если сессия жива — сразу в редактор
buildPalette();
api('/api/admin/me').then(function(res){
  if (res.ok){
    showEditor(res.body.login);
    reload();
  }
});
})();
