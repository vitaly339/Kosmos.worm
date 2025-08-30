// Клиент мультиплеера. Canvas рендер, мини-карта, управление (мышь/тач),
// бусты, свечение, полосатое тело. Работает и на мобильных.

const $ = s => document.querySelector(s);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/* ====== DOM ====== */
const cvs = $('#game');
const ctx = cvs.getContext('2d');
const mini = $('#minimap');
const mctx = mini.getContext('2d');
const HUD = document.querySelector('.hud');
const scoreEl = $('#score');
const lbEl = $('#lb');

/* ====== сетка ====== */
let WS = null;
let MY_ID = null;
let WORLD = {w:6000,h:6000};
let ME = null;
let FOODS = [];
let POWERS = [];
let PLAYERS = [];
let lastStateTime = 0;

/* ====== управление ====== */
const input = {
  ang: 0,
  boosting: false,
  viewX: 0, viewY: 0
};
let touchId = null;
const boostPad = $('#boostPad');

function aimTo(mx, my){
  const cx = cvs.width/2, cy = cvs.height/2;
  input.ang = Math.atan2(my - cy, mx - cx);
}
cvs.addEventListener('mousemove', e=> aimTo(e.clientX, e.clientY));
cvs.addEventListener('mousedown', e=> aimTo(e.clientX, e.clientY));
cvs.addEventListener('touchstart', e=>{
  const t = e.changedTouches[0]; touchId=t.identifier;
  aimTo(t.clientX, t.clientY);
},{passive:true});
cvs.addEventListener('touchmove', e=>{
  for(const t of e.changedTouches){
    if(t.identifier===touchId) aimTo(t.clientX, t.clientY);
  }
},{passive:true});
cvs.addEventListener('touchend', e=>{ touchId=null; }, {passive:true});

document.addEventListener('keydown', e=>{
  if(e.code==='Space') input.boosting = true;
});
document.addEventListener('keyup', e=>{
  if(e.code==='Space') input.boosting = false;
});
boostPad.addEventListener('touchstart', ()=> input.boosting = true, {passive:true});
boostPad.addEventListener('touchend', ()=> input.boosting = false, {passive:true});

/* ====== сеть ====== */
function wsURL(){
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}
function connect(){
  WS = new WebSocket(wsURL());
  WS.onopen = ()=>{
    WS.send(JSON.stringify({t:'join', name: $('#name').value || 'Kosmos', color: $('#skin').value}));
  };
  WS.onmessage = (e)=>{
    const msg = JSON.parse(e.data);
    if(msg.t==='init'){
      MY_ID = msg.id;
      WORLD = msg.world;
      ME = msg.you;
      FOODS = msg.foods;
      POWERS = msg.powers;
      PLAYERS = msg.others;
    }else if(msg.t==='state'){
      lastStateTime = msg.time;
      PLAYERS = msg.players;
      FOODS = msg.foods;
      POWERS = msg.powers;
      renderLeaderboard(msg.lb);
      const me = PLAYERS.find(p=>p.id===MY_ID);
      if(me) ME = me;
    }else if(msg.t==='dead'){
      setTimeout(()=>{
        alert(`Ты погиб. Счёт: ${msg.score}`);
        WS.send(JSON.stringify({t:'respawn', name: $('#name').value, color: $('#skin').value}));
      },10);
    }
  };
  WS.onclose = ()=>{
    alert('Связь потеряна. Сервер недоступен.');
    document.body.classList.remove('playing');
    HUD.classList.remove('active');
  };
}

function sendInput(){
  if(!WS || WS.readyState!==1 || !ME) return;
  WS.send(JSON.stringify({
    t:'input',
    ang: input.ang,
    boosting: input.boosting,
    viewX: ME.x,
    viewY: ME.y
  }));
}
setInterval(sendInput, 50); // 20 Гц

/* ====== интерфейс ====== */
$('#play').addEventListener('click', ()=>{
  document.body.classList.add('playing');
  HUD.classList.add('active');
  resize();
  connect();
});
$('#exit').addEventListener('click', ()=>{
  document.body.classList.remove('playing');
  HUD.classList.remove('active');
  if(WS) try{ WS.close(); }catch{}
});

/* ====== холст ====== */
function resize(){ cvs.width = innerWidth; cvs.height = innerHeight; }
addEventListener('resize', resize);

/* ====== рисование ====== */
function drawStrip(x,y,r,color){
  const g = ctx.createLinearGradient(x-r,y-r,x+r,y+r);
  g.addColorStop(0, color);
  g.addColorStop(.5, '#ffffff22');
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}

function renderPlayers(){
  for(const p of PLAYERS){
    if(!p.alive) continue;
    // свечение
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.shadowColor = p.color; ctx.shadowBlur = 22;
    for(let i=0;i<p.seg.length;i+=2){
      const s = p.seg[i];
      ctx.beginPath(); ctx.arc(s.x - camera.x, s.y - camera.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.restore();

    // полосатое тело
    for(let i=0;i<p.seg.length;i++){
      const s = p.seg[i];
      drawStrip(s.x - camera.x, s.y - camera.y, p.r, p.color);
    }

    // глаза
    const h = p.seg[0];
    const dpx = Math.cos(p.dir), dpy = Math.sin(p.dir);
    const nx = -dpy, ny = dpx, off = p.r*0.62;
    const ex = h.x + nx*off,  ey = h.y + ny*off;
    const ex2= h.x - nx*off,  ey2= h.y - ny*off;
    const eye = p.r*0.45, pupil = eye*0.45;

    ctx.fillStyle='#fff';
    ctx.beginPath();
    ctx.arc(ex - camera.x + dpx*.6,  ey - camera.y + dpy*.6,  eye,   0,Math.PI*2);
    ctx.arc(ex2- camera.x + dpx*.6,  ey2- camera.y + dpy*.6,  eye,   0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle='#111';
    ctx.beginPath();
    ctx.arc(ex - camera.x + dpx*1.0, ey - camera.y + dpy*1.0, pupil, 0,Math.PI*2);
    ctx.arc(ex2- camera.x + dpx*1.0, ey2- camera.y + dpy*1.0, pupil, 0,Math.PI*2);
    ctx.fill();

    // имя
    ctx.font='700 13px system-ui,Arial';
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.lineWidth=2; ctx.strokeStyle='#08121f'; ctx.fillStyle='#e7f7ff';
    ctx.strokeText(p.name, h.x - camera.x, h.y - camera.y - p.r*1.7);
    ctx.fillText(p.name,  h.x - camera.x, h.y - camera.y - p.r*1.7);
  }
}

function renderFoods(){
  for(const f of FOODS){
    if(f.kind==='pellet'||f.kind==='meat'){
      ctx.beginPath();
      ctx.arc(f.x - camera.x, f.y - camera.y, f.kind==='pellet'?4:6, 0, Math.PI*2);
      ctx.fillStyle = f.kind==='pellet' ? '#00ffd5' : '#ffd36b';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = f.kind==='pellet'?10:14;
      ctx.fill(); ctx.shadowBlur=0;
    } else {
      ctx.fillStyle='#9cf';
      ctx.fillRect(f.x - camera.x - 2, f.y - camera.y - 2, 4, 4);
    }
  }
}

function renderPowers(){
  ctx.font='20px \"Apple Color Emoji\",\"Segoe UI Emoji\",system-ui';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  for(const p of POWERS){
    const emoji = p.kind==='ghost' ? '👻' : (p.kind==='magnet' ? '🧲' : '⚡');
    ctx.fillText(emoji, p.x - camera.x, p.y - camera.y + 1);
  }
}

const camera = {x:0,y:0};
function updateCamera(){
  if(!ME) return;
  camera.x = clamp(ME.x - cvs.width/2, 0, WORLD.w - cvs.width);
  camera.y = clamp(ME.y - cvs.height/2, 0, WORLD.h - cvs.height);
}

function renderBg(){
  ctx.fillStyle='#06101a';
  ctx.fillRect(0,0,cvs.width,cvs.height);
  const ox = -camera.x*0.2, oy = -camera.y*0.2;
  ctx.fillStyle='#ffffff18';
  for(let i=0;i<200;i++){
    const x = (i*137*13 + ox) % cvs.width;
    const y = (i*97*17 + oy)  % cvs.height;
    const fx = (x + cvs.width) % cvs.width;
    const fy = (y + cvs.height) % cvs.height;
    ctx.fillRect(fx, fy, 2, 2);
  }
}

function renderMinimap(){
  if(!ME) return;
  const r = mini.width/2;
  mctx.clearRect(0,0,mini.width,mini.height);
  mctx.save();
  mctx.translate(r,r);
  mctx.beginPath(); mctx.arc(0,0,r-1,0,Math.PI*2); mctx.clip();
  mctx.fillStyle='#0b1a2c'; mctx.fillRect(-r,-r,mini.width,mini.height);

  const scale = (r*0.9) / WORLD.w;
  mctx.fillStyle='#57e1ff';
  for(const p of POWERS){
    const x = (p.x - WORLD.w/2)*scale;
    const y = (p.y - WORLD.h/2)*scale;
    mctx.fillRect(x-1,y-1,2,2);
  }
  const hx = (ME.x - WORLD.w/2)*scale;
  const hy = (ME.y - WORLD.h/2)*scale;
  mctx.beginPath(); mctx.arc(hx,hy,3,0,Math.PI*2); mctx.fillStyle='#39f3ff'; mctx.fill();
  mctx.restore();
}

function renderLeaderboard(lb){
  lbEl.innerHTML = (lb||[]).map((e,i)=>`<span>${i+1}. ${e.name} — ${e.score}</span>`).join('');
}

function loop(){
  requestAnimationFrame(loop);
  if(!ME) return;
  updateCamera();
  renderBg();
  renderFoods();
  renderPowers();
  renderPlayers();
  renderMinimap();
  scoreEl.textContent = ME?.score || 0;
}
loop();
resize();
addEventListener('contextmenu', e=> e.preventDefault());
