'use strict';

// ================================================================
// CANVAS
// ================================================================
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

// ================================================================
// CONSTANTS
// ================================================================
const MAP         = 8000;
const G           = 500;

// Ship
const SHIP_R      = 8;
const THRUST      = 150;
const BOOST_MULT  = 2;
const ROT_SPEED   = 2.8;   // rad/s
const FUEL_MAX    = 1000;
const FUEL_RATE   = 45;    // per second, normal thrust
const FUEL_BOOST  = 135;   // per second, boost
const DEAD_DRIFT  = 30;    // seconds at zero fuel before death

// Camera / zoom
const ZOOM_MIN    = 0.25;
const ZOOM_MAX    = 2.0;
const ZOOM_STEP   = 0.12;
const ZOOM_DEF    = 1.0;

// Trajectory preview
const TRAJ_STEPS  = 500;
const TRAJ_DT     = 1 / 60;

// Comets
const COMET_SPD   = 290;
const COMET_MIN   = 9;
const COMET_MAX   = 18;
const COMET_LIFE  = 25;
const AIM_CHANCE  = 0.70;  // fraction that track the ship

// ================================================================
// PALETTE
// ================================================================
const PLANET_COLORS = ['#4488ff','#ff6644','#ffaa33','#44cc88','#cc88ff','#ff4488','#33ddff'];
const MOON_COLORS   = ['#aaaaaa','#bbbb99','#998877','#aabb99','#aa9988'];

// ================================================================
// DEATH MESSAGES
// ================================================================
const DEATHS = {
  star:     ["You flew into a star. Bold strategy.",
             "The star was not a destination.",
             "Nuclear fusion: not a spa treatment.",
             "10,000 solar masses. You had 1. Math happened."],
  planet:   ["The planet was not expecting visitors.",
             "You have discovered a new crater. It is named after you.",
             "Landed. Poorly.",
             "Planetary impact: 0/10, would not recommend."],
  moon:     ["Even the moon wins sometimes.",
             "Gravity assist? No. Gravity insist.",
             "Small body. Large consequences.",
             "It looked so harmless on the minimap."],
  asteroid: ["The asteroid was also just trying to get somewhere.",
             "Rock: 1. Ship: 0.",
             "You ignored the debris field. It did not ignore you.",
             "Asteroids do not yield the right of way."],
  comet:    ["The comet had somewhere to be. So did you. Same place.",
             "It moved faster than expected. You did not.",
             "Comets are beautiful. Especially the last one you see.",
             "Predicted trajectory: straight through you. Condolences."],
  fuel:     ["Fuel: 0. Dignity: also 0.",
             "You planned the mission. You forgot to plan for math.",
             "The void is quiet. Also permanent.",
             "No fuel. No thrust. No problem? Wrong.",
             "Your flight plan was ambitious. Thermodynamics disagreed."],
  oob:      ["You flew off the map. Brave. Incorrect.",
             "There is nothing out there. Now you are part of nothing.",
             "The edge of the known universe was not the objective.",
             "Navigation failure: destination was not 'the void'."],
};

function deathMsg(cause) {
  const pool = DEATHS[cause] || DEATHS.asteroid;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ================================================================
// SEEDABLE RNG
// ================================================================
let _rng = 0;
function seedRng(s) { _rng = (s >>> 0) || 1; }
function nr() {   // next random [0,1)
  _rng += 0x6D2B79F5;
  let t = _rng;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function rn(lo, hi) { return lo + nr() * (hi - lo); }
function ri(lo, hi) { return Math.floor(rn(lo, hi)); }
function ra()       { return nr() * Math.PI * 2; }

// ================================================================
// MATH HELPERS
// ================================================================
function dist(ax,ay,bx,by) { return Math.hypot(ax-bx,ay-by); }
function clamp(v,lo,hi)    { return v<lo?lo:v>hi?hi:v; }
function lerp(a,b,t)       { return a+(b-a)*t; }

function shadeColor(hex, amt) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgb(${clamp(r+amt,0,255)},${clamp(g+amt,0,255)},${clamp(b+amt,0,255)})`;
}

// ================================================================
// GAME STATE (single source of truth)
// ================================================================
let S = {};   // populated by initState() + genWorld()

function initState() {
  S = {
    phase: 'menu',   // 'menu'|'playing'|'paused'|'dead'|'win'
    runCount: 0,
    time: 0,

    bodies: [],
    comets: [],
    objectives: [],

    ship: { x:0,y:0,vx:0,vy:0,angle:0,fuel:FUEL_MAX,alive:true,
            thrusting:false,thrustDir:1,zeroFuelTimer:0 },

    cam: { x:0,y:0,zoom:ZOOM_DEF },
    showMinimap: true,
    cheat: false,

    cometTimer: 0,
    nextComet: rn(COMET_MIN,COMET_MAX),

    bgStars: [],
    death: null,
  };
}

// ================================================================
// WORLD GENERATION
// ================================================================
function genWorld() {
  seedRng(Date.now());

  S.bodies   = [];
  S.comets   = [];
  S.objectives = [];

  // Background stars (world-space so they parallax naturally)
  S.bgStars = [];
  for (let i=0;i<350;i++)
    S.bgStars.push({ x:nr()*MAP, y:nr()*MAP, r:nr()*1.5+0.3, a:nr()*0.7+0.3 });

  // ---- Star ----
  const sx = MAP/2 + rn(-300,300), sy = MAP/2 + rn(-300,300);
  S.bodies.push({ type:'star', x:sx,y:sy, mass:10000, radius:80,
                  color:'#fff5bb', glow:'#ff8800', parentIdx:-1 });

  // ---- Planets ----
  const rings  = [950,1400,1950,2550,3200];
  const pCount = ri(3,5);
  const pCols  = [...PLANET_COLORS].sort(() => nr()-0.5);
  const planetIdxs = [];

  for (let i=0;i<pCount;i++) {
    const ang = ra();
    const d   = rings[i] + rn(-100,100);
    const pi  = S.bodies.length;
    planetIdxs.push(pi);
    S.bodies.push({
      type:'planet',
      x: clamp(sx+Math.cos(ang)*d, 300, MAP-300),
      y: clamp(sy+Math.sin(ang)*d, 300, MAP-300),
      mass:1000, radius:rn(26,46),
      color:pCols[i], glow:pCols[i],
      parentIdx:0,
    });

    // ---- Moons ----
    const mCount = ri(1,4);
    for (let j=0;j<mCount;j++) {
      const orR = S.bodies[pi].radius + rn(35,110);
      const orA = ra();
      const orS = rn(0.4,1.0) * (nr()>0.5?1:-1);
      S.bodies.push({
        type:'moon',
        x: S.bodies[pi].x + Math.cos(orA)*orR,
        y: S.bodies[pi].y + Math.sin(orA)*orR,
        mass:100, radius:rn(9,17),
        color: MOON_COLORS[ri(0,MOON_COLORS.length)], glow:'#aaaaaa',
        parentIdx:pi, orbitR:orR, orbitAngle:orA, orbitSpeed:orS,
      });
    }
  }

  // ---- Asteroid clusters ----
  const asteroidIdxs = [];
  for (let c=0;c<ri(3,5);c++) {
    let cx,cy,att=0;
    do { cx=rn(400,MAP-400); cy=rn(400,MAP-400); att++; }
    while (dist(cx,cy,sx,sy)<700 && att<30);

    for (let j=0;j<ri(5,10);j++) {
      const ai = S.bodies.length;
      S.bodies.push({
        type:'asteroid',
        x: cx+rn(-180,180), y: cy+rn(-180,180),
        mass:10, radius:rn(6,13),
        color:'#887766', glow:'#99887a',
        isMining:false, vx:0, vy:0, parentIdx:-1,
      });
      asteroidIdxs.push(ai);
    }
  }

  // ---- Ship spawn ----
  const edge = ri(0,4);
  let sx2,sy2;
  if      (edge===0){ sx2=rn(150,500);        sy2=rn(150,MAP-150); }
  else if (edge===1){ sx2=rn(MAP-500,MAP-150); sy2=rn(150,MAP-150); }
  else if (edge===2){ sx2=rn(150,MAP-150);     sy2=rn(150,500); }
  else              { sx2=rn(150,MAP-150);     sy2=rn(MAP-500,MAP-150); }

  S.ship = {
    x:sx2, y:sy2, vx:0, vy:0,
    angle: Math.atan2(MAP/2-sy2, MAP/2-sx2) - Math.PI/2,
    fuel:FUEL_MAX, alive:true,
    thrusting:false, thrustDir:1, zeroFuelTimer:0,
  };

  S.cam.x = sx2; S.cam.y = sy2; S.cam.zoom = ZOOM_DEF;
  S.cometTimer = 0;
  S.nextComet  = rn(COMET_MIN,COMET_MAX);
  S.time = 0;

  // ---- Objectives ----
  genObjectives(planetIdxs, asteroidIdxs);
}

// ----------------------------------------------------------------
function safePos() {
  for (let a=0;a<200;a++) {
    const x=rn(400,MAP-400), y=rn(400,MAP-400);
    if (S.bodies.every(b=>dist(x,y,b.x,b.y)>b.radius+180)) return {x,y};
  }
  return { x:rn(400,MAP-400), y:rn(400,MAP-400) };
}

function genObjectives(planetIdxs, asteroidIdxs) {
  const tier = Math.min(4, 1+Math.floor(S.runCount/2));

  // T1: always REACH
  const sp = safePos();
  S.objectives.push({
    type:'reach', x:sp.x,y:sp.y,
    radius:45, label:'Reach Station Alpha',
    complete:false, fuelReward:0, color:'#00ffcc',
  });

  // T2: COLLECT or MINE
  if (tier>=2) {
    if (nr()>0.5 && asteroidIdxs.length>0) {
      const ai = asteroidIdxs[ri(0,asteroidIdxs.length)];
      S.bodies[ai].isMining = true;
      S.bodies[ai].vx = rn(-35,35);
      S.bodies[ai].vy = rn(-35,35);
      S.objectives.push({
        type:'mine', targetIdx:ai,
        label:'Mine Asteroid B-7 (stay close 3s)',
        complete:false, fuelReward:300, color:'#ffaa00',
        progress:0,
      });
    } else {
      const cp = safePos();
      S.objectives.push({
        type:'collect', x:cp.x,y:cp.y,
        radius:25, label:'Collect Resource Pod',
        complete:false, fuelReward:200, color:'#ffff44',
      });
    }
  }

  // T3: SLINGSHOT or ORBIT
  if (tier>=3 && nr()>0.35) {
    if (nr()>0.5 && planetIdxs.length>=2) {
      const n   = Math.min(2, planetIdxs.length);
      const tgts = [...planetIdxs].sort(()=>nr()-0.5).slice(0,n);
      S.objectives.push({
        type:'slingshot', targets:tgts, completed:new Set(),
        label:`Slingshot past ${n} planet${n>1?'s':''}`,
        complete:false, fuelReward:400, color:'#ff88ff',
      });
    } else if (planetIdxs.length>0) {
      const pi = planetIdxs[ri(0,planetIdxs.length)];
      S.objectives.push({
        type:'orbit', targetIdx:pi,
        label:'Establish orbit (5s)',
        complete:false, fuelReward:350, color:'#88ffff',
        timer:0, required:5,
      });
    }
  }

  // T4: second REACH or combined
  if (tier>=4 && nr()>0.5) {
    const fp = safePos();
    S.objectives.push({
      type:'reach', x:fp.x,y:fp.y,
      radius:45, label:'Reach Station Beta',
      complete:false, fuelReward:0, color:'#ff8844',
    });
  }
}

// ================================================================
// PHYSICS
// ================================================================
function gravAt(x,y) {
  let ax=0,ay=0;
  for (const b of S.bodies) {
    const dx=b.x-x, dy=b.y-y;
    const r2=dx*dx+dy*dy, r=Math.sqrt(r2);
    if (r<1) continue;
    const a=G*b.mass/r2;
    ax+=a*dx/r; ay+=a*dy/r;
  }
  return {ax,ay};
}

function updatePhysics(dt) {
  const sh = S.ship;
  if (!sh.alive) return;

  // Rotation
  if (keys.KeyA||keys.ArrowLeft)  sh.angle -= ROT_SPEED*dt;
  if (keys.KeyD||keys.ArrowRight) sh.angle += ROT_SPEED*dt;

  // Thrust
  const boosting = keys.ShiftLeft||keys.ShiftRight;
  let tAmt = 0;
  if (keys.KeyW||keys.ArrowUp)   tAmt =  1;
  if (keys.KeyS||keys.ArrowDown) tAmt = -0.4;

  sh.thrusting = false;
  if (tAmt !== 0 && sh.fuel > 0) {
    const thr = THRUST * (boosting ? BOOST_MULT : 1) * tAmt;
    sh.vx += Math.sin(sh.angle)*thr*dt;
    sh.vy -= Math.cos(sh.angle)*thr*dt;
    sh.fuel = Math.max(0, sh.fuel - (boosting?FUEL_BOOST:FUEL_RATE)*Math.abs(tAmt)*dt);
    sh.thrusting = true;
    sh.thrustDir = tAmt>0?1:-1;
  }

  // Zero-fuel death timer
  if (sh.fuel <= 0) {
    sh.zeroFuelTimer += dt;
    if (sh.zeroFuelTimer >= DEAD_DRIFT) { killShip('fuel'); return; }
  } else {
    sh.zeroFuelTimer = 0;
  }

  // Gravity
  const g = gravAt(sh.x,sh.y);
  sh.vx += g.ax*dt;
  sh.vy += g.ay*dt;

  // Integrate
  sh.x += sh.vx*dt;
  sh.y += sh.vy*dt;

  // Out of bounds
  if (sh.x<-100||sh.x>MAP+100||sh.y<-100||sh.y>MAP+100) { killShip('oob'); return; }

  // Body collisions
  for (const b of S.bodies) {
    if (dist(sh.x,sh.y,b.x,b.y)<b.radius+SHIP_R) { killShip(b.type); return; }
  }

  // Comet collisions
  for (const c of S.comets) {
    if (dist(sh.x,sh.y,c.x,c.y)<c.radius+SHIP_R) { killShip('comet'); return; }
  }
}

function killShip(cause) {
  S.ship.alive = false;
  S.phase = 'dead';
  S.death = { cause, message:deathMsg(cause) };
}

// ================================================================
// MOONS + MINING ASTEROIDS
// ================================================================
function updateBodies(dt) {
  for (const b of S.bodies) {
    if (b.type==='moon') {
      b.orbitAngle += b.orbitSpeed*dt;
      const p = S.bodies[b.parentIdx];
      b.x = p.x + Math.cos(b.orbitAngle)*b.orbitR;
      b.y = p.y + Math.sin(b.orbitAngle)*b.orbitR;
    }
    if (b.type==='asteroid' && b.isMining) {
      b.x += b.vx*dt; b.y += b.vy*dt;
      if (b.x<100||b.x>MAP-100) b.vx*=-1;
      if (b.y<100||b.y>MAP-100) b.vy*=-1;
    }
  }
}

// ================================================================
// COMETS
// ================================================================
function spawnComet() {
  const sh = S.ship;
  let cx,cy;
  const edge=ri(0,4);
  if      (edge===0){cx=rn(0,MAP);cy=-20;}
  else if (edge===1){cx=rn(0,MAP);cy=MAP+20;}
  else if (edge===2){cx=-20;       cy=rn(0,MAP);}
  else              {cx=MAP+20;    cy=rn(0,MAP);}

  let tx,ty;
  const aimed = Math.random()<AIM_CHANCE;
  if (aimed) {
    tx=sh.x+rn(-250,250); ty=sh.y+rn(-250,250);
  } else {
    tx=rn(400,MAP-400); ty=rn(400,MAP-400);
  }

  const len = Math.hypot(tx-cx,ty-cy)||1;
  const vx=(tx-cx)/len*COMET_SPD, vy=(ty-cy)/len*COMET_SPD;
  const trail=[];
  for(let i=0;i<25;i++) trail.push({x:cx,y:cy});

  S.comets.push({
    x:cx,y:cy,vx,vy,
    radius:10,life:COMET_LIFE,
    isFixed:!aimed,
    sx:cx,sy:cy,dx:vx/COMET_SPD,dy:vy/COMET_SPD,
    trail,
  });
}

function updateComets(dt) {
  S.cometTimer+=dt;
  if (S.cometTimer>=S.nextComet) {
    S.cometTimer=0;
    S.nextComet=rn(COMET_MIN,COMET_MAX);
    spawnComet();
  }
  for (let i=S.comets.length-1;i>=0;i--) {
    const c=S.comets[i];
    c.trail.unshift({x:c.x,y:c.y});
    if(c.trail.length>30) c.trail.pop();
    c.x+=c.vx*dt; c.y+=c.vy*dt;
    c.life-=dt;
    if(c.life<=0||c.x<-500||c.x>MAP+500||c.y<-500||c.y>MAP+500)
      S.comets.splice(i,1);
  }
}

// ================================================================
// OBJECTIVES
// ================================================================
function updateObjectives(dt) {
  const sh=S.ship;
  for (const obj of S.objectives) {
    if (obj.complete) continue;

    if (obj.type==='reach'||obj.type==='collect') {
      if (dist(sh.x,sh.y,obj.x,obj.y)<obj.radius) completObj(obj);
    }

    else if (obj.type==='mine') {
      const tgt=S.bodies[obj.targetIdx];
      const d=dist(sh.x,sh.y,tgt.x,tgt.y);
      if (d<tgt.radius+65) {
        obj.progress=Math.min(1,obj.progress+dt/3);
        if(obj.progress>=1) completObj(obj);
      } else {
        obj.progress=Math.max(0,obj.progress-dt*0.25);
      }
    }

    else if (obj.type==='slingshot') {
      for (const pi of obj.targets) {
        if (obj.completed.has(pi)) continue;
        const b=S.bodies[pi];
        if (dist(sh.x,sh.y,b.x,b.y)<b.radius*3.5) obj.completed.add(pi);
      }
      if (obj.completed.size>=obj.targets.length) completObj(obj);
    }

    else if (obj.type==='orbit') {
      const b=S.bodies[obj.targetIdx];
      const r=dist(sh.x,sh.y,b.x,b.y);
      const vCirc=Math.sqrt(G*b.mass/Math.max(r,1));
      const vShip=Math.hypot(sh.vx,sh.vy);
      // Also check tangential component
      const ux=(b.x-sh.x)/r, uy=(b.y-sh.y)/r;
      const vRad=sh.vx*ux+sh.vy*uy;
      const vTan=Math.sqrt(Math.max(0,vShip*vShip-vRad*vRad));
      const inR   = r>b.radius*3 && r<b.radius*8;
      const inV   = Math.abs(vTan-vCirc)/vCirc<0.45;
      if (inR&&inV) {
        obj.timer+=dt;
        if(obj.timer>=obj.required) completObj(obj);
      } else {
        obj.timer=Math.max(0,obj.timer-dt*0.5);
      }
    }
  }

  if (S.objectives.length>0 && S.objectives.every(o=>o.complete)) S.phase='win';
}

function completObj(obj) {
  obj.complete=true;
  if(obj.fuelReward>0)
    S.ship.fuel=Math.min(FUEL_MAX,S.ship.fuel+obj.fuelReward);
}

// ================================================================
// TRAJECTORY PREVIEW
// ================================================================
function computeTraj() {
  const pts=[]; let hit=false;
  let x=S.ship.x,y=S.ship.y,vx=S.ship.vx,vy=S.ship.vy;
  for (let i=0;i<TRAJ_STEPS;i++) {
    pts.push({x,y});
    let ax=0,ay=0;
    for (const b of S.bodies) {
      const dx=b.x-x,dy=b.y-y;
      const r2=dx*dx+dy*dy,r=Math.sqrt(r2);
      if(r<b.radius){hit=true;break;}
      const a=G*b.mass/r2;
      ax+=a*dx/r;ay+=a*dy/r;
    }
    if(hit) break;
    vx+=ax*TRAJ_DT;vy+=ay*TRAJ_DT;
    x+=vx*TRAJ_DT;y+=vy*TRAJ_DT;
    if(x<0||x>MAP||y<0||y>MAP) break;
  }
  return {pts,hit};
}

// ================================================================
// CAMERA
// ================================================================
function updateCam(dt) {
  S.cam.x=lerp(S.cam.x,S.ship.x,Math.min(1,8*dt));
  S.cam.y=lerp(S.cam.y,S.ship.y,Math.min(1,8*dt));
}

function w2s(wx,wy) {
  return {
    x:(wx-S.cam.x)*S.cam.zoom+canvas.width/2,
    y:(wy-S.cam.y)*S.cam.zoom+canvas.height/2,
  };
}

// ================================================================
// RENDER — WORLD
// ================================================================
function applyCamera() {
  ctx.translate(canvas.width/2, canvas.height/2);
  ctx.scale(S.cam.zoom, S.cam.zoom);
  ctx.translate(-S.cam.x,-S.cam.y);
}

function renderBgStars() {
  for (const s of S.bgStars) {
    ctx.globalAlpha=s.a;
    ctx.fillStyle='#ffffff';
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

function renderBodies() {
  for (const b of S.bodies) {
    const {x,y,radius:r}=b;

    if (b.type==='star') {
      // Outer corona
      const cg=ctx.createRadialGradient(x,y,r*0.5,x,y,r*5);
      cg.addColorStop(0,'rgba(255,150,0,0.25)');
      cg.addColorStop(1,'rgba(255,80,0,0)');
      ctx.fillStyle=cg;
      ctx.beginPath();ctx.arc(x,y,r*5,0,Math.PI*2);ctx.fill();
      // Surface
      const sg=ctx.createRadialGradient(x-r*.35,y-r*.35,r*.1,x,y,r);
      sg.addColorStop(0,'#ffffff');
      sg.addColorStop(0.35,'#ffee88');
      sg.addColorStop(1,'#ff6600');
      ctx.fillStyle=sg;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    } else if (b.type==='planet') {
      // Atmosphere glow
      const ag=ctx.createRadialGradient(x,y,r*.8,x,y,r*2.5);
      ag.addColorStop(0,b.color+'55');
      ag.addColorStop(1,b.color+'00');
      ctx.fillStyle=ag;
      ctx.beginPath();ctx.arc(x,y,r*2.5,0,Math.PI*2);ctx.fill();
      // Surface
      const pg=ctx.createRadialGradient(x-r*.3,y-r*.3,r*.05,x,y,r);
      pg.addColorStop(0,'#ffffff33');
      pg.addColorStop(0.3,b.color);
      pg.addColorStop(1,shadeColor(b.color,-45));
      ctx.fillStyle=pg;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    } else if (b.type==='moon') {
      ctx.fillStyle=b.color;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(0,0,0,0.38)';
      ctx.beginPath();ctx.arc(x+r*.32,y+r*.1,r,0,Math.PI*2);ctx.fill();

    } else if (b.type==='asteroid') {
      if (b.isMining) {
        // Pulsing ring
        const pulse=0.5+0.5*Math.sin(Date.now()/1000*3);
        ctx.strokeStyle=`rgba(255,170,0,${pulse})`;
        ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(x,y,r+9,0,Math.PI*2);ctx.stroke();
      }
      ctx.fillStyle=b.color;
      // Irregular polygon
      ctx.beginPath();
      const sides=6;
      for(let i=0;i<sides;i++){
        const a=(i/sides)*Math.PI*2;
        const rr=r*(0.68+0.32*Math.sin(i*2.5+x*0.01));
        const px=x+Math.cos(a)*rr, py=y+Math.sin(a)*rr;
        i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
      }
      ctx.closePath();ctx.fill();
    }
  }
}

function renderComets() {
  for (const c of S.comets) {
    // Warning line for fixed comets
    if (c.isFixed) {
      ctx.strokeStyle='rgba(100,200,255,0.18)';
      ctx.lineWidth=1;ctx.setLineDash([10,10]);
      ctx.beginPath();
      ctx.moveTo(c.sx,c.sy);
      ctx.lineTo(c.sx+c.dx*5000,c.sy+c.dy*5000);
      ctx.stroke();ctx.setLineDash([]);
    }
    // Trail
    if (c.trail.length>1) {
      ctx.beginPath();
      ctx.moveTo(c.trail[0].x,c.trail[0].y);
      for(let i=1;i<c.trail.length;i++) ctx.lineTo(c.trail[i].x,c.trail[i].y);
      ctx.strokeStyle='rgba(140,215,255,0.45)';
      ctx.lineWidth=3;ctx.stroke();
    }
    // Head glow
    const cg=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,c.radius*2.5);
    cg.addColorStop(0,'#ffffff');
    cg.addColorStop(0.4,'#aaddff');
    cg.addColorStop(1,'rgba(80,160,255,0)');
    ctx.fillStyle=cg;
    ctx.beginPath();ctx.arc(c.x,c.y,c.radius*2.5,0,Math.PI*2);ctx.fill();
  }
}

function renderObjMarkers() {
  const t=Date.now()/1000;
  for (const obj of S.objectives) {
    if(obj.complete) continue;
    const pulse=0.55+0.45*Math.sin(t*2);

    if (obj.type==='reach') {
      ctx.strokeStyle=obj.color;ctx.lineWidth=2;ctx.globalAlpha=pulse;
      ctx.beginPath();ctx.arc(obj.x,obj.y,obj.radius,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(obj.x-18,obj.y);ctx.lineTo(obj.x+18,obj.y);
      ctx.moveTo(obj.x,obj.y-18);ctx.lineTo(obj.x,obj.y+18);
      ctx.stroke();
      ctx.globalAlpha=1;
    }

    else if (obj.type==='collect') {
      ctx.strokeStyle=obj.color;ctx.lineWidth=2;ctx.globalAlpha=pulse;
      ctx.strokeRect(obj.x-13,obj.y-13,26,26);
      ctx.globalAlpha=1;
    }

    else if (obj.type==='mine') {
      const tgt=S.bodies[obj.targetIdx];
      if(obj.progress>0){
        ctx.strokeStyle=obj.color;ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(tgt.x,tgt.y,tgt.radius+14,-Math.PI/2,-Math.PI/2+obj.progress*Math.PI*2);
        ctx.stroke();
      }
    }

    else if (obj.type==='slingshot') {
      for(const pi of obj.targets){
        if(obj.completed.has(pi)) continue;
        const b=S.bodies[pi];
        ctx.strokeStyle=obj.color;ctx.lineWidth=2;
        ctx.setLineDash([8,6]);ctx.globalAlpha=pulse;
        ctx.beginPath();ctx.arc(b.x,b.y,b.radius*3.5,0,Math.PI*2);ctx.stroke();
        ctx.setLineDash([]);ctx.globalAlpha=1;
      }
    }

    else if (obj.type==='orbit') {
      const b=S.bodies[obj.targetIdx];
      ctx.strokeStyle=obj.color;ctx.lineWidth=1;ctx.globalAlpha=0.35;
      ctx.beginPath();ctx.arc(b.x,b.y,b.radius*3,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.arc(b.x,b.y,b.radius*8,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;
      if(obj.timer>0){
        ctx.strokeStyle=obj.color;ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(b.x,b.y,(b.radius*3+b.radius*8)/2,
          -Math.PI/2,-Math.PI/2+(obj.timer/obj.required)*Math.PI*2);
        ctx.stroke();
      }
    }
  }
}

function renderShip() {
  if(!S.ship.alive) return;
  const sh=S.ship;
  ctx.save();
  ctx.translate(sh.x,sh.y);
  ctx.rotate(sh.angle);

  // Flame
  if(sh.thrusting&&sh.fuel>0){
    const flicker=0.7+0.3*Math.sin(Date.now()/40);
    const flen=(sh.thrustDir>0?22:10)*flicker;
    const baseY=SHIP_R*sh.thrustDir;
    const tipY=baseY+flen*sh.thrustDir;
    const fg=ctx.createLinearGradient(0,baseY,0,tipY);
    fg.addColorStop(0,'rgba(255,210,60,0.95)');
    fg.addColorStop(0.5,'rgba(255,90,0,0.7)');
    fg.addColorStop(1,'rgba(255,30,0,0)');
    ctx.fillStyle=fg;
    ctx.beginPath();
    ctx.moveTo(-6,baseY);ctx.lineTo(6,baseY);ctx.lineTo(0,tipY);
    ctx.closePath();ctx.fill();
  }

  // Hull
  ctx.fillStyle='#e8e8ff';
  ctx.strokeStyle='#7799dd';
  ctx.lineWidth=1.2;
  ctx.beginPath();
  ctx.moveTo(0,-SHIP_R*1.6);
  ctx.lineTo(SHIP_R,SHIP_R);
  ctx.lineTo(-SHIP_R,SHIP_R);
  ctx.closePath();ctx.fill();ctx.stroke();

  // Cockpit
  ctx.fillStyle='#88bbff';
  ctx.beginPath();ctx.arc(0,-SHIP_R*.25,2.8,0,Math.PI*2);ctx.fill();

  ctx.restore();
}

function renderTraj() {
  const {pts,hit}=computeTraj();
  if(pts.length<2) return;
  ctx.save();
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.scale(S.cam.zoom,S.cam.zoom);
  ctx.translate(-S.cam.x,-S.cam.y);

  ctx.setLineDash([4,7]);
  ctx.strokeStyle='rgba(255,255,90,0.45)';
  ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();ctx.setLineDash([]);

  // Time markers every ~60 frames
  for(const f of [60,120,240,480]){
    if(f>=pts.length) break;
    const p=pts[f];
    ctx.fillStyle=`rgba(255,200,50,${0.9-f/550})`;
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();
  }
  // Impact marker
  if(hit){
    const p=pts[pts.length-1];
    ctx.strokeStyle='#ff4444';ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(p.x-6,p.y-6);ctx.lineTo(p.x+6,p.y+6);
    ctx.moveTo(p.x+6,p.y-6);ctx.lineTo(p.x-6,p.y+6);
    ctx.stroke();
  }
  ctx.restore();
}

// ================================================================
// HUD
// ================================================================
function renderHUD() {
  const cw=canvas.width, ch=canvas.height;
  const sh=S.ship;

  // ---- Fuel bar ----
  const fw=190,fh=14,fx=18,fy=18;
  ctx.fillStyle='#1a1a2a';ctx.fillRect(fx,fy,fw,fh);
  const fp=sh.fuel/FUEL_MAX;
  const fc=fp>0.5?'#44ff88':fp>0.25?'#ffaa00':'#ff4444';
  ctx.fillStyle=fc;ctx.fillRect(fx,fy,fw*fp,fh);
  ctx.strokeStyle='#445566';ctx.lineWidth=1;ctx.strokeRect(fx,fy,fw,fh);
  ctx.fillStyle='#99aacc';ctx.font='11px monospace';
  ctx.fillText('FUEL',fx+fw+8,fy+11);

  // Low fuel warning flash
  if(fp<0.15 && Math.floor(Date.now()/400)%2===0){
    ctx.fillStyle='rgba(255,60,60,0.18)';
    ctx.fillRect(0,0,cw,ch);
  }

  // Zero fuel drift countdown
  if(sh.fuel<=0&&sh.zeroFuelTimer>0){
    const sLeft=Math.ceil(DEAD_DRIFT-sh.zeroFuelTimer);
    ctx.fillStyle='#ff4444';ctx.font='bold 13px monospace';
    ctx.fillText(`DRIFTING — ${sLeft}s`,fx,fy+fh+18);
  } else {
    // Speed
    const spd=Math.hypot(sh.vx,sh.vy);
    ctx.fillStyle='#7788aa';ctx.font='11px monospace';
    ctx.fillText(`SPD ${spd.toFixed(0)}`,fx,fy+fh+18);
  }

  // ---- Objectives list ----
  ctx.font='12px monospace';
  const oy=fy+fh+40;
  for(let i=0;i<S.objectives.length;i++){
    const obj=S.objectives[i];
    ctx.fillStyle=obj.complete?'#338833':obj.color;
    let lbl=`${obj.complete?'✓':'○'} ${obj.label}`;
    if(!obj.complete){
      if(obj.type==='mine'&&obj.progress>0)
        lbl+=` [${(obj.progress*100).toFixed(0)}%]`;
      if(obj.type==='orbit'&&obj.timer>0)
        lbl+=` [${obj.timer.toFixed(1)}s]`;
      if(obj.type==='slingshot')
        lbl+=` [${obj.completed.size}/${obj.targets.length}]`;
    }
    ctx.fillText(lbl,fx,oy+i*20);

    // Off-screen direction arrow
    if(!obj.complete) {
      let tx,ty;
      if(obj.type==='mine')     { tx=S.bodies[obj.targetIdx].x; ty=S.bodies[obj.targetIdx].y; }
      else if(obj.type==='orbit'){ tx=S.bodies[obj.targetIdx].x; ty=S.bodies[obj.targetIdx].y; }
      else if(obj.type==='slingshot'){
        const pi=obj.targets.find(p=>!obj.completed.has(p));
        if(pi!=null){tx=S.bodies[pi].x;ty=S.bodies[pi].y;}
      }
      else { tx=obj.x; ty=obj.y; }
      if(tx!=null) drawArrow(tx,ty,obj.color);
    }
  }

  // ---- Cheat mode ----
  if(S.cheat){
    ctx.fillStyle='#ff4444';ctx.font='bold 13px monospace';
    ctx.textAlign='center';
    ctx.fillText('⚠ CHEAT MODE ON',cw/2,22);
    ctx.textAlign='left';
  }

  // ---- Zoom level ----
  ctx.fillStyle='#445';ctx.font='10px monospace';
  ctx.fillText(`×${S.cam.zoom.toFixed(2)}`,cw-60,ch-10);

  // ---- Controls hint ----
  ctx.fillStyle='rgba(80,80,100,0.55)';ctx.font='10px monospace';
  ctx.fillText('WASD:fly  SHIFT:boost  -/=:zoom  M:map  `:cheat  R:restart  ESC:pause',18,ch-10);

  // ---- Minimap ----
  if(S.showMinimap) renderMinimap();
}

function drawArrow(wx,wy,color){
  const cw=canvas.width,ch=canvas.height,m=35;
  const sp=w2s(wx,wy);
  if(sp.x>m&&sp.x<cw-m&&sp.y>m&&sp.y<ch-m) return;
  const ang=Math.atan2(wy-S.cam.y,wx-S.cam.x);
  const ax=clamp(canvas.width/2+Math.cos(ang)*190,m,cw-m);
  const ay=clamp(canvas.height/2+Math.sin(ang)*190,m,ch-m);
  const d=dist(S.ship.x,S.ship.y,wx,wy);
  ctx.save();ctx.translate(ax,ay);ctx.rotate(ang);
  ctx.fillStyle=color;ctx.globalAlpha=0.8;
  ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(-7,-7);ctx.lineTo(-7,7);ctx.closePath();ctx.fill();
  ctx.globalAlpha=1;ctx.rotate(-ang);
  ctx.fillStyle=color;ctx.font='10px monospace';
  ctx.fillText(d.toFixed(0),-16,22);
  ctx.restore();
}

function renderMinimap(){
  const mm=150, mx=canvas.width-mm-12, my=canvas.height-mm-28;
  const sc=mm/MAP;
  ctx.fillStyle='rgba(0,0,18,0.72)';ctx.fillRect(mx,my,mm,mm);
  ctx.strokeStyle='#223344';ctx.lineWidth=1;ctx.strokeRect(mx,my,mm,mm);

  for(const b of S.bodies){
    const bx=mx+b.x*sc,by=my+b.y*sc;
    const br=Math.max(1.5,b.radius*sc*2.5);
    ctx.fillStyle=b.type==='star'?'#ffdd44':
                  b.type==='planet'?b.color:
                  b.type==='moon'?'#888888':'#554433';
    ctx.beginPath();ctx.arc(bx,by,br,0,Math.PI*2);ctx.fill();
  }
  for(const c of S.comets){
    ctx.fillStyle='#aaddff';
    ctx.beginPath();ctx.arc(mx+c.x*sc,my+c.y*sc,1.5,0,Math.PI*2);ctx.fill();
  }
  for(const obj of S.objectives){
    if(obj.complete) continue;
    let ox=obj.x,oy=obj.y;
    if(obj.type==='mine'||obj.type==='orbit')
      { ox=S.bodies[obj.targetIdx].x; oy=S.bodies[obj.targetIdx].y; }
    else if(obj.type==='slingshot'){
      const pi=obj.targets.find(p=>!obj.completed.has(p));
      if(pi!=null){ox=S.bodies[pi].x;oy=S.bodies[pi].y;}
    }
    if(ox==null) continue;
    ctx.fillStyle=obj.color;
    ctx.beginPath();ctx.arc(mx+ox*sc,my+oy*sc,3.5,0,Math.PI*2);ctx.fill();
  }
  // Ship dot
  ctx.fillStyle='#ffffff';
  ctx.beginPath();ctx.arc(mx+S.ship.x*sc,my+S.ship.y*sc,3,0,Math.PI*2);ctx.fill();

  ctx.fillStyle='#445566';ctx.font='9px monospace';
  ctx.fillText('M:hide',mx+2,my+mm+14);
}

// ================================================================
// SCREENS
// ================================================================
function renderMenu(){
  const cw=canvas.width,ch=canvas.height;
  // Animated bg stars (screen space)
  for(const s of S.bgStars){
    ctx.globalAlpha=s.a*0.6;
    ctx.fillStyle='#ffffff';
    ctx.beginPath();ctx.arc(s.x%cw,s.y%ch,s.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;

  ctx.textAlign='center';
  ctx.fillStyle='#5599ff';
  ctx.font='bold 62px monospace';
  ctx.fillText('SPACEHACKER',cw/2,ch/2-90);

  ctx.fillStyle='#667788';
  ctx.font='17px monospace';
  ctx.fillText('pilot a ship through the solar system',cw/2,ch/2-32);
  ctx.fillText('plan gravity assists · reach objectives · survive',cw/2,ch/2-4);

  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(80,255,140,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='bold 22px monospace';
  ctx.fillText('PRESS ENTER TO LAUNCH',cw/2,ch/2+58);

  ctx.fillStyle='#334455';
  ctx.font='11px monospace';
  ctx.fillText('WASD: thrust & rotate   SHIFT: boost   -/=: zoom   `: cheat mode',cw/2,ch/2+106);
  ctx.textAlign='left';
}

function renderDead(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(18,0,0,0.86)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';

  ctx.fillStyle='#ff3333';
  ctx.font='bold 52px monospace';
  ctx.fillText('SHIP DESTROYED',cw/2,ch/2-110);

  const causeLabels={
    star:'struck a star',planet:'planetary collision',moon:'moon impact',
    asteroid:'asteroid strike',comet:'comet impact',
    fuel:'fuel exhausted',oob:'lost in the void',
  };
  ctx.fillStyle='#ffaa44';ctx.font='17px monospace';
  ctx.fillText(`Cause: ${causeLabels[S.death.cause]||'unknown forces'}`,cw/2,ch/2-60);

  ctx.fillStyle='#ddddee';ctx.font='italic 20px serif';
  ctx.fillText(`"${S.death.message}"`,cw/2,ch/2-8);

  // Stats
  ctx.fillStyle='#556677';ctx.font='14px monospace';
  ctx.fillText(`time: ${S.time.toFixed(1)}s   objectives: ${S.objectives.filter(o=>o.complete).length}/${S.objectives.length}`,cw/2,ch/2+38);

  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(180,180,200,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='17px monospace';
  ctx.fillText('ENTER: new mission    ESC: menu',cw/2,ch/2+82);
  ctx.textAlign='left';
}

function renderWin(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(0,18,0,0.86)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';

  ctx.fillStyle='#44ff88';
  ctx.font='bold 52px monospace';
  ctx.fillText('MISSION COMPLETE',cw/2,ch/2-100);

  ctx.fillStyle='#aaffcc';ctx.font='17px monospace';
  ctx.fillText(`Fuel remaining: ${S.ship.fuel.toFixed(0)} / ${FUEL_MAX}`,cw/2,ch/2-44);
  ctx.fillText(`Time: ${S.time.toFixed(1)}s`,cw/2,ch/2-16);

  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(80,255,140,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='18px monospace';
  ctx.fillText('ENTER: new mission    ESC: menu',cw/2,ch/2+60);
  ctx.textAlign='left';
}

function renderPause(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(0,0,0,0.62)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';
  ctx.fillStyle='#ddddff';ctx.font='bold 46px monospace';
  ctx.fillText('PAUSED',cw/2,ch/2);
  ctx.fillStyle='#778899';ctx.font='17px monospace';
  ctx.fillText('ESC to resume',cw/2,ch/2+54);
  ctx.textAlign='left';
}

// ================================================================
// MASTER RENDER
// ================================================================
function render(){
  ctx.fillStyle='#00000a';ctx.fillRect(0,0,canvas.width,canvas.height);

  if(S.phase==='menu'){ renderMenu(); return; }

  // World pass
  ctx.save();applyCamera();
  renderBgStars();
  renderBodies();
  renderComets();
  renderObjMarkers();
  if(S.ship.alive) renderShip();
  ctx.restore();

  // Trajectory overlay (cheat mode)
  if(S.cheat&&S.ship.alive&&S.phase==='playing') renderTraj();

  // HUD (screen space)
  if(S.phase==='playing'||S.phase==='paused') renderHUD();

  if(S.phase==='paused') renderPause();
  if(S.phase==='dead')  { renderHUD(); renderDead(); }
  if(S.phase==='win')   { renderHUD(); renderWin();  }
}

// ================================================================
// INPUT
// ================================================================
const keys={};
window.addEventListener('keydown',e=>{
  keys[e.code]=true;

  switch(e.code){
    case 'Escape':
      if(S.phase==='playing')      S.phase='paused';
      else if(S.phase==='paused')  S.phase='playing';
      else if(S.phase==='dead'||S.phase==='win') S.phase='menu';
      break;
    case 'Enter':case 'NumpadEnter':
      if(S.phase==='menu') startRun();
      else if(S.phase==='dead'||S.phase==='win') startRun();
      break;
    case 'KeyR':
      if(S.phase==='playing'||S.phase==='paused') startRun();
      break;
    case 'Backquote':
      if(S.phase==='playing') S.cheat=!S.cheat;
      break;
    case 'Minus':
      if(S.phase==='playing'||S.phase==='paused')
        S.cam.zoom=Math.max(ZOOM_MIN,+(S.cam.zoom-ZOOM_STEP).toFixed(2));
      break;
    case 'Equal':case 'Plus':
      if(S.phase==='playing'||S.phase==='paused')
        S.cam.zoom=Math.min(ZOOM_MAX,+(S.cam.zoom+ZOOM_STEP).toFixed(2));
      break;
    case 'KeyM':
      S.showMinimap=!S.showMinimap;
      break;
  }
});
window.addEventListener('keyup',e=>{ keys[e.code]=false; });

// Prevent default for game keys (arrow scroll etc.)
window.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))
    e.preventDefault();
},{passive:false});

// ================================================================
// GAME LOOP
// ================================================================
let lastTs=0;

function startRun(){
  if(S.phase==='dead'||S.phase==='win') S.runCount=(S.runCount||0)+1;
  S.phase='playing';
  S.cheat=false;
  S.showMinimap=true;
  genWorld();
}

function loop(ts){
  const dt=Math.min((ts-lastTs)/1000,0.05);
  lastTs=ts;

  if(S.phase==='playing'){
    S.time+=dt;
    updateCam(dt);
    updateBodies(dt);
    updateComets(dt);
    updatePhysics(dt);
    updateObjectives(dt);
  }

  render();
  requestAnimationFrame(loop);
}

// ================================================================
// INIT
// ================================================================
function init(){
  initState();
  // Preload some bg stars so menu isn't blank
  S.bgStars=[];
  for(let i=0;i<200;i++)
    S.bgStars.push({x:Math.random()*MAP,y:Math.random()*MAP,r:Math.random()*1.5+0.3,a:Math.random()*0.7+0.3});
  requestAnimationFrame(ts=>{lastTs=ts;loop(ts);});
}

init();
