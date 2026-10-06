const game = document.getElementById('game');
const player = document.getElementById('player');
const ghost = document.getElementById('ghost');
const up = document.getElementById('up');
const down = document.getElementById('down');
const left = document.getElementById('left');
const right = document.getElementById('right');

let playerX = 200;
let playerY = 200;

let ghostX = 0;
let ghostY = 0;

player.style.left = playerX + 'px';
player.style.top = playerY + 'px';

function movePlayer(){
    // ห้ามออกนอกกรอบ: x ต้องอยู่ระหว่าง 0 ถึง (ความกว้างกล่อง - ความกว้างตัวละคร), y ก็เหมือนกัน
    playerX = clamp(playerX, 0, game.clientWidth - player.offsetWidth);
    playerY = clamp(playerY, 0, game.clientHeight - player.offsetHeight);
    player.style.left = playerX + 'px';
    player.style.top = playerY + 'px';
}
function moveTop() {playerY -= 10; movePlayer();}
function movedown() {playerY += 10; movePlayer();}
function moveleft() {playerX -= 10; movePlayer();}
function moveright() {playerX += 10; movePlayer();}

// ===== ตั้งค่าเกม (ปรับความยากได้ตรงนี้) =====
const TICK_MS = 20;               // เกมอัปเดตทุก 20ms (50 ครั้งต่อวินาที)
const PLAYER_SPEED = 3;           // คนเดินกี่ px ต่อรอบตอนกด WASD ค้าง
const PLAYER_MAX_HP = 100;
const FIRE_DAMAGE = 20;           // โดนไฟตอนไม่ได้บล็อก เสียเลือดเท่านี้ (โดน 5 ลูกตาย)
const GHOST_MAX_HP = 60;
const REFLECT_DAMAGE = 20;        // ตีไฟกลับไปโดนผี ผีเสียเลือดเท่านี้ (โดน 3 ลูกตาย)
const GHOST_RESPAWN_MS = 3000;    // ผีตายแล้วเกิดใหม่ใน 3 วินาที
const GHOST_SPEED = 1.5;          // ผีเดินกี่ px ต่อรอบ
const GHOST_STOP_DISTANCE = 150;  // ผีหยุดห่างจากคนเท่านี้ จะได้ยิงไฟจากระยะไกล
const FIRE_EVERY_MS = 1500;       // ผียิงไฟทุก 1.5 วินาที
const FIRE_SPEED = 5;             // ลูกไฟพุ่งกี่ px ต่อรอบ
const REFLECT_SPEED = 8;          // ลูกไฟที่ตีกลับพุ่งเร็วกว่า
const HIT_RADIUS = 35;            // ลูกไฟเข้าใกล้กลางตัวละครเท่านี้ถือว่าโดน
const PARRY_RADIUS = 100;         // คลิกซ้ายตอนลูกไฟอยู่ใกล้กว่านี้ จะตีกลับได้
const SWING_COOLDOWN_MS = 400;    // คลิกซ้ายรัวไม่ได้ ต้องเว้นอย่างน้อยเท่านี้

const playerHpFill = document.getElementById('player-hp');
const playerHpText = document.getElementById('player-hp-text');
const ghostHpFill = document.getElementById('ghost-hp');
const gameOverScreen = document.getElementById('game-over');

let playerHp = PLAYER_MAX_HP;
let ghostHp = GHOST_MAX_HP;
let isGhostAlive = true;
let isBlocking = false;
let isGameOver = false;
let lastSwingTime = 0;
let fires = [];

// ===== ฟังก์ชันช่วย =====
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// หาจุดกลางตัวละคร (x, y ที่เก็บไว้คือมุมซ้ายบน)
function centerOf(el, x, y) {
    return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

// ===== เลือด / ดาเมจ =====
function updateHpBar(fill, hp, maxHp) {
    const ratio = hp / maxHp;
    fill.style.transform = `scaleX(${ratio})`;
    fill.style.backgroundColor = `hsl(${ratio * 120}, 75%, 45%)`;  // เต็ม = เขียว, ครึ่ง = เหลือง, ใกล้หมด = แดง
}

function flashHit(el) {
    el.classList.remove('hit');
    void el.offsetWidth;  // บังคับให้เบราว์เซอร์รับรู้ว่าลบคลาสแล้ว ใส่ใหม่ animation จะเริ่มใหม่ได้แม้รอบก่อนยังไม่จบ
    el.classList.add('hit');
}

function damagePlayer(amount) {
    playerHp = Math.max(playerHp - amount, 0);
    updateHpBar(playerHpFill, playerHp, PLAYER_MAX_HP);
    playerHpText.textContent = playerHp + '/' + PLAYER_MAX_HP;
    flashHit(player);
    if (playerHp === 0) endGame();
}

function damageGhost(amount) {
    ghostHp = Math.max(ghostHp - amount, 0);
    updateHpBar(ghostHpFill, ghostHp, GHOST_MAX_HP);
    if (ghostHp === 0) {
        killGhost();
    } else {
        flashHit(ghost);
    }
}

function endGame() {
    isGameOver = true;
    clearInterval(gameLoopId);
    clearInterval(shootLoopId);
    setBlocking(false);
    gameOverScreen.classList.add('show');
}

// ===== ผี: เดินตาม / ตาย / เกิดใหม่ =====
function drawGhost() {
    ghost.style.left = ghostX + 'px';
    ghost.style.top = ghostY + 'px';
}

function moveGhost() {
    if (!isGhostAlive) return;
    const dx = playerX - ghostX;
    const dy = playerY - ghostY;
    const distance = Math.hypot(dx, dy);

    // หารด้วย distance ให้ได้ทิศทางยาว 1 แล้วคูณความเร็ว ผีจะเดินเร็วเท่ากันทุกทิศ
    if (distance > GHOST_STOP_DISTANCE) {
        ghostX += dx / distance * GHOST_SPEED;
        ghostY += dy / distance * GHOST_SPEED;
    }
    drawGhost();
}

function killGhost() {
    isGhostAlive = false;
    ghost.classList.remove('hit', 'spawning');
    ghost.classList.add('dead');
    setTimeout(respawnGhost, GHOST_RESPAWN_MS);
}

function respawnGhost() {
    if (isGameOver) return;
    // เกิดใหม่ที่มุมที่ไกลจากคนที่สุด
    const maxX = game.clientWidth - ghost.offsetWidth;
    const maxY = game.clientHeight - ghost.offsetHeight;
    ghostX = playerX < game.clientWidth / 2 ? maxX : 0;
    ghostY = playerY < game.clientHeight / 2 ? maxY : 0;
    drawGhost();

    ghostHp = GHOST_MAX_HP;
    updateHpBar(ghostHpFill, ghostHp, GHOST_MAX_HP);
    ghost.classList.remove('dead');
    ghost.classList.add('spawning');
    isGhostAlive = true;
}

// ===== ลูกไฟ =====
function drawFire(fire) {
    fire.el.style.left = fire.x + 'px';
    fire.el.style.top = fire.y + 'px';
}

// ตั้งความเร็วให้ลูกไฟพุ่งจาก from ไปหา to
function aimFire(fire, from, to, speed) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    // 🔥 ปลายไฟชี้ขึ้น หมุนให้ปลายไฟหันไปข้างหลัง ลูกไฟจะดูเหมือนมีหาง
    fire.el.style.rotate = (Math.atan2(dy, dx) * 180 / Math.PI - 90) + 'deg';
    return { ...fire, vx: dx / distance * speed, vy: dy / distance * speed };
}

function shootFire() {
    if (!isGhostAlive) return;
    const from = centerOf(ghost, ghostX, ghostY);

    const el = document.createElement('span');
    el.className = 'fire';
    el.textContent = '🔥';
    game.appendChild(el);

    // x, y ของลูกไฟคือจุดกลาง (CSS ใช้ translate -50% ช่วยจัดให้)
    const fire = aimFire({ el: el, x: from.x, y: from.y, isReflected: false },
        from, centerOf(player, playerX, playerY), FIRE_SPEED);
    drawFire(fire);
    fires.push(fire);
}

function fireHitPlayer(fire) {
    if (isBlocking) {
        fire.el.classList.add('blocked');
        fire.el.addEventListener('animationend', () => fire.el.remove(), { once: true });
        return;
    }
    fire.el.remove();
    damagePlayer(FIRE_DAMAGE);
}

function isOutsideGame(fire) {
    return fire.x < 0 || fire.y < 0 || fire.x > game.clientWidth || fire.y > game.clientHeight;
}

// คืนค่า true = ลูกไฟยังอยู่ต่อ, false = ลบทิ้ง
function updateFire(fire) {
    drawFire(fire);

    // ลูกไฟของผีโดนได้แค่คน ลูกไฟที่เราตีกลับโดนได้แค่ผี
    if (fire.isReflected) {
        if (isGhostAlive && distanceBetween(fire, centerOf(ghost, ghostX, ghostY)) < HIT_RADIUS) {
            fire.el.remove();
            damageGhost(REFLECT_DAMAGE);
            return false;
        }
    } else if (distanceBetween(fire, centerOf(player, playerX, playerY)) < HIT_RADIUS) {
        fireHitPlayer(fire);
        return false;
    }

    if (isOutsideGame(fire)) {
        fire.el.remove();
        return false;
    }
    return true;
}

function moveFires() {
    fires = fires
        .map(fire => ({ ...fire, x: fire.x + fire.vx, y: fire.y + fire.vy }))
        .filter(updateFire);
}

// ===== คลิกซ้าย: ปล่อยคลื่นพลัง ตีลูกไฟที่อยู่ใกล้ให้พุ่งกลับไปหาผี =====
function showSwingEffect(center) {
    const wave = document.createElement('div');
    wave.className = 'swing';
    wave.style.left = center.x + 'px';
    wave.style.top = center.y + 'px';
    wave.style.width = PARRY_RADIUS * 2 + 'px';
    wave.style.height = PARRY_RADIUS * 2 + 'px';
    game.appendChild(wave);
    wave.addEventListener('animationend', () => wave.remove(), { once: true });
}

function reflectFire(fire) {
    fire.el.classList.add('reflected');
    return aimFire({ ...fire, isReflected: true }, fire, centerOf(ghost, ghostX, ghostY), REFLECT_SPEED);
}

function swing() {
    const now = Date.now();
    if (isGameOver || now - lastSwingTime < SWING_COOLDOWN_MS) return;
    lastSwingTime = now;

    const center = centerOf(player, playerX, playerY);
    showSwingEffect(center);
    fires = fires.map(fire => {
        const isInReach = !fire.isReflected && distanceBetween(fire, center) < PARRY_RADIUS;
        return isInReach ? reflectFire(fire) : fire;
    });
}

// ===== คลิกขวาค้าง: บล็อก =====
function setBlocking(value) {
    isBlocking = value;
    player.classList.toggle('blocking', value);
}

document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('mousedown', event => {
    if (event.button === 2) setBlocking(true);
    // ไม่นับคลิกที่ปุ่มบนหน้าเว็บ (ปุ่มลูกศร / เล่นใหม่)
    if (event.button === 0 && !event.target.closest('button')) swing();
});
document.addEventListener('mouseup', event => {
    if (event.button === 2) setBlocking(false);
});

// ===== เดินด้วย WASD (กดค้างเพื่อเดินต่อเนื่อง) =====
// ใช้ event.code ('KeyW') แทน event.key ('w') เพราะ event.code บอกตำแหน่งปุ่ม
// ถ้าเปิดคีย์บอร์ดภาษาไทยอยู่ event.key จะได้ 'ไ' แต่ event.code ยังเป็น 'KeyW'
const KEY_DIRECTIONS = {
    KeyW: { x: 0, y: -1 },
    KeyS: { x: 0, y: 1 },
    KeyA: { x: -1, y: 0 },
    KeyD: { x: 1, y: 0 },
};
const keysDown = new Set();

document.addEventListener('keydown', event => {
    if (KEY_DIRECTIONS[event.code]) keysDown.add(event.code);
});
document.addEventListener('keyup', event => keysDown.delete(event.code));

function movePlayerByKeys() {
    if (keysDown.size === 0) return;
    keysDown.forEach(code => {
        playerX += KEY_DIRECTIONS[code].x * PLAYER_SPEED;
        playerY += KEY_DIRECTIONS[code].y * PLAYER_SPEED;
    });
    movePlayer();
}

// สลับไปหน้าต่างอื่นระหว่างกดค้าง จะไม่มี mouseup/keyup ส่งมา เลยต้องปล่อยเอง
window.addEventListener('blur', () => {
    setBlocking(false);
    keysDown.clear();
});

// ลบคลาส effect ออกเมื่อ animation เล่นจบ
player.addEventListener('animationend', event => {
    if (event.animationName === 'hit-flash') player.classList.remove('hit');
});
ghost.addEventListener('animationend', event => {
    if (event.animationName === 'hit-flash') ghost.classList.remove('hit');
    if (event.animationName === 'ghost-spawn') ghost.classList.remove('spawning');
});

// ===== เริ่มเกม =====
updateHpBar(playerHpFill, playerHp, PLAYER_MAX_HP);
updateHpBar(ghostHpFill, ghostHp, GHOST_MAX_HP);
drawGhost();

const gameLoopId = setInterval(() => {
    movePlayerByKeys();
    moveGhost();
    moveFires();
}, TICK_MS);
const shootLoopId = setInterval(shootFire, FIRE_EVERY_MS);
