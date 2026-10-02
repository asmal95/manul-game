#!/usr/bin/env python3
"""Генератор пиксель-арта для игры про манула. Только stdlib (без Pillow)."""
import struct, zlib, os, random

BASE = os.path.dirname(os.path.abspath(__file__))

def write_png(path, pixels):
    """pixels: list[y][x] = (r,g,b,a), 0-255"""
    h = len(pixels); w = len(pixels[0])
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    raw = b""
    for y in range(h):
        raw += b"\x00"
        for x in range(w):
            r,g,b,a = pixels[y][x]
            raw += struct.pack("BBBB", r,g,b,a)
    out = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(out)
    print(f"OK {path} ({w}x{h})")

# Палитра манула (Sweetie-ish + мех)
PAL = {
    '.': None,
    'K': (26,28,44,255),      # контур
    'G': (185,179,165,255),   # основной мех серо-бежевый
    'D': (125,116,102,255),   # тень меха
    'L': (232,224,207,255),   # светлый мех / пузо
    'E': (255,216,61,255),    # глаза жёлтые
    'B': (26,28,44,255),      # зрачок
    'P': (229,138,165,255),   # нос розовый
    'S': (74,63,53,255),      # полоски
    'W': (244,244,244,255),
    'O': (232,132,48,255),    # лиса: основной рыжий
    'U': (168,82,30,255),     # лиса: тёмный рыжий (спина, уши, лапы)
    'C': (245,230,205,255),   # лиса: кремовый (щёки, грудь, кончик хвоста)
    'Q': (190,150,100,255),   # перепёлка: пёстро-коричневая
    'R': (155,155,165,255),   # крыса: серая
    'N': (202,162,100,255),   # коробочка: светлое дерево
}

MANUL_IDLE = [
    "................",
    "..KK......KK....",
    ".KGGK....KGGK...",
    ".KGGKKKKKKGGK...",
    "..KGGGGGGGGK....",
    "..KLLGGGGllK....",  # placeholder, fix below
    "..KGGGGGGGGK....",
    "..KGEKGGKEGK....",
    "..KGEKGGKEGK....",
    "...KGGGGGGK.....",
    "...KGKPPKGK.....",
    "...KGLLLLGK.....",
    "..KSGGLLGGSK....",
    "..KGGGGGGGGK....",
    "..KDDGGGGDDK....",
    "...KKKKKKKK.....",
]
# починим опечатку (строчные недопустимы) — заменим на G
MANUL_IDLE = [row.replace('l','G').replace('L','L') for row in MANUL_IDLE]
# L уже есть в палитре, всё ок. Проверим длину строк:
MANUL_IDLE = [(row + '.'*16)[:16] for row in MANUL_IDLE]

MANUL_WALK1 = [
    "................",
    "..KK......KK....",
    ".KGGK....KGGK...",
    ".KGGKKKKKKGGK...",
    "..KGGGGGGGGK....",
    "..KGGGGGGGGK....",
    "..KGEKGGKEGK....",
    "..KGEKGGKEGK....",
    "...KGGGGGGK.....",
    "...KGKPPKGK.....",
    "...KGLLLLGK.....",
    "..KSGGLLGGSK....",
    ".KKGGGGGGGGKK...",
    ".KLDKGGGGKDLK...",
    "..KKK....KKK....",
    "................",
]

MANUL_WALK2 = [
    "................",
    "..KK......KK....",
    ".KGGK....KGGK...",
    ".KGGKKKKKKGGK...",
    "..KGGGGGGGGK....",
    "..KGGGGGGGGK....",
    "..KGEKGGKEGK....",
    "..KGEKGGKEGK....",
    "...KGGGGGGK.....",
    "...KGKPPKGK.....",
    "...KGLLLLGK.....",
    "..KSGGLLGGSK....",
    "...KGGGGGGGK....",
    "...KDLGGGLDK....",
    "....KK..KK......",
    "................",
]

MANUL_SLEEP = [
    "................",
    "................",
    "..KK......KK....",
    ".KGGKKKKKKGGK...",
    "..KGGGGGGGGK....",
    "..KGKKGGKKGK....",  # закрытые глаза — полоски
    "..KGGGGGGGGK....",
    "...KGGGGGGK.....",
    "...KGKPPKGK.....",
    "...KGLLLLGKZZZ..",  # Zzz вылетит отдельно, тут просто тело
    "..KSGGLLGGSK....",
    "..KGGGGGGGGK....",
    "..KDDGGGGDDK....",
    "...KKKKKKKK.....",
    "................",
    "................",
]

def render_charmap(charmap):
    h = len(charmap); w = len(charmap[0])
    px = [[(0,0,0,0)]*w for _ in range(h)]
    for y,row in enumerate(charmap):
        for x,ch in enumerate(row):
            c = PAL.get(ch)
            px[y][x] = c if c else (0,0,0,0)
    return px

def scale(px, s):
    h=len(px); w=len(px[0])
    out=[]
    for y in range(h):
        for _ in range(s):
            row=[]
            for x in range(w):
                for _ in range(s):
                    row.append(px[y][x])
            out.append(row)
    return out

# --- Тайлы 16x16 процедурные ---
def tile_grass(seed=1):
    rnd = random.Random(seed)
    base=(46,90,60); dark=(34,70,48); light=(62,112,78)
    px=[]
    for y in range(16):
        row=[]
        for x in range(16):
            r=rnd.random()
            c = base if r<0.7 else (dark if r<0.85 else light)
            # травинки
            if rnd.random()<0.06:
                c=(82,140,95)
            row.append((*c,255))
        px.append(row)
    return px

def tile_tree(seed=2):
    px = tile_grass(seed)
    # ствол
    for y in range(10,16):
        for x in range(7,9):
            px[y][x]=(90,60,40,255)
    px[15][6]=(70,45,30,255); px[15][9]=(70,45,30,255)
    # крона — круг
    canopy=[(27,80,50),(38,110,68),(52,140,85)]
    rnd=random.Random(seed)
    for y in range(0,11):
        for x in range(1,15):
            dx=x-7.5; dy=(y-5)*1.3
            d=(dx*dx+dy*dy)**0.5
            if d<6.2:
                c=canopy[0] if d>4.5 else (canopy[1] if d>2.5 else canopy[2])
                if rnd.random()<0.12: c=canopy[2]
                # контур
                if d>5.6: c=(20,55,38)
                px[y][x]=(*c,255)
    # блики
    px[3][6]=(90,200,130,255); px[4][5]=(90,200,130,255)
    return px

def tile_anomaly(seed=3):
    # тёмная земля + портал
    rnd=random.Random(seed)
    px=[]
    for y in range(16):
        row=[]
        for x in range(16):
            n=rnd.randint(-8,8)
            row.append((30+n,32+n,50+n,255))
        px.append(row)
    # портал — вертикальный овал
    cx,cy=7.5,7.5
    for y in range(16):
        for x in range(16):
            dx=(x-cx)/3.2; dy=(y-cy)/5.5
            d=dx*dx+dy*dy
            if d<1.0:
                # градиент: край фиолетовый, центр циан
                if d>0.7: c=(120,60,200)
                elif d>0.4: c=(90,240,220)
                else: c=(230,255,250)
                if rnd.random()<0.15: c=(255,255,255)
                px[y][x]=(*c,255)
            elif d<1.5:
                px[y][x]=(70,40,130,255)
    # искры вокруг
    for (x,y) in [(2,2),(13,3),(3,13),(12,12),(1,8)]:
        px[y][x]=(140,255,240,255)
    return px

def tile_bush_stone(seed=5):
    px=tile_grass(seed+20)
    rnd=random.Random(seed)
    # камень серый
    for y in range(10,14):
        for x in range(9,14):
            if (x-9)+(y-10)<5:
                px[y][x]=(140,140,150,255)
    px[10][10]=(180,180,190,255)
    # куст
    for y in range(8,12):
        for x in range(2,7):
            if rnd.random()<0.85:
                px[y][x]=(40,120,70,255)
    px[8][3]=(70,170,100,255)
    return px

# --- Фоновый декор 16x16: прозрачный фон, кладётся поверх земли ---
# Мило, не жутко: мягкие цвета, цветы рядом с «страшным».
def _clear16():
    return [[(0,0,0,0)]*16 for _ in range(16)]

def _shadow(px, x0=3, x1=12, y=13):
    for x in range(x0, x1+1):
        px[y][x] = (24,44,30,255)

def tile_decor_stone(seed=21):
    """Серый валун во мху."""
    px = _clear16()
    ST = (143,143,155,255); DK = (100,100,118,255); LT = (190,190,205,255)
    MS = (82,140,95,255)
    _shadow(px)
    _px_ellipse(px, 7.5, 10, 4, 2.5, ST)
    for x in range(4, 12):          # тёмный низ
        px[12][x] = DK
    px[12][4] = (0,0,0,0); px[12][11] = (0,0,0,0)
    for x in range(5, 8):           # светлый верх слева
        px[8][x] = LT
    px[9][5] = LT
    for (x, y) in [(9,8),(10,9),(6,10)]:  # мох
        px[y][x] = MS
    return px

def tile_decor_bones(seed=22):
    """Две милые косточки крест-накрест + цветочек."""
    px = _clear16()
    CR = PAL['L']; SH = PAL['D']; K = PAL['K']
    _shadow(px, 2, 13, 13)
    # кость 1 — горизонтальная
    _px_rect(px, 4, 9, 8, 2, CR)
    for (x, y) in [(3,8),(4,8),(3,11),(4,11),(11,8),(12,8),(11,11),(12,11),
                   (3,9),(3,10),(12,9),(12,10)]:
        px[y][x] = CR
    for x in range(4, 12):          # тень снизу
        px[10][x] = SH
    # кость 2 — диагональная
    for i in range(7):
        px[4+i][4+i] = CR; px[4+i][5+i] = CR
        px[5+i][4+i] = SH
    for (x, y) in [(3,3),(4,3),(3,4),(10,10),(11,10),(10,11),(11,11)]:
        px[y][x] = CR
    px[3][3] = K; px[11][11] = K
    # цветочек рядом
    px[12][13] = (46,90,60,255); px[11][13] = (46,90,60,255)
    px[10][13] = PAL['P']; px[10][12] = PAL['P']; px[9][13] = PAL['P']
    px[10][13] = PAL['E']
    return px

def tile_decor_skull(seed=23):
    """Круглый череп с румянцем и ростком клевера — не жутко, а мило."""
    px = _clear16()
    CR = PAL['L']; SH = PAL['D']
    EYE = (58,52,66,255); BLUSH = PAL['P']
    _shadow(px, 4, 11, 13)
    _px_ellipse(px, 7.5, 9, 3.5, 3.5, CR)   # купол
    _px_rect(px, 6, 11, 4, 2, CR)           # челюсть
    for x in range(6, 10):                  # тень низа
        px[12][x] = SH
    for (x, y) in [(6,8),(7,8),(9,8),(10,8)]:  # глазницы
        px[y][x] = EYE
    px[6][8] = PAL['W']                     # блик в глазу
    px[8][10] = EYE                         # нос по центру
    px[7][11] = SH; px[8][11] = SH          # зубы-прорези
    px[5][10] = BLUSH; px[10][10] = BLUSH   # румянец
    # росток клевера из макушки
    px[7][5] = (46,90,60,255); px[7][4] = (46,90,60,255)
    px[6][5] = (62,112,78,255); px[8][5] = (62,112,78,255)
    px[7][3] = PAL['P']; px[6][3] = (62,112,78,255); px[8][3] = (62,112,78,255)
    return px

def tile_decor_owl(seed=24):
    """Совёнок: круглый, глазастый, сидит в траве."""
    px = _clear16()
    BO = (157,102,52,255); DK = (110,70,35,255); CR = PAL['C']
    K = PAL['K']; W = PAL['W']; O = PAL['O']
    _shadow(px, 4, 11, 13)
    _px_ellipse(px, 8, 9, 4, 4.5, BO)       # тело
    _px_ellipse(px, 8, 10.5, 2.2, 2.8, CR) # пузо
    for y in range(8, 12):                 # крылья
        px[y][4] = DK; px[y][11] = DK
    for y in range(11, 13):                 # тёмный низ
        for x in range(5, 11):
            px[y][x] = DK
    _px_ellipse(px, 8, 10.5, 2.2, 2.2, CR)  # пузо поверх тени
    for (x, y) in [(4,5),(5,4),(11,5),(10,4)]:  # ушки
        px[y][x] = DK
    for (x, y) in [(6,7),(7,7),(6,8),(7,8),
                   (9,7),(10,7),(9,8),(10,8)]:  # глазищи
        px[y][x] = W
    px[7][8] = K; px[9][8] = K             # зрачки
    px[8][9] = O; px[7][9] = O             # клюв
    return px

# --- Добыча 16x16 (перепёлка и крыса, на траве) ---
def _px_ellipse(px, cx, cy, rx, ry, col):
    for y in range(len(px)):
        for x in range(len(px[0])):
            if ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1.0:
                px[y][x] = col

def _px_rect(px, x, y, w, h, col):
    for j in range(y, y+h):
        for i in range(x, x+w):
            if 0 <= i < len(px[0]) and 0 <= j < len(px):
                px[j][i] = col

def tile_quail(seed=6):
    """Перепёлка: круглое пёстрое тело, смотрит вправо."""
    px = tile_grass(seed+30)
    Q = PAL['Q']; S_ = PAL['S']; L = PAL['L']; K = PAL['K']; W = PAL['W']
    # хвост влево
    for (x, y) in [(1,9),(2,9),(3,9),(1,10),(2,10)]:
        px[y][x] = S_
    # тело + светлый низ
    _px_ellipse(px, 8, 10, 5, 4, Q)
    for x in range(6, 11):
        px[12][x] = L; px[13][x] = L
    # крыло + крап
    _px_ellipse(px, 7, 10, 2.5, 2, S_)
    px[9][6] = Q
    for (x, y) in [(5,9),(9,11),(10,8)]:
        px[y][x] = S_
    # голова + глаз с бликом + клюв
    _px_ellipse(px, 11, 6, 2.3, 2.5, Q)
    px[5][12] = K; px[5][11] = W
    px[6][13] = K; px[6][14] = K
    return px

def tile_rat(seed=7):
    """Крыса: серая, с розовыми ухом, носом и длинным хвостом."""
    px = tile_grass(seed+40)
    Rr = PAL['R']; P = PAL['P']; K = PAL['K']
    # хвост кривой по низу
    for x in range(1, 8):
        px[13][x] = P
    px[12][1] = P; px[11][1] = P
    # тело + голова справа
    _px_ellipse(px, 8, 10, 6, 3.5, Rr)
    _px_ellipse(px, 12, 9, 2.5, 2.5, Rr)
    # ухо + глаз + нос
    px[5][10] = P; px[5][11] = P; px[6][10] = P
    px[8][13] = K
    px[9][14] = P
    return px

def tile_box(seed=8, opened=False):
    """Коробочка-сюрприз 16x16 в полный рост тайла: дерево, «?»; открытая — тёмная."""
    rnd = random.Random(seed)
    px = []
    for y in range(16):
        row = []
        for x in range(16):
            n = rnd.randint(-6, 6)
            row.append((34+n, 36+n, 50+n, 255))  # тёмный фон по краям
        px.append(row)
    K = PAL['K']; N = PAL['N']; S_ = PAL['S']; W = PAL['W']
    if opened:
        _px_rect(px, 0, 1, 16, 14, K)
        _px_rect(px, 1, 2, 14, 12, S_)       # тёмное нутро
        _px_rect(px, 1, 2, 3, 2, N)          # остатки крышки по углам
        _px_rect(px, 12, 2, 3, 2, N)
        _px_rect(px, 5, 2, 6, 5, (10,10,18,255))  # чёрный проём
    else:
        _px_rect(px, 0, 1, 16, 14, K)        # контур в 1px
        _px_rect(px, 1, 2, 14, 12, N)        # дерево во весь рост
        for i in range(1, 15):               # планки-крест
            px[8][i] = S_
        for j in range(2, 14):
            px[j][7] = S_; px[j][8] = S_
        for (x, y) in [(6,5),(7,5),(8,5),(9,6),(9,7),(8,8),(7,8),(7,9),(7,11)]:
            px[y][x] = W                     # «?»
    return px

# --- Манул сбоку (для платформера, смотрит вправо) ---
def _blank(n=16):
    return [['.' for _ in range(n)] for _ in range(n)]

def _put(c, x, y, ch):
    n = len(c)
    if 0 <= x < n and 0 <= y < n:
        c[y][x] = ch

def _frect(c, x, y, w, h, ch):
    for j in range(y, y+h):
        for i in range(x, x+w):
            _put(c, i, j, ch)

def _fellipse(c, cx, cy, rx, ry, ch):
    n = len(c)
    for y in range(n):
        for x in range(n):
            if ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1.0:
                _put(c, x, y, ch)

def draw_side(pose='idle'):
    """pose: idle | walk1 | walk2 | jump. Возвращает charmap 16x16."""
    c = _blank()
    tail_cy = 6 if pose == 'jump' else 8
    # хвост: контур + мех
    _fellipse(c, 2, tail_cy, 2.4, 4.2, 'K')
    _fellipse(c, 2, tail_cy, 1.4, 3.2, 'G')
    # полоски на хвосте
    for x in range(0, 5):
        for y in (tail_cy-2, tail_cy+1):
            if 0 <= y < 16 and c[y][x] == 'G':
                c[y][x] = 'S'
    # тело: контур + мех + пузо
    _frect(c, 3, 4, 10, 8, 'K')
    _frect(c, 4, 5, 8, 6, 'G')
    _frect(c, 4, 9, 8, 2, 'L')
    # полоски на спине
    for x in (6, 8):
        if c[5][x] == 'G':
            c[5][x] = 'S'
    # голова: контур + мех
    _fellipse(c, 11, 7, 3.2, 3.6, 'K')
    _fellipse(c, 11, 7, 2.2, 2.6, 'G')
    # уши
    _put(c, 9, 2, 'K'); _put(c, 8, 3, 'K'); _put(c, 9, 3, 'G'); _put(c, 10, 3, 'K')
    _put(c, 12, 2, 'K'); _put(c, 11, 3, 'K'); _put(c, 12, 3, 'G'); _put(c, 13, 3, 'K')
    # глаз 2x2 + зрачок
    _put(c, 12, 6, 'E'); _put(c, 13, 6, 'E')
    _put(c, 12, 7, 'E'); _put(c, 13, 7, 'B')
    # морда: светлая + нос
    _put(c, 13, 8, 'L'); _put(c, 14, 8, 'P')
    # ноги по позам: (x, h) — h=3 стоит, h=2 поднята
    if pose == 'idle':
        legs = [(4, 3), (9, 3)]
    elif pose == 'walk1':   # передняя вперёд и вниз, задняя назад и вверх
        legs = [(3, 2), (10, 3)]
    elif pose == 'walk2':   # наоборот
        legs = [(5, 3), (8, 2)]
    else:                   # jump: обе поджаты
        legs = [(4, 2), (9, 2)]
    for (lx, lh) in legs:
        _frect(c, lx, 12, 3, lh, 'K')
        _frect(c, lx+1, 12, 1, max(lh-1, 1), 'G')
        for i in range(lx, lx+3):  # тёмные лапы
            _put(c, i, 12+lh-1, 'D')
    rows = [''.join(r) for r in c]
    if pose == 'jump':
        rows = rows[1:] + ['................']  # тело выше — эффект прыжка
    return rows

def render_side(pose):
    return render_charmap(draw_side(pose))

# --- Большой манул 32x32 сбоку (детальный, смотрит вправо) ---
def draw_big_side(pose='idle'):
    """pose: idle | walk1 | walk2 | jump. Возвращает charmap 32x32."""
    c = _blank(32)
    tail_cy = 14 if pose == 'jump' else 17
    # хвост-султан: контур + мех + кольца + тёмный кончик
    _fellipse(c, 5, tail_cy, 5, 8, 'K')
    _fellipse(c, 5, tail_cy, 3.4, 6.4, 'G')
    for y in (tail_cy-5, tail_cy-1, tail_cy+3):
        for x in range(0, 11):
            if c[y][x] == 'G':
                c[y][x] = 'S'
    for y in (tail_cy+6, tail_cy+7, tail_cy+8):
        for x in range(0, 11):
            if c[y][x] in ('G', 'S'):
                c[y][x] = 'D'
    # тело: контур + мех + светлое пузо
    _frect(c, 7, 9, 18, 15, 'K')
    _frect(c, 8, 10, 16, 13, 'G')
    _frect(c, 8, 19, 16, 4, 'L')
    # полоски на спине
    for x in (12, 15, 18):
        for y in (10, 11, 12):
            if c[y][x] == 'G':
                c[y][x] = 'S'
    # торчащий мех на пузе
    for x in (8, 11, 14, 17, 20, 23):
        _put(c, x, 24, 'K')
    # голова: контур + мех
    _fellipse(c, 23, 14, 6, 7, 'K')
    _fellipse(c, 23, 14, 4.6, 5.6, 'G')
    # бакенбарды-щёки (треугольники вниз)
    for (x, y) in [(20, 22), (22, 22), (25, 22), (27, 22)]:
        _put(c, x, y, 'K')
    # уши округлые, низко и широко (дальнее темнее, ближнее светлое внутри)
    _put(c, 19, 7, 'K'); _put(c, 20, 7, 'K')
    _put(c, 18, 8, 'K'); _put(c, 19, 8, 'G'); _put(c, 20, 8, 'G'); _put(c, 21, 8, 'K')
    _put(c, 24, 6, 'K'); _put(c, 25, 6, 'K'); _put(c, 26, 6, 'K')
    _put(c, 23, 7, 'K'); _put(c, 24, 7, 'L'); _put(c, 25, 7, 'L')
    _put(c, 26, 7, 'L'); _put(c, 27, 7, 'K')
    _put(c, 23, 8, 'K'); _put(c, 24, 8, 'L'); _put(c, 25, 8, 'L')
    _put(c, 26, 8, 'L'); _put(c, 27, 8, 'K')
    # глаз большой 3x3 + зрачок 2x2 + блик
    _frect(c, 24, 11, 3, 3, 'E')
    _frect(c, 25, 12, 2, 2, 'B')
    _put(c, 24, 11, 'W')
    # светлая бровь над глазом + крап на лбу
    _put(c, 24, 10, 'W'); _put(c, 25, 10, 'W'); _put(c, 26, 10, 'W')
    _put(c, 20, 10, 'S'); _put(c, 22, 10, 'S')
    # морда светлая широкая + нос с контуром + рот + белый подбородок
    _frect(c, 24, 15, 6, 4, 'L')
    _put(c, 28, 15, 'K'); _put(c, 29, 15, 'K')
    _put(c, 28, 16, 'P'); _put(c, 29, 16, 'P')
    _put(c, 28, 17, 'K'); _put(c, 27, 18, 'K'); _put(c, 28, 18, 'K')
    _put(c, 27, 19, 'W'); _put(c, 28, 19, 'W')
    # фирменные тёмные полосы манула: от глаз вниз по щекам
    for (x, y) in [(23, 14), (22, 15), (22, 16), (21, 17),
                   (27, 14), (27, 15), (26, 16), (26, 17)]:
        _put(c, x, y, 'S')
    # ноги по позам: (x, h), h=6 стоит / 4 поднята / 3 поджаты
    if pose == 'idle':
        legs = [(9, 6), (19, 6)]
    elif pose == 'walk1':
        legs = [(8, 4), (20, 6)]
    elif pose == 'walk2':
        legs = [(10, 6), (18, 4)]
    else:  # jump
        legs = [(9, 3), (19, 3)]
    for (lx, lh) in legs:
        _frect(c, lx, 24, 5, lh, 'K')
        _frect(c, lx+1, 24, 3, max(lh-1, 1), 'G')
        for i in range(lx, lx+5):  # тёмные лапы
            _put(c, i, 24+lh-1, 'D')
    rows = [''.join(r) for r in c]
    if pose == 'jump':
        rows = rows[2:] + ['................................', '................................']
    return rows

def render_big_side(pose):
    return render_charmap(draw_big_side(pose))

# --- Лиса 32x32 сбоку (враг, смотрит вправо, 2 кадра ходьбы) ---
def draw_fox_side(pose='walk1'):
    """pose: walk1 | walk2. Возвращает charmap 32x32."""
    c = _blank(32)
    # хвост-султан влево: контур + рыжий + кольца + кремовый кончик
    _fellipse(c, 4, 19, 4.5, 6.5, 'K')
    _fellipse(c, 4, 19, 3.3, 5.3, 'O')
    for y in (16, 20):
        for x in range(0, 9):
            if c[y][x] == 'O':
                c[y][x] = 'U'
    for y in range(14, 25):
        for x in range(0, 3):
            if c[y][x] in ('O', 'U'):
                c[y][x] = 'C'
    # тело: контур + рыжий + светлый живот + тёмная спина
    _frect(c, 8, 12, 15, 13, 'K')
    _frect(c, 9, 13, 13, 11, 'O')
    _frect(c, 9, 21, 13, 3, 'C')
    for x in (12, 15, 18):
        for y in (13, 14):
            if c[y][x] == 'O':
                c[y][x] = 'U'
    # голова: контур + рыжий
    _fellipse(c, 24, 15, 5.5, 6, 'K')
    _fellipse(c, 24, 15, 4.2, 4.8, 'O')
    # морда клином вправо + нос + кремовые щёки
    _frect(c, 26, 16, 4, 3, 'O')
    _put(c, 29, 17, 'K'); _put(c, 30, 17, 'K')
    _frect(c, 26, 18, 3, 2, 'C')
    # уши треугольные (дальнее левее, ближнее правее)
    _put(c, 21, 7, 'K'); _put(c, 22, 7, 'K')
    _put(c, 20, 8, 'K'); _put(c, 21, 8, 'O'); _put(c, 22, 8, 'O'); _put(c, 23, 8, 'K')
    _put(c, 25, 6, 'K'); _put(c, 26, 6, 'K')
    _put(c, 24, 7, 'K'); _put(c, 25, 7, 'O'); _put(c, 26, 7, 'O'); _put(c, 27, 7, 'K')
    _put(c, 25, 8, 'U'); _put(c, 26, 8, 'U')
    # глаз 2x2 + зрачок + блик
    _frect(c, 24, 12, 2, 2, 'E')
    _put(c, 25, 13, 'B')
    _put(c, 24, 12, 'W')
    # ноги: кадр отличается шагом (x, h), h=5 стоит / 3 поднята
    if pose == 'walk1':
        legs = [(10, 5), (18, 3)]
    else:
        legs = [(12, 3), (16, 5)]
    for (lx, lh) in legs:
        _frect(c, lx, 25, 4, lh, 'K')
        _frect(c, lx+1, 25, 2, max(lh-1, 1), 'O')
        for i in range(lx, lx+4):  # тёмные лапы
            _put(c, i, 25+lh-1, 'U')
    return [''.join(r) for r in c]

def render_fox(pose):
    return render_charmap(draw_fox_side(pose))

if __name__=="__main__":
    s = os.path.join(BASE,"assets","sprites")
    t = os.path.join(BASE,"assets","tiles")
    os.makedirs(s,exist_ok=True); os.makedirs(t,exist_ok=True)
    write_png(f"{s}/manul_idle.png", render_charmap(MANUL_IDLE))
    write_png(f"{s}/manul_walk1.png", render_charmap(MANUL_WALK1))
    write_png(f"{s}/manul_walk2.png", render_charmap(MANUL_WALK2))
    write_png(f"{s}/manul_sleep.png", render_charmap(MANUL_SLEEP))
    write_png(f"{s}/manul_side_idle.png", render_side('idle'))
    write_png(f"{s}/manul_side_walk1.png", render_side('walk1'))
    write_png(f"{s}/manul_side_walk2.png", render_side('walk2'))
    write_png(f"{s}/manul_side_jump.png", render_side('jump'))
    write_png(f"{s}/manul_big_idle.png", render_big_side('idle'))
    write_png(f"{s}/manul_big_walk1.png", render_big_side('walk1'))
    write_png(f"{s}/manul_big_walk2.png", render_big_side('walk2'))
    write_png(f"{s}/manul_big_jump.png", render_big_side('jump'))
    write_png(f"{s}/fox_walk1.png", render_fox('walk1'))
    write_png(f"{s}/fox_walk2.png", render_fox('walk2'))
    write_png(f"{t}/grass.png", tile_grass())
    write_png(f"{t}/anomaly.png", tile_anomaly())
    write_png(f"{t}/quail.png", tile_quail())
    write_png(f"{t}/rat.png", tile_rat())
    write_png(f"{t}/box.png", tile_box(8, False))
    write_png(f"{t}/box_open.png", tile_box(8, True))
    write_png(f"{t}/bush_stone.png", tile_bush_stone())
    write_png(f"{t}/decor_stone.png", tile_decor_stone())
    write_png(f"{t}/decor_bones.png", tile_decor_bones())
    write_png(f"{t}/decor_skull.png", tile_decor_skull())
    write_png(f"{t}/decor_owl.png", tile_decor_owl())
    # увеличенные версии x4 для просмотра
    write_png(f"{s}/manul_idle_x4.png", scale(render_charmap(MANUL_IDLE),4))
    write_png(f"{s}/manul_side_idle_x4.png", scale(render_side('idle'),4))
    write_png(f"{s}/manul_side_walk1_x4.png", scale(render_side('walk1'),4))
    write_png(f"{s}/manul_side_walk2_x4.png", scale(render_side('walk2'),4))
    write_png(f"{s}/manul_side_jump_x4.png", scale(render_side('jump'),4))
    write_png(f"{s}/manul_big_idle_x4.png", scale(render_big_side('idle'),4))
    write_png(f"{s}/manul_big_walk1_x4.png", scale(render_big_side('walk1'),4))
    write_png(f"{s}/manul_big_walk2_x4.png", scale(render_big_side('walk2'),4))
    write_png(f"{s}/manul_big_jump_x4.png", scale(render_big_side('jump'),4))
    write_png(f"{s}/fox_walk1_x4.png", scale(render_fox('walk1'),4))
    write_png(f"{s}/fox_walk2_x4.png", scale(render_fox('walk2'),4))
