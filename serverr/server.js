// KOSMOS.WORM — простой, рабочий сервер мультиплеера на Node.js + WebSocket
// Особенности: еда/бусты/боты, честные столкновения (виноват тот, чья ГОЛОВА въехала в тело).

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';

// ====== базовые константы мира
const WORLD = { w: 6000, h: 6000 };
const TICK = 33;         // ~30 Гц
const FOOD_TARGET = 900; // сколько еды держим в мире
const POWER_TARGET = 20; // бустов на карте
const PLANETS = ['Марс','Земля','Юпитер','Венера','Сатурн','Нептун','Меркурий','Уран','Плутон','Европа','Ио','Титан','Ганимед','Каллисто','Тритон'];
const COLORS = ['#6bf2ff','#7eff6b','#ff6be6','#ffaa6b','#7aa3ff','#ffd86b'];
const rand = (a,b)=> a + Math.random()*(b-a);
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
const now = ()=> Date.now();

// ====== HTTP + static (чтобы локально легко запускать клиент)
const app = express();
app.use(express.static('client')); // раздаём фронт
const server = http.createServer(app);

// ====== WS сервер
const wss = new WebSocketServer({ server });

let PLAYERS = new Map();   // id -> player
let FOODS   = new Map();   // id -> food
let POWERS  = new Map();   // id -> power
let NEXT_ID = 1;
let LAST_STEP = now();

// ====== генерация
function newFood(x = rand(40,WORLD.w-40), y = rand(40,WORLD.h-40), kind='pellet', val=1){
  const id = 'f'+(NEXT_ID++);
  FOODS.set(id, {id,x,y,kind,val});
}
function newPower(x = rand(80,WORLD.w-80), y = rand(80,WORLD.h-80), kind = ['ghost','magnet','turbo'][Math.floor(rand(0,3))]){
  const id = 'p'+(NEXT_ID++);
  POWERS.set(id, {id,x,y,kind});
}
function ensureFood(){ while(FOODS.size<FOOD_TARGET) newFood(); }
function ensurePowers(){ while(POWERS.size<POWER_TARGET) newPower(); }

function colorRnd(){ return COLORS[Math.floor(rand(0,COLORS.length))]; }
function planetName(){ return PLANETS[Math.floor(rand(0,PLANETS.length))]; }

// ====== игрок/бот
function createSnake({name,color,isBot=false}){
  const id = 'u'+(NEXT_ID++);
  const x = rand(1000, WORLD.w-1000);
  const y = rand(1000, WORLD.h-1000);
  const dir = rand(0, Math.PI*2);
  return {
    id, name, color: color || colorRnd(),
    isBot,
    alive: true,
    x, y, dir,
    speed: 2.3,
    baseR: 7,
    r: 7,
    len: 26,
    seg: Array.from({length:26}, (_,i)=>({x: x - i*8*Math.cos(dir), y: y - i*8*Math.sin(dir)})),
    score: 0,
    boosting: false,
    vx: 0, vy: 0,
    ghostUntil: 0,
    magnetUntil: 0,
    turboUntil: 0,
    lastInput: now(),
    view: {x, y},
    socket: null,
    ai: { turnAt: 0, targetFood: null }
  };
}

function addBot(){
  const bot = createSnake({name: planetName(), isBot:true});
  PLAYERS.set(bot.id, bot);
}
function addBots(n=12){ for(let i=0;i<n;i++) addBot(); }

// ====== помощь
function head(p){ return p.seg[0]; }
function dist2(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }

// ====== обработка входящих сообщений
function safeSend(ws, obj){
  if(ws && ws.readyState === ws.OPEN){
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws) => {
  const id = 'tmp'+(NEXT_ID++);
  ws._pid = id;

  ws.on('message', (data) => {
    let msg; try{ msg = JSON.parse(data); }catch{ return; }

    if(msg.t === 'join'){
      // создаём игрока
      const pl = createSnake({name: (msg.name||'Kosmos').slice(0,16), color: msg.color});
      pl.socket = ws;
      PLAYERS.set(pl.id, pl);
      ws._pid = pl.id;

      safeSend(ws, {t:'init', id: pl.id, world: WORLD, you: cleanPlayer(pl), foods: Array.from(FOODS.values()), powers: Array.from(POWERS.values()), others: snapshotPlayers()});
      return;
    }

    const me = PLAYERS.get(ws._pid);
    if(!me) return;

    if(msg.t === 'input'){
      // msg: {ang, boosting, viewX, viewY}
      me.dir = msg.ang;
      me.boosting = !!msg.boosting;
      if(msg.viewX!=null) me.view = {x: msg.viewX, y: msg.viewY};
      me.lastInput = now();
      return;
    }

    if(msg.t === 'respawn'){
      // новый червь
      const name = (msg.name||me.name||'Kosmos').slice(0,16);
      const color = msg.color || me.color;
      const fresh = createSnake({name, color});
      fresh.socket = ws;
      PLAYERS.delete(me.id);
      PLAYERS.set(fresh.id, fresh);
      ws._pid = fresh.id;
      safeSend(ws, {t:'init', id:fresh.id, world:WORLD, you: cleanPlayer(fresh), foods:Array.from(FOODS.values()), powers:Array.from(POWERS.values()), others: snapshotPlayers()});
    }
  });

  ws.on('close', () => {
    const pid = ws._pid;
    const pl = PLAYERS.get(pid);
    if(pl && pl.isBot===false) PLAYERS.delete(pid);
  });
});

// ====== «безопасный» вид игрока для отдачи клиенту
function cleanPlayer(p){
  return { id:p.id, name:p.name, color:p.color, x:p.x, y:p.y, dir:p.dir, r:p.r, score:p.score, alive:p.alive };
}
function snapshotPlayers(){
  // отдаём укороченные хвосты, чтобы не перегружать сеть
  const out = [];
  for(const p of PLAYERS.values()){
    out.push({
      id:p.id, name:p.name, color:p.color, score:p.score, alive:p.alive,
      r:p.r, x:p.x, y:p.y, dir:p.dir,
      seg: p.seg.filter((_,i)=> i%2===0).slice(0,60)
    });
  }
  return out;
}

// ====== игровой цикл
function step(dt){
  const t = now();
  // ----- боты
  for(const p of PLAYERS.values()){
    if(!p.isBot || !p.alive) continue;
    if(p.ai.turnAt < t){
      p.ai.turnAt = t + 1200 + Math.random()*1200;
      let near = null, best = 1e12;
      for(const f of FOODS.values()){
        const d = (f.x-p.x)*(f.x-p.x) + (f.y-p.y)*(f.y-p.y);
        if(d<best){ best=d; near=f; }
      }
      p.ai.targetFood = near;
      if(Math.random()<0.2) p.boosting = !p.boosting;
    }
    if(p.ai.targetFood){
      const dx = p.ai.targetFood.x - p.x;
      const dy = p.ai.targetFood.y - p.y;
      p.dir = Math.atan2(dy, dx);
    } else {
      p.dir += rand(-0.2,0.2);
    }
  }

  // ----- движение, еда, бусты
  for(const p of PLAYERS.values()){
    if(!p.alive) continue;

    const massFactor = clamp(1 - (p.seg.length-26)/300, 0.6, 1); // длиннее => медленнее
    const turbo = (p.turboUntil > t);
    const base = 2.35 * massFactor * (turbo?1.6:1);
    const sp = base * (p.boosting?1.55:1);

    const nx = p.x + Math.cos(p.dir)*sp;
    const ny = p.y + Math.sin(p.dir)*sp;
    p.x = (nx+WORLD.w)%WORLD.w;
    p.y = (ny+WORLD.h)%WORLD.h;
    p.seg.unshift({x:p.x, y:p.y});
    if(p.seg.length > p.len) p.seg.pop();

    // радиус от массы
    p.r = clamp(p.baseR + (p.seg.length-26)*0.12, 6, 30);

    // еда
    for(const f of FOODS.values()){
      if(!p.alive) break;
      const r2 = (p.r+6)*(p.r+6);
      if(dist2(head(p), f) <= r2){
        FOODS.delete(f.id);
        p.len += 3;
        p.score += (f.val||1);
      }else if(p.magnetUntil>t){
        const d2 = dist2(head(p), f);
        if(d2 < 180*180){
          const d = Math.sqrt(d2)+1e-3;
          f.x -= 130*(f.x - p.x)/d * dt/1000;
          f.y -= 130*(f.y - p.y)/d * dt/1000;
        }
      }
    }

    // бусты (эмодзи: 👻🧲⚡ на клиенте)
    for(const b of POWERS.values()){
      const r2 = (p.r+12)*(p.r+12);
      if(dist2(head(p), b) <= r2){
        if(b.kind==='ghost') p.ghostUntil = t + 6000;
        if(b.kind==='magnet') p.magnetUntil = t + 8000;
        if(b.kind==='turbo') p.turboUntil = t + 6000;
        POWERS.delete(b.id);
      }
    }
  }

  // ----- столкновения: виноват тот, чья голова въехала в тело другого
  outer:
  for(const a of PLAYERS.values()){
    if(!a.alive) continue;
    const Ha = head(a);
    const ghost = a.ghostUntil > t;
    if(ghost) continue;

    for(const b of PLAYERS.values()){
      if(!b.alive || a===b) continue;
      const R2 = (a.r + b.r*0.85)**2;
      for(let i=2;i<b.seg.length;i++){
        const s = b.seg[i];
        if(dist2(Ha,s) <= R2){
          a.alive = false;
          for(let k=0;k<a.seg.length;k+=2){
            const p = a.seg[k];
            newFood(p.x, p.y, 'meat', 2);
          }
          const ws = a.socket;
          if(ws) safeSend(ws, {t:'dead', score:a.score, reason:'crash'});
          break outer;
        }
      }
    }
  }

  // ----- поддерживаем числа
  ensureFood(); ensurePowers();

  // ----- рассылка снапшота
  const state = {
    t:'state',
    time:t,
    players: snapshotPlayers(),
    foods: Array.from(FOODS.values()).slice(0,700),
    powers: Array.from(POWERS.values()),
    lb: top10()
  };
  const payload = JSON.stringify(state);
  for(const p of PLAYERS.values()){
    if(p.socket && p.socket.readyState===1) p.socket.send(payload);
  }
}

function top10(){
  const arr = Array.from(PLAYERS.values())
    .filter(p=>p.alive)
    .map(p=>({name:p.name,score:p.score,id:p.id}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,10);
  return arr;
}

// ====== init
ensureFood(); ensurePowers(); addBots(14);

// ====== главный таймер
setInterval(()=>{
  const t = now();
  const dt = clamp(t - LAST_STEP, 1, 66);
  LAST_STEP = t;
  step(dt);
}, TICK);

// ====== запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on http://localhost:'+PORT));

