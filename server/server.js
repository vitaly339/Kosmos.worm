// KOSMOS.WORM — сервер мультиплеера на Node.js + WebSocket
// Исправлено: теперь статика берётся из ../client

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

// === пути
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const clientDir  = path.join(__dirname, '..', 'client');

// === константы мира
const WORLD = { w: 6000, h: 6000 };
const TICK = 33;
const FOOD_TARGET = 900;
const POWER_TARGET = 20;
const PLANETS = ['Марс','Земля','Юпитер','Венера','Сатурн','Нептун','Меркурий','Уран','Плутон'];
const COLORS = ['#6bf2ff','#7eff6b','#ff6be6','#ffaa6b','#7aa3ff','#ffd86b'];
const rand = (a,b)=> a + Math.random()*(b-a);
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
const now = ()=> Date.now();

// === Express + WS
const app = express();
app.use(express.static(clientDir));           // раздаём статику из ../client
app.get('*', (req, res) => {                  // для любых путей -> index.html
  res.sendFile(path.join(clientDir, 'index.html'));
});
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// === данные
let PLAYERS = new Map();
let FOODS   = new Map();
let POWERS  = new Map();
let NEXT_ID = 1;
let LAST_STEP = now();

// === генерация еды/бустов
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

// === игрок/бот
function createSnake({name,color,isBot=false}){
  const id = 'u'+(NEXT_ID++);
  const x = rand(1000, WORLD.w-1000);
  const y = rand(1000, WORLD.h-1000);
  const dir = rand(0, Math.PI*2);
  return {
    id, name, color: color || colorRnd(),
    isBot, alive: true, x, y, dir,
    speed: 2.3, baseR: 7, r: 7, len: 26,
    seg: Array.from({length:26}, (_,i)=>({x: x - i*8*Math.cos(dir), y: y - i*8*Math.sin(dir)})),
    score: 0, boosting: false,
    socket: null
  };
}
function addBot(){ PLAYERS.set('u'+(NEXT_ID++), createSnake({name: planetName(), isBot:true})); }
function head(p){ return p.seg[0]; }
function dist2(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }
function safeSend(ws, obj){ if(ws && ws.readyState === ws.OPEN){ ws.send(JSON.stringify(obj)); }}

// === WS соединение
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg; try{ msg = JSON.parse(data); }catch{ return; }
    if(msg.t === 'join'){
      const pl = createSnake({name: (msg.name||'Kosmos').slice(0,16), color: msg.color});
      pl.socket = ws;
      PLAYERS.set(pl.id, pl);
      ws._pid = pl.id;
      safeSend(ws, {t:'init', id: pl.id, world: WORLD, you: pl, foods: Array.from(FOODS.values()), powers: Array.from(POWERS.values()), others: Array.from(PLAYERS.values())});
      return;
    }
    const me = PLAYERS.get(ws._pid);
    if(!me) return;
    if(msg.t === 'input'){ me.dir = msg.ang; me.boosting = !!msg.boosting; }
  });
  ws.on('close', () => { if(ws._pid) PLAYERS.delete(ws._pid); });
});

// === игровой цикл
function step(){
  for(const p of PLAYERS.values()){
    if(!p.alive) continue;
    const sp = 2.35 * (p.boosting?1.5:1);
    p.x = (p.x + Math.cos(p.dir)*sp + WORLD.w)%WORLD.w;
    p.y = (p.y + Math.sin(p.dir)*sp + WORLD.h)%WORLD.h;
    p.seg.unshift({x:p.x,y:p.y});
    if(p.seg.length > p.len) p.seg.pop();
    p.r = clamp(p.baseR + (p.seg.length-26)*0.12, 6, 30);
  }
  ensureFood(); ensurePowers();
  const state = {t:'state', time:now(), players: Array.from(PLAYERS.values()), foods:Array.from(FOODS.values()), powers:Array.from(POWERS.values())};
  const payload = JSON.stringify(state);
  for(const p of PLAYERS.values()){ if(p.socket && p.socket.readyState===1) p.socket.send(payload); }
}

setInterval(step, TICK);
ensureFood(); ensurePowers(); for(let i=0;i<10;i++) addBot();

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on http://localhost:'+PORT));