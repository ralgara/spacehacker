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
const ROT_SPEED   = 2.8;
const FUEL_MAX    = 1000;
const FUEL_RATE   = 45;
const FUEL_BOOST  = 135;
const DEAD_DRIFT  = 30;

// Visual scale (draw radius = physics radius × DRAW_SCALE)
const DRAW_SCALE  = 2.5;

// Camera / zoom
const ZOOM_MIN    = 0.25;
const ZOOM_MAX    = 2.0;
const ZOOM_STEP   = 0.12;
const ZOOM_DEF    = 1.0;

// Trajectory
const TRAJ_STEPS  = 500;
const TRAJ_DT     = 1 / 60;

// Comets
const COMET_SPD   = 290;
const COMET_MIN   = 9;
const COMET_MAX   = 18;
const COMET_LIFE  = 25;
const AIM_CHANCE  = 0.70;

// Lasers
const LASER_FUEL  = 15;
const LASER_COOL  = 0.3;
const LASER_RANGE = 1400;

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
function nr() {
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

// Segment vs circle intersection (parametric)
function lineCircleHit(x1,y1,x2,y2,cx,cy,r) {
  const dx=x2-x1, dy=y2-y1;
  const fx=x1-cx, fy=y1-cy;
  const a=dx*dx+dy*dy;
  const b=2*(fx*dx+fy*dy);
  const c=fx*fx+fy*fy-r*r;
  let disc=b*b-4*a*c;
  if(disc<0) return false;
  disc=Math.sqrt(disc);
  const t1=(-b-disc)/(2*a), t2=(-b+disc)/(2*a);
  return (t1>=0&&t1<=1)||(t2>=0&&t2<=1);
}

// ================================================================
// AUDIO
// ================================================================
let AUD = null;

function initAudio() {
  if (AUD) { try { AUD.ctx.resume(); } catch(_){} return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain
    const master = ctx.createGain();
    master.gain.value = 0.38;
    master.connect(ctx.destination);

    // Reverb: simple delay+feedback loop
    const revDelay = ctx.createDelay(1.5);
    revDelay.delayTime.value = 0.44;
    const revFB = ctx.createGain();
    revFB.gain.value = 0.48;
    const revOut = ctx.createGain();
    revOut.gain.value = 0.28;
    revDelay.connect(revFB);
    revFB.connect(revDelay);
    revDelay.connect(revOut);
    revOut.connect(master);

    // Main low-pass filter (controls warmth)
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    filt.Q.value = 1.2;
    filt.connect(master);
    filt.connect(revDelay);

    // Ambient pad — Cmaj9 chord with vibrato per voice
    const chord = [130.81, 164.81, 196.00, 246.94, 329.63];
    const padOscs = chord.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i < 3 ? 'sine' : 'triangle';
      osc.frequency.value = freq;

      // Per-voice vibrato
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.4 + i * 0.35;
      vib.type = 'sine';
      const vibG = ctx.createGain();
      vibG.gain.value = freq * 0.0028;
      vib.connect(vibG);
      vibG.connect(osc.frequency);
      vib.start();

      const g = ctx.createGain();
      g.gain.value = 0.057 - i * 0.007;
      osc.connect(g);
      g.connect(filt);
      osc.start();
      return { osc, gain: g, baseFreq: freq };
    });

    // Global tremolo LFO
    const tremLFO = ctx.createOscillator();
    tremLFO.frequency.value = 0.055;
    tremLFO.type = 'sine';
    const tremG = ctx.createGain();
    tremG.gain.value = 0.012;
    tremLFO.connect(tremG);
    padOscs.forEach(p => tremG.connect(p.gain.gain));
    tremLFO.start();

    // Thrust: looping bandpass noise
    const nBuf = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
      return b;
    })();
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf; nSrc.loop = true;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass'; nFilt.frequency.value = 340; nFilt.Q.value = 2.5;
    const nGain = ctx.createGain();
    nGain.gain.value = 0;
    nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(master);
    nSrc.start();

    AUD = { ctx, master, filt, padOscs, nGain, nFilt };
  } catch(e) {
    console.warn('Web Audio unavailable:', e);
    AUD = null;
  }
}

function updateAudio(dt) {
  if (!AUD || S.phase !== 'playing') return;
  const sh = S.ship;
  const t  = AUD.ctx.currentTime;

  // Nearest massive body → filter warmth
  let minD = Infinity;
  for (const b of S.bodies) {
    const d = dist(sh.x,sh.y,b.x,b.y) - b.radius;
    if (d < minD) minD = d;
  }
  const prox   = clamp(1 - minD / 1600, 0, 1);
  const cutoff = 350 + (1 - prox) * 1300;
  AUD.filt.frequency.setTargetAtTime(cutoff, t, 0.6);

  // Pitch detune deeper near massive bodies
  AUD.padOscs.forEach((p, i) => {
    AUD.padOscs[i].osc.detune.setTargetAtTime(-prox * 180 + i * 5, t, 1.2);
  });

  // Thrust noise
  const thrusting = sh.thrusting && sh.fuel > 0;
  AUD.nGain.gain.setTargetAtTime(thrusting ? 0.14 : 0, t, 0.08);
}

function playChime() {
  if (!AUD) return;
  const c = AUD.ctx;
  [261.63, 329.63, 392.00, 523.25].forEach((freq, i) => {
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    osc.connect(g); g.connect(AUD.master);
    const t = c.currentTime + i * 0.11;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    osc.start(t); osc.stop(t + 0.7);
  });
}

function playLaserSfx() {
  if (!AUD) return;
  const c = AUD.ctx;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.14);
  osc.connect(g); g.connect(AUD.master);
  g.gain.setValueAtTime(0.22, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
  osc.start(); osc.stop(c.currentTime + 0.15);
}

function playHitSfx() {
  if (!AUD) return;
  const c = AUD.ctx;
  // Short noise burst
  const buf = c.createBuffer(1, c.sampleRate * 0.08, c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const flt = c.createBiquadFilter();
  flt.type = 'bandpass'; flt.frequency.value = 800; flt.Q.value = 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
  src.connect(flt); flt.connect(g); g.connect(AUD.master);
  src.start(); src.stop(c.currentTime + 0.1);
}

function playDeathSfx() {
  if (!AUD) return;
  const c = AUD.ctx;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, c.currentTime + 2.0);
  osc.connect(g); g.connect(AUD.master);
  g.gain.setValueAtTime(0.45, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 2.0);
  osc.start(); osc.stop(c.currentTime + 2.1);
}

// ================================================================
// GAME STATE
// ================================================================
let S = {};

function initState() {
  S = {
    phase: 'menu',
    runCount: 0,
    time: 0,
    bodies: [], comets: [], objectives: [], lasers: [],
    ship: { x:0,y:0,vx:0,vy:0,angle:0,fuel:FUEL_MAX,alive:true,
            thrusting:false,thrustDir:1,zeroFuelTimer:0,laserCooldown:0 },
    cam: { x:0,y:0,zoom:ZOOM_DEF },
    showMinimap: true,
    cheat: false,
    cometTimer:0, nextComet:rn(COMET_MIN,COMET_MAX),
    bgStars: [],
    death: null,
  };
}

// ================================================================
// WORLD GENERATION
// ================================================================
function genWorld() {
  seedRng(Date.now());
  S.bodies=[]; S.comets=[]; S.objectives=[]; S.lasers=[];

  S.bgStars=[];
  for(let i=0;i<350;i++)
    S.bgStars.push({x:nr()*MAP,y:nr()*MAP,r:nr()*1.5+0.3,a:nr()*0.7+0.3});

  // Star
  const sx=MAP/2+rn(-300,300), sy=MAP/2+rn(-300,300);
  S.bodies.push({type:'star',x:sx,y:sy,mass:10000,radius:80,color:'#fff5bb',glow:'#ff8800',parentIdx:-1});

  // Planets
  const rings=[950,1400,1950,2550,3200];
  const pCount=ri(3,5);
  const pCols=[...PLANET_COLORS].sort(()=>nr()-0.5);
  const planetIdxs=[];

  for(let i=0;i<pCount;i++){
    const ang=ra(), d=rings[i]+rn(-100,100);
    const pi=S.bodies.length;
    planetIdxs.push(pi);
    S.bodies.push({
      type:'planet',
      x:clamp(sx+Math.cos(ang)*d,300,MAP-300),
      y:clamp(sy+Math.sin(ang)*d,300,MAP-300),
      mass:1000,radius:rn(26,46),color:pCols[i],glow:pCols[i],parentIdx:0,
    });

    // Moons
    for(let j=0;j<ri(1,4);j++){
      const orR=S.bodies[pi].radius+rn(35,110);
      const orA=ra(), orS=rn(0.4,1.0)*(nr()>0.5?1:-1);
      S.bodies.push({
        type:'moon',
        x:S.bodies[pi].x+Math.cos(orA)*orR,
        y:S.bodies[pi].y+Math.sin(orA)*orR,
        mass:100,radius:rn(9,17),
        color:MOON_COLORS[ri(0,MOON_COLORS.length)],glow:'#aaaaaa',
        parentIdx:pi,orbitR:orR,orbitAngle:orA,orbitSpeed:orS,
      });
    }
  }

  // Asteroid clusters
  const asteroidIdxs=[];
  for(let c=0;c<ri(3,5);c++){
    let cx,cy,att=0;
    do{cx=rn(400,MAP-400);cy=rn(400,MAP-400);att++;}
    while(dist(cx,cy,sx,sy)<700&&att<30);
    for(let j=0;j<ri(5,10);j++){
      const ai=S.bodies.length;
      S.bodies.push({
        type:'asteroid',
        x:cx+rn(-180,180),y:cy+rn(-180,180),
        mass:10,radius:rn(6,13),color:'#887766',glow:'#99887a',
        isMining:false,vx:0,vy:0,parentIdx:-1,
      });
      asteroidIdxs.push(ai);
    }
  }

  // Ship spawn
  const edge=ri(0,4);
  let sx2,sy2;
  if      (edge===0){sx2=rn(150,500);        sy2=rn(150,MAP-150);}
  else if (edge===1){sx2=rn(MAP-500,MAP-150);sy2=rn(150,MAP-150);}
  else if (edge===2){sx2=rn(150,MAP-150);    sy2=rn(150,500);}
  else              {sx2=rn(150,MAP-150);    sy2=rn(MAP-500,MAP-150);}

  S.ship={
    x:sx2,y:sy2,vx:0,vy:0,
    angle:Math.atan2(MAP/2-sy2,MAP/2-sx2)-Math.PI/2,
    fuel:FUEL_MAX,alive:true,
    thrusting:false,thrustDir:1,zeroFuelTimer:0,laserCooldown:0,
  };
  S.cam.x=sx2; S.cam.y=sy2; S.cam.zoom=ZOOM_DEF;
  S.cometTimer=0; S.nextComet=rn(COMET_MIN,COMET_MAX);
  S.time=0;

  genObjectives(planetIdxs,asteroidIdxs);
}

function safePos(){
  for(let a=0;a<200;a++){
    const x=rn(400,MAP-400),y=rn(400,MAP-400);
    if(S.bodies.every(b=>dist(x,y,b.x,b.y)>b.radius+180)) return {x,y};
  }
  return{x:rn(400,MAP-400),y:rn(400,MAP-400)};
}

function genObjectives(planetIdxs,asteroidIdxs){
  S.objectives=[];
  const tier=Math.min(4,1+Math.floor(S.runCount/2));

  const sp=safePos();
  S.objectives.push({type:'reach',x:sp.x,y:sp.y,radius:45,label:'Reach Station Alpha',complete:false,fuelReward:0,color:'#00ffcc'});

  if(tier>=2){
    if(nr()>0.5&&asteroidIdxs.length>0){
      const ai=asteroidIdxs[ri(0,asteroidIdxs.length)];
      S.bodies[ai].isMining=true; S.bodies[ai].vx=rn(-35,35); S.bodies[ai].vy=rn(-35,35);
      S.objectives.push({type:'mine',targetIdx:ai,label:'Mine Asteroid B-7 (stay close 3s)',complete:false,fuelReward:300,color:'#ffaa00',progress:0});
    } else {
      const cp=safePos();
      S.objectives.push({type:'collect',x:cp.x,y:cp.y,radius:25,label:'Collect Resource Pod',complete:false,fuelReward:200,color:'#ffff44'});
    }
  }

  if(tier>=3&&nr()>0.35){
    if(nr()>0.5&&planetIdxs.length>=2){
      const n=Math.min(2,planetIdxs.length);
      const tgts=[...planetIdxs].sort(()=>nr()-0.5).slice(0,n);
      S.objectives.push({type:'slingshot',targets:tgts,completed:new Set(),label:`Slingshot past ${n} planet${n>1?'s':''}`,complete:false,fuelReward:400,color:'#ff88ff'});
    } else if(planetIdxs.length>0){
      const pi=planetIdxs[ri(0,planetIdxs.length)];
      S.objectives.push({type:'orbit',targetIdx:pi,label:'Establish orbit (5s)',complete:false,fuelReward:350,color:'#88ffff',timer:0,required:5});
    }
  }

  if(tier>=4&&nr()>0.5){
    const fp=safePos();
    S.objectives.push({type:'reach',x:fp.x,y:fp.y,radius:45,label:'Reach Station Beta',complete:false,fuelReward:0,color:'#ff8844'});
  }
}

// ================================================================
// PHYSICS
// ================================================================
function gravAt(x,y){
  let ax=0,ay=0;
  for(const b of S.bodies){
    const dx=b.x-x,dy=b.y-y,r2=dx*dx+dy*dy,r=Math.sqrt(r2);
    if(r<1) continue;
    const a=G*b.mass/r2;
    ax+=a*dx/r; ay+=a*dy/r;
  }
  return{ax,ay};
}

function updatePhysics(dt){
  const sh=S.ship;
  if(!sh.alive) return;

  if(sh.laserCooldown>0) sh.laserCooldown-=dt;

  if(keys.KeyA||keys.ArrowLeft)  sh.angle-=ROT_SPEED*dt;
  if(keys.KeyD||keys.ArrowRight) sh.angle+=ROT_SPEED*dt;

  const boosting=keys.ShiftLeft||keys.ShiftRight;
  let tAmt=0;
  if(keys.KeyW||keys.ArrowUp)   tAmt= 1;
  if(keys.KeyS||keys.ArrowDown) tAmt=-0.4;

  sh.thrusting=false;
  if(tAmt!==0&&sh.fuel>0){
    const thr=THRUST*(boosting?BOOST_MULT:1)*tAmt;
    sh.vx+=Math.sin(sh.angle)*thr*dt;
    sh.vy-=Math.cos(sh.angle)*thr*dt;
    sh.fuel=Math.max(0,sh.fuel-(boosting?FUEL_BOOST:FUEL_RATE)*Math.abs(tAmt)*dt);
    sh.thrusting=true; sh.thrustDir=tAmt>0?1:-1;
  }

  if(sh.fuel<=0){
    sh.zeroFuelTimer+=dt;
    if(sh.zeroFuelTimer>=DEAD_DRIFT){killShip('fuel');return;}
  } else {
    sh.zeroFuelTimer=0;
  }

  const g=gravAt(sh.x,sh.y);
  sh.vx+=g.ax*dt; sh.vy+=g.ay*dt;
  sh.x+=sh.vx*dt; sh.y+=sh.vy*dt;

  if(sh.x<-100||sh.x>MAP+100||sh.y<-100||sh.y>MAP+100){killShip('oob');return;}
  for(const b of S.bodies){
    if(dist(sh.x,sh.y,b.x,b.y)<b.radius+SHIP_R){killShip(b.type);return;}
  }
  for(const c of S.comets){
    if(dist(sh.x,sh.y,c.x,c.y)<c.radius+SHIP_R){killShip('comet');return;}
  }
}

function killShip(cause){
  S.ship.alive=false; S.phase='dead';
  S.death={cause,message:deathMsg(cause)};
  playDeathSfx();
}

// ================================================================
// LASERS
// ================================================================
function fireLaser(){
  const sh=S.ship;
  if(sh.laserCooldown>0||sh.fuel<LASER_FUEL||!sh.alive) return;
  sh.fuel-=LASER_FUEL;
  sh.laserCooldown=LASER_COOL;

  const dx=Math.sin(sh.angle), dy=-Math.cos(sh.angle);
  const ox=sh.x+dx*SHIP_R*2, oy=sh.y+dy*SHIP_R*2;
  const ex=sh.x+dx*LASER_RANGE, ey=sh.y+dy*LASER_RANGE;

  let hitX=ex,hitY=ey,hitFx=false;

  // Check asteroids
  for(let i=S.bodies.length-1;i>=0;i--){
    const b=S.bodies[i];
    if(b.type!=='asteroid') continue;
    if(lineCircleHit(ox,oy,ex,ey,b.x,b.y,b.radius)){
      hitX=b.x;hitY=b.y;hitFx=true;
      // Invalidate mine objective if needed
      for(const obj of S.objectives){
        if(obj.type==='mine'&&obj.targetIdx===i){
          obj.targetIdx=-1;obj.complete=true; // lost target = auto-complete to unblock
        }
        if(obj.targetIdx!==undefined&&obj.targetIdx>i) obj.targetIdx--;
      }
      S.bodies.splice(i,1);
      break;
    }
  }

  // Check comets (only if asteroid not already hit)
  if(!hitFx){
    for(let i=S.comets.length-1;i>=0;i--){
      const c=S.comets[i];
      if(lineCircleHit(ox,oy,ex,ey,c.x,c.y,c.radius)){
        hitX=c.x;hitY=c.y;hitFx=true;
        S.comets.splice(i,1);
        break;
      }
    }
  }

  S.lasers.push({ox,oy,ex:hitX,ey:hitY,life:0.18,maxLife:0.18,hit:hitFx});
  playLaserSfx();
  if(hitFx) playHitSfx();
}

function updateLasers(dt){
  for(let i=S.lasers.length-1;i>=0;i--){
    S.lasers[i].life-=dt;
    if(S.lasers[i].life<=0) S.lasers.splice(i,1);
  }
}

// ================================================================
// MOONS & MINING ASTEROIDS
// ================================================================
function updateBodies(dt){
  for(const b of S.bodies){
    if(b.type==='moon'){
      b.orbitAngle+=b.orbitSpeed*dt;
      const p=S.bodies[b.parentIdx];
      b.x=p.x+Math.cos(b.orbitAngle)*b.orbitR;
      b.y=p.y+Math.sin(b.orbitAngle)*b.orbitR;
    }
    if(b.type==='asteroid'&&b.isMining){
      b.x+=b.vx*dt; b.y+=b.vy*dt;
      if(b.x<100||b.x>MAP-100) b.vx*=-1;
      if(b.y<100||b.y>MAP-100) b.vy*=-1;
    }
  }
}

// ================================================================
// COMETS
// ================================================================
function spawnComet(){
  const sh=S.ship;
  let cx,cy;
  const edge=ri(0,4);
  if      (edge===0){cx=rn(0,MAP);cy=-20;}
  else if (edge===1){cx=rn(0,MAP);cy=MAP+20;}
  else if (edge===2){cx=-20;      cy=rn(0,MAP);}
  else              {cx=MAP+20;   cy=rn(0,MAP);}

  const aimed=Math.random()<AIM_CHANCE;
  const tx=aimed?sh.x+rn(-250,250):rn(400,MAP-400);
  const ty=aimed?sh.y+rn(-250,250):rn(400,MAP-400);
  const len=Math.hypot(tx-cx,ty-cy)||1;
  const vx=(tx-cx)/len*COMET_SPD, vy=(ty-cy)/len*COMET_SPD;
  const trail=[]; for(let i=0;i<25;i++) trail.push({x:cx,y:cy});

  S.comets.push({x:cx,y:cy,vx,vy,radius:10,life:COMET_LIFE,
                 isFixed:!aimed,sx:cx,sy:cy,dx:vx/COMET_SPD,dy:vy/COMET_SPD,trail});
}

function updateComets(dt){
  S.cometTimer+=dt;
  if(S.cometTimer>=S.nextComet){S.cometTimer=0;S.nextComet=rn(COMET_MIN,COMET_MAX);spawnComet();}
  for(let i=S.comets.length-1;i>=0;i--){
    const c=S.comets[i];
    c.trail.unshift({x:c.x,y:c.y}); if(c.trail.length>30) c.trail.pop();
    c.x+=c.vx*dt; c.y+=c.vy*dt; c.life-=dt;
    if(c.life<=0||c.x<-500||c.x>MAP+500||c.y<-500||c.y>MAP+500) S.comets.splice(i,1);
  }
}

// ================================================================
// OBJECTIVES
// ================================================================
function updateObjectives(dt){
  const sh=S.ship;
  for(const obj of S.objectives){
    if(obj.complete) continue;
    if(obj.type==='reach'||obj.type==='collect'){
      if(dist(sh.x,sh.y,obj.x,obj.y)<obj.radius) completObj(obj);
    } else if(obj.type==='mine'){
      if(obj.targetIdx<0||obj.targetIdx>=S.bodies.length){obj.complete=true;continue;}
      const tgt=S.bodies[obj.targetIdx];
      if(tgt.type!=='asteroid'){obj.complete=true;continue;}
      const d=dist(sh.x,sh.y,tgt.x,tgt.y);
      if(d<tgt.radius+65){
        obj.progress=Math.min(1,obj.progress+dt/3);
        if(obj.progress>=1) completObj(obj);
      } else {
        obj.progress=Math.max(0,obj.progress-dt*0.25);
      }
    } else if(obj.type==='slingshot'){
      for(const pi of obj.targets){
        if(obj.completed.has(pi)) continue;
        if(pi<S.bodies.length&&dist(sh.x,sh.y,S.bodies[pi].x,S.bodies[pi].y)<S.bodies[pi].radius*3.5)
          obj.completed.add(pi);
      }
      if(obj.completed.size>=obj.targets.length) completObj(obj);
    } else if(obj.type==='orbit'){
      const b=S.bodies[obj.targetIdx];
      const r=dist(sh.x,sh.y,b.x,b.y);
      const vCirc=Math.sqrt(G*b.mass/Math.max(r,1));
      const vShip=Math.hypot(sh.vx,sh.vy);
      const ux=(b.x-sh.x)/r, uy=(b.y-sh.y)/r;
      const vRad=sh.vx*ux+sh.vy*uy;
      const vTan=Math.sqrt(Math.max(0,vShip*vShip-vRad*vRad));
      if(r>b.radius*3&&r<b.radius*8&&Math.abs(vTan-vCirc)/vCirc<0.45){
        obj.timer+=dt; if(obj.timer>=obj.required) completObj(obj);
      } else {
        obj.timer=Math.max(0,obj.timer-dt*0.5);
      }
    }
  }
  if(S.objectives.length>0&&S.objectives.every(o=>o.complete)) S.phase='win';
}

function completObj(obj){
  obj.complete=true;
  if(obj.fuelReward>0) S.ship.fuel=Math.min(FUEL_MAX,S.ship.fuel+obj.fuelReward);
  playChime();
}

// ================================================================
// TRAJECTORY PREVIEW
// ================================================================
function computeTraj(){
  const pts=[]; let hit=false;
  let x=S.ship.x,y=S.ship.y,vx=S.ship.vx,vy=S.ship.vy;
  for(let i=0;i<TRAJ_STEPS;i++){
    pts.push({x,y});
    let ax=0,ay=0;
    for(const b of S.bodies){
      const dx=b.x-x,dy=b.y-y,r2=dx*dx+dy*dy,r=Math.sqrt(r2);
      if(r<b.radius){hit=true;break;}
      const a=G*b.mass/r2; ax+=a*dx/r; ay+=a*dy/r;
    }
    if(hit) break;
    vx+=ax*TRAJ_DT; vy+=ay*TRAJ_DT;
    x+=vx*TRAJ_DT; y+=vy*TRAJ_DT;
    if(x<0||x>MAP||y<0||y>MAP) break;
  }
  return{pts,hit};
}

// ================================================================
// CAMERA
// ================================================================
function updateCam(dt){
  S.cam.x=lerp(S.cam.x,S.ship.x,Math.min(1,8*dt));
  S.cam.y=lerp(S.cam.y,S.ship.y,Math.min(1,8*dt));
}
function w2s(wx,wy){
  return{
    x:(wx-S.cam.x)*S.cam.zoom+canvas.width/2,
    y:(wy-S.cam.y)*S.cam.zoom+canvas.height/2,
  };
}

// ================================================================
// RENDER — WORLD
// ================================================================
function applyCamera(){
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.scale(S.cam.zoom,S.cam.zoom);
  ctx.translate(-S.cam.x,-S.cam.y);
}

function renderBgStars(){
  for(const s of S.bgStars){
    ctx.globalAlpha=s.a;
    ctx.fillStyle='#ffffff';
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

function renderBodies(){
  for(const b of S.bodies){
    const{x,y}=b;
    const r=b.radius*DRAW_SCALE;   // visual radius
    const pr=b.radius;             // physics radius (collision)

    if(b.type==='star'){
      const cg=ctx.createRadialGradient(x,y,r*.5,x,y,r*3.5);
      cg.addColorStop(0,'rgba(255,150,0,0.22)');
      cg.addColorStop(1,'rgba(255,80,0,0)');
      ctx.fillStyle=cg;
      ctx.beginPath();ctx.arc(x,y,r*3.5,0,Math.PI*2);ctx.fill();

      const sg=ctx.createRadialGradient(x-r*.35,y-r*.35,r*.08,x,y,r);
      sg.addColorStop(0,'#ffffff');
      sg.addColorStop(0.35,'#ffee88');
      sg.addColorStop(1,'#ff6600');
      ctx.fillStyle=sg;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    } else if(b.type==='planet'){
      const ag=ctx.createRadialGradient(x,y,r*.8,x,y,r*2.2);
      ag.addColorStop(0,b.color+'55'); ag.addColorStop(1,b.color+'00');
      ctx.fillStyle=ag;
      ctx.beginPath();ctx.arc(x,y,r*2.2,0,Math.PI*2);ctx.fill();

      const pg=ctx.createRadialGradient(x-r*.3,y-r*.3,r*.05,x,y,r);
      pg.addColorStop(0,'#ffffff33'); pg.addColorStop(0.3,b.color);
      pg.addColorStop(1,shadeColor(b.color,-45));
      ctx.fillStyle=pg;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    } else if(b.type==='moon'){
      ctx.fillStyle=b.color;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(0,0,0,0.38)';
      ctx.beginPath();ctx.arc(x+r*.3,y+r*.1,r,0,Math.PI*2);ctx.fill();

    } else if(b.type==='asteroid'){
      if(b.isMining){
        const pulse=0.5+0.5*Math.sin(Date.now()/1000*3);
        ctx.strokeStyle=`rgba(255,170,0,${pulse})`;
        ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(x,y,r+10,0,Math.PI*2);ctx.stroke();
      }
      ctx.fillStyle=b.color;
      ctx.beginPath();
      const sides=6;
      for(let i=0;i<sides;i++){
        const a=(i/sides)*Math.PI*2;
        const rr=r*(0.68+0.32*Math.sin(i*2.5+x*0.01));
        i===0?ctx.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr):ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);
      }
      ctx.closePath();ctx.fill();
      ctx.strokeStyle=shadeColor(b.color,30);ctx.lineWidth=1;ctx.stroke();
    }
  }
}

function renderComets(){
  for(const c of S.comets){
    if(c.isFixed){
      ctx.strokeStyle='rgba(100,200,255,0.18)';
      ctx.lineWidth=1;ctx.setLineDash([12,12]);
      ctx.beginPath();ctx.moveTo(c.sx,c.sy);ctx.lineTo(c.sx+c.dx*5500,c.sy+c.dy*5500);
      ctx.stroke();ctx.setLineDash([]);
    }
    if(c.trail.length>1){
      ctx.beginPath();ctx.moveTo(c.trail[0].x,c.trail[0].y);
      for(let i=1;i<c.trail.length;i++) ctx.lineTo(c.trail[i].x,c.trail[i].y);
      ctx.strokeStyle='rgba(140,215,255,0.45)';ctx.lineWidth=4;ctx.stroke();
    }
    const cg=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,c.radius*3);
    cg.addColorStop(0,'#ffffff');cg.addColorStop(0.4,'#aaddff');cg.addColorStop(1,'rgba(80,160,255,0)');
    ctx.fillStyle=cg;ctx.beginPath();ctx.arc(c.x,c.y,c.radius*3,0,Math.PI*2);ctx.fill();
  }
}

function renderObjMarkers(){
  const t=Date.now()/1000;
  for(const obj of S.objectives){
    if(obj.complete) continue;
    const pulse=0.55+0.45*Math.sin(t*2);
    const r = obj.radius || 45;

    if(obj.type==='reach'){
      ctx.strokeStyle=obj.color;ctx.lineWidth=3;ctx.globalAlpha=pulse;
      ctx.beginPath();ctx.arc(obj.x,obj.y,r,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(obj.x-22,obj.y);ctx.lineTo(obj.x+22,obj.y);
      ctx.moveTo(obj.x,obj.y-22);ctx.lineTo(obj.x,obj.y+22);
      ctx.stroke();ctx.globalAlpha=1;

    } else if(obj.type==='collect'){
      ctx.strokeStyle=obj.color;ctx.lineWidth=3;ctx.globalAlpha=pulse;
      ctx.strokeRect(obj.x-16,obj.y-16,32,32);ctx.globalAlpha=1;

    } else if(obj.type==='mine'){
      if(obj.targetIdx<0||obj.targetIdx>=S.bodies.length) continue;
      const tgt=S.bodies[obj.targetIdx];
      if(obj.progress>0){
        ctx.strokeStyle=obj.color;ctx.lineWidth=4;
        ctx.beginPath();
        ctx.arc(tgt.x,tgt.y,tgt.radius*DRAW_SCALE+14,-Math.PI/2,-Math.PI/2+obj.progress*Math.PI*2);
        ctx.stroke();
      }

    } else if(obj.type==='slingshot'){
      for(const pi of obj.targets){
        if(obj.completed.has(pi)||pi>=S.bodies.length) continue;
        const b=S.bodies[pi];
        ctx.strokeStyle=obj.color;ctx.lineWidth=2;
        ctx.setLineDash([10,8]);ctx.globalAlpha=pulse;
        ctx.beginPath();ctx.arc(b.x,b.y,b.radius*DRAW_SCALE*1.4,0,Math.PI*2);
        ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
      }

    } else if(obj.type==='orbit'){
      const b=S.bodies[obj.targetIdx];
      const br=b.radius;
      ctx.strokeStyle=obj.color;ctx.lineWidth=1;ctx.globalAlpha=0.35;
      ctx.beginPath();ctx.arc(b.x,b.y,br*3,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.arc(b.x,b.y,br*8,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;
      if(obj.timer>0){
        ctx.strokeStyle=obj.color;ctx.lineWidth=4;
        ctx.beginPath();ctx.arc(b.x,b.y,(br*3+br*8)/2,-Math.PI/2,-Math.PI/2+(obj.timer/obj.required)*Math.PI*2);
        ctx.stroke();
      }
    }
  }
}

function renderShip(){
  if(!S.ship.alive) return;
  const sh=S.ship;
  const SR=SHIP_R*3; // draw ship 3× bigger

  ctx.save();
  ctx.translate(sh.x,sh.y);ctx.rotate(sh.angle);

  if(sh.thrusting&&sh.fuel>0){
    const flicker=0.7+0.3*Math.sin(Date.now()/40);
    const flen=(sh.thrustDir>0?26:12)*flicker;
    const baseY=SR*sh.thrustDir;
    const tipY=baseY+flen*sh.thrustDir;
    const fg=ctx.createLinearGradient(0,baseY,0,tipY);
    fg.addColorStop(0,'rgba(255,210,60,0.95)');
    fg.addColorStop(0.5,'rgba(255,90,0,0.7)');
    fg.addColorStop(1,'rgba(255,30,0,0)');
    ctx.fillStyle=fg;
    ctx.beginPath();ctx.moveTo(-8,baseY);ctx.lineTo(8,baseY);ctx.lineTo(0,tipY);
    ctx.closePath();ctx.fill();
  }

  // Laser cooldown glow on ship
  if(sh.laserCooldown>0){
    const pct=sh.laserCooldown/LASER_COOL;
    ctx.strokeStyle=`rgba(0,255,180,${pct*0.5})`;
    ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,SR*1.8,0,Math.PI*2);ctx.stroke();
  }

  ctx.fillStyle='#e8e8ff';ctx.strokeStyle='#7799dd';ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(0,-SR*1.6);ctx.lineTo(SR,SR);ctx.lineTo(-SR,SR);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#88bbff';
  ctx.beginPath();ctx.arc(0,-SR*.25,SR*.38,0,Math.PI*2);ctx.fill();

  ctx.restore();
}

function renderLasers(){
  ctx.save();
  for(const l of S.lasers){
    const a=l.life/l.maxLife;
    ctx.strokeStyle=`rgba(0,255,170,${a*0.9})`;
    ctx.lineWidth=3*a+1;
    ctx.shadowColor='#00ffcc';ctx.shadowBlur=12*a;
    ctx.beginPath();ctx.moveTo(l.ox,l.oy);ctx.lineTo(l.ex,l.ey);ctx.stroke();
    if(l.hit){
      ctx.fillStyle=`rgba(255,220,80,${a})`;
      ctx.shadowColor='#ffdd44';ctx.shadowBlur=20*a;
      ctx.beginPath();ctx.arc(l.ex,l.ey,10*a,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.shadowBlur=0;ctx.restore();
}

function renderTraj(){
  const{pts,hit}=computeTraj();
  if(pts.length<2) return;
  ctx.save();
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.scale(S.cam.zoom,S.cam.zoom);
  ctx.translate(-S.cam.x,-S.cam.y);
  ctx.setLineDash([5,8]);
  ctx.strokeStyle='rgba(255,255,90,0.42)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();ctx.setLineDash([]);
  for(const f of [60,120,240,480]){
    if(f>=pts.length) break;
    ctx.fillStyle=`rgba(255,200,50,${0.9-f/550})`;
    ctx.beginPath();ctx.arc(pts[f].x,pts[f].y,3,0,Math.PI*2);ctx.fill();
  }
  if(hit){
    const p=pts[pts.length-1];
    ctx.strokeStyle='#ff4444';ctx.lineWidth=2.5;
    ctx.beginPath();
    ctx.moveTo(p.x-8,p.y-8);ctx.lineTo(p.x+8,p.y+8);
    ctx.moveTo(p.x+8,p.y-8);ctx.lineTo(p.x-8,p.y+8);
    ctx.stroke();
  }
  ctx.restore();
}

// ================================================================
// HUD
// ================================================================
function renderHUD(){
  const cw=canvas.width, ch=canvas.height;
  const sh=S.ship;

  // Fuel bar
  const fw=300,fh=22,fx=22,fy=22;
  ctx.fillStyle='#111122';ctx.fillRect(fx,fy,fw,fh);
  const fp=sh.fuel/FUEL_MAX;
  const fc=fp>0.5?'#44ff88':fp>0.25?'#ffaa00':'#ff4444';
  ctx.fillStyle=fc;ctx.fillRect(fx,fy,fw*fp,fh);
  ctx.strokeStyle='#334455';ctx.lineWidth=1;ctx.strokeRect(fx,fy,fw,fh);
  ctx.fillStyle='#8899bb';ctx.font='bold 22px monospace';
  ctx.fillText('FUEL',fx+fw+10,fy+17);

  // Low fuel screen flash
  if(fp<0.15&&Math.floor(Date.now()/400)%2===0){
    ctx.fillStyle='rgba(255,60,60,0.14)';ctx.fillRect(0,0,cw,ch);
  }

  // Laser cooldown bar (below fuel)
  const lfy=fy+fh+6;
  if(sh.laserCooldown>0){
    const lp=sh.laserCooldown/LASER_COOL;
    ctx.fillStyle='#112222';ctx.fillRect(fx,lfy,fw,8);
    ctx.fillStyle=`rgba(0,255,180,${0.7-lp*0.3})`;
    ctx.fillRect(fx,lfy,fw*(1-lp),8);
    ctx.strokeStyle='#224433';ctx.lineWidth=1;ctx.strokeRect(fx,lfy,fw,8);
  }

  // Status line
  const statY=lfy+(sh.laserCooldown>0?16:8)+14;
  if(sh.fuel<=0&&sh.zeroFuelTimer>0){
    const sLeft=Math.ceil(DEAD_DRIFT-sh.zeroFuelTimer);
    ctx.fillStyle='#ff4444';ctx.font='bold 30px monospace';
    ctx.fillText(`DRIFTING — ${sLeft}s`,fx,statY);
  } else {
    const spd=Math.hypot(sh.vx,sh.vy);
    ctx.fillStyle='#7788aa';ctx.font='27px monospace';
    ctx.fillText(`SPD ${spd.toFixed(0)}`,fx,statY);
  }

  // Objectives
  ctx.font='30px monospace';
  const oy=statY+36;
  for(let i=0;i<S.objectives.length;i++){
    const obj=S.objectives[i];
    ctx.fillStyle=obj.complete?'#338833':obj.color;
    let lbl=`${obj.complete?'✓':'○'} ${obj.label}`;
    if(!obj.complete){
      if(obj.type==='mine'&&obj.progress>0) lbl+=` [${(obj.progress*100).toFixed(0)}%]`;
      if(obj.type==='orbit'&&obj.timer>0)   lbl+=` [${obj.timer.toFixed(1)}s]`;
      if(obj.type==='slingshot')             lbl+=` [${obj.completed.size}/${obj.targets.length}]`;
    }
    ctx.fillText(lbl,fx,oy+i*38);

    if(!obj.complete){
      let tx=null,ty=null;
      if(obj.type==='mine'&&obj.targetIdx>=0&&obj.targetIdx<S.bodies.length)
        {tx=S.bodies[obj.targetIdx].x;ty=S.bodies[obj.targetIdx].y;}
      else if(obj.type==='orbit')
        {tx=S.bodies[obj.targetIdx].x;ty=S.bodies[obj.targetIdx].y;}
      else if(obj.type==='slingshot'){
        const pi=obj.targets.find(p=>!obj.completed.has(p));
        if(pi!=null){tx=S.bodies[pi].x;ty=S.bodies[pi].y;}
      } else {tx=obj.x;ty=obj.y;}
      if(tx!=null) drawArrow(tx,ty,obj.color);
    }
  }

  // Cheat mode
  if(S.cheat){
    ctx.fillStyle='#ff4444';ctx.font='bold 30px monospace';
    ctx.textAlign='center';ctx.fillText('⚠ CHEAT MODE ON',cw/2,28);ctx.textAlign='left';
  }

  // Zoom + controls
  ctx.fillStyle='#334455';ctx.font='24px monospace';
  ctx.fillText(`×${S.cam.zoom.toFixed(2)}`,cw-80,ch-14);
  ctx.fillStyle='rgba(80,80,100,0.55)';ctx.font='22px monospace';
  ctx.fillText('WASD:fly  SHIFT:boost  SPACE:laser  -/=:zoom  M:map  `:cheat  R:restart  ESC:pause',22,ch-14);

  if(S.showMinimap) renderMinimap();
}

function drawArrow(wx,wy,color){
  const cw=canvas.width,ch=canvas.height,m=42;
  const sp=w2s(wx,wy);
  if(sp.x>m&&sp.x<cw-m&&sp.y>m&&sp.y<ch-m) return;
  const ang=Math.atan2(wy-S.cam.y,wx-S.cam.x);
  const ax=clamp(canvas.width/2+Math.cos(ang)*200,m,cw-m);
  const ay=clamp(canvas.height/2+Math.sin(ang)*200,m,ch-m);
  const d=dist(S.ship.x,S.ship.y,wx,wy);
  ctx.save();ctx.translate(ax,ay);ctx.rotate(ang);
  ctx.fillStyle=color;ctx.globalAlpha=0.85;
  ctx.beginPath();ctx.moveTo(18,0);ctx.lineTo(-9,-9);ctx.lineTo(-9,9);ctx.closePath();ctx.fill();
  ctx.globalAlpha=1;ctx.rotate(-ang);
  ctx.fillStyle=color;ctx.font='22px monospace';
  ctx.textAlign='center';ctx.fillText(d.toFixed(0),0,28);ctx.textAlign='left';
  ctx.restore();
}

function renderMinimap(){
  const mm=170,mx=canvas.width-mm-14,my=canvas.height-mm-44;
  const sc=mm/MAP;
  ctx.fillStyle='rgba(0,0,18,0.72)';ctx.fillRect(mx,my,mm,mm);
  ctx.strokeStyle='#223344';ctx.lineWidth=1;ctx.strokeRect(mx,my,mm,mm);
  for(const b of S.bodies){
    const bx=mx+b.x*sc,by=my+b.y*sc;
    const br=Math.max(2,b.radius*sc*3);
    ctx.fillStyle=b.type==='star'?'#ffdd44':b.type==='planet'?b.color:b.type==='moon'?'#888888':'#554433';
    ctx.beginPath();ctx.arc(bx,by,br,0,Math.PI*2);ctx.fill();
  }
  for(const c of S.comets){
    ctx.fillStyle='#aaddff';
    ctx.beginPath();ctx.arc(mx+c.x*sc,my+c.y*sc,2,0,Math.PI*2);ctx.fill();
  }
  for(const obj of S.objectives){
    if(obj.complete) continue;
    let ox=obj.x,oy=obj.y;
    if(obj.type==='mine'&&obj.targetIdx>=0&&obj.targetIdx<S.bodies.length)
      {ox=S.bodies[obj.targetIdx].x;oy=S.bodies[obj.targetIdx].y;}
    else if(obj.type==='orbit')
      {ox=S.bodies[obj.targetIdx].x;oy=S.bodies[obj.targetIdx].y;}
    else if(obj.type==='slingshot'){
      const pi=obj.targets.find(p=>!obj.completed.has(p));
      if(pi!=null){ox=S.bodies[pi].x;oy=S.bodies[pi].y;} else continue;
    }
    if(ox==null) continue;
    ctx.fillStyle=obj.color;
    ctx.beginPath();ctx.arc(mx+ox*sc,my+oy*sc,4,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#ffffff';
  ctx.beginPath();ctx.arc(mx+S.ship.x*sc,my+S.ship.y*sc,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#334455';ctx.font='20px monospace';
  ctx.fillText('M: hide map',mx,my+mm+22);
}

// ================================================================
// SCREENS
// ================================================================
function renderMenu(){
  const cw=canvas.width,ch=canvas.height;
  for(const s of S.bgStars){
    ctx.globalAlpha=s.a*0.55;ctx.fillStyle='#ffffff';
    ctx.beginPath();ctx.arc(s.x%cw,s.y%ch,s.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
  ctx.textAlign='center';
  ctx.fillStyle='#5599ff';ctx.font='bold 186px monospace';
  ctx.fillText('SPACEHACKER',cw/2,ch/2-100);
  ctx.fillStyle='#667788';ctx.font='51px monospace';
  ctx.fillText('pilot your ship through the solar system',cw/2,ch/2+10);
  ctx.fillText('gravity assists · objectives · survive',cw/2,ch/2+72);
  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(80,255,140,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='bold 66px monospace';
  ctx.fillText('PRESS ENTER TO LAUNCH',cw/2,ch/2+168);
  ctx.fillStyle='#334455';ctx.font='33px monospace';
  ctx.fillText('WASD:fly  SHIFT:boost  SPACE:laser  -/=:zoom  `:cheat',cw/2,ch/2+240);
  ctx.textAlign='left';
}

function renderDead(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(18,0,0,0.86)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';
  ctx.fillStyle='#ff3333';ctx.font='bold 156px monospace';
  ctx.fillText('SHIP DESTROYED',cw/2,ch/2-120);
  const causeLabels={star:'struck a star',planet:'planetary collision',moon:'moon impact',
    asteroid:'asteroid strike',comet:'comet impact',fuel:'fuel exhausted',oob:'lost in the void'};
  ctx.fillStyle='#ffaa44';ctx.font='51px monospace';
  ctx.fillText(`Cause: ${causeLabels[S.death.cause]||'unknown forces'}`,cw/2,ch/2-40);
  ctx.fillStyle='#ddddee';ctx.font='italic 60px serif';
  ctx.fillText(`"${S.death.message}"`,cw/2,ch/2+40);
  ctx.fillStyle='#556677';ctx.font='42px monospace';
  ctx.fillText(`time: ${S.time.toFixed(1)}s   objectives: ${S.objectives.filter(o=>o.complete).length}/${S.objectives.length}`,cw/2,ch/2+110);
  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(180,180,200,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='51px monospace';
  ctx.fillText('ENTER: new mission    ESC: menu',cw/2,ch/2+190);
  ctx.textAlign='left';
}

function renderWin(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(0,18,0,0.86)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';
  ctx.fillStyle='#44ff88';ctx.font='bold 156px monospace';
  ctx.fillText('MISSION COMPLETE',cw/2,ch/2-100);
  ctx.fillStyle='#aaffcc';ctx.font='51px monospace';
  ctx.fillText(`Fuel remaining: ${S.ship.fuel.toFixed(0)} / ${FUEL_MAX}`,cw/2,ch/2-14);
  ctx.fillText(`Time: ${S.time.toFixed(1)}s`,cw/2,ch/2+50);
  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(80,255,140,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='51px monospace';
  ctx.fillText('ENTER: new mission    ESC: menu',cw/2,ch/2+140);
  ctx.textAlign='left';
}

function renderPause(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(0,0,0,0.62)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';
  ctx.fillStyle='#ddddff';ctx.font='bold 138px monospace';
  ctx.fillText('PAUSED',cw/2,ch/2+30);
  ctx.fillStyle='#778899';ctx.font='51px monospace';
  ctx.fillText('ESC to resume',cw/2,ch/2+120);
  ctx.textAlign='left';
}

// ================================================================
// MASTER RENDER
// ================================================================
function render(){
  ctx.fillStyle='#00000a';ctx.fillRect(0,0,canvas.width,canvas.height);

  if(S.phase==='menu'){renderMenu();return;}

  ctx.save();applyCamera();
  renderBgStars();
  renderBodies();
  renderComets();
  renderObjMarkers();
  renderLasers();
  if(S.ship.alive) renderShip();
  ctx.restore();

  if(S.cheat&&S.ship.alive&&S.phase==='playing') renderTraj();

  if(S.phase==='playing'||S.phase==='paused') renderHUD();
  if(S.phase==='paused') renderPause();
  if(S.phase==='dead')  {renderHUD();renderDead();}
  if(S.phase==='win')   {renderHUD();renderWin();}
}

// ================================================================
// INPUT
// ================================================================
const keys={};

window.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();

  const wasDown=keys[e.code];
  keys[e.code]=true;

  switch(e.code){
    case 'Escape':
      if(S.phase==='playing')     S.phase='paused';
      else if(S.phase==='paused') S.phase='playing';
      else if(S.phase==='dead'||S.phase==='win') S.phase='menu';
      break;
    case 'Enter':case 'NumpadEnter':
      if(S.phase==='menu'||S.phase==='dead'||S.phase==='win') startRun();
      break;
    case 'KeyR':
      if(S.phase==='playing'||S.phase==='paused') startRun();
      break;
    case 'Backquote':
      if(S.phase==='playing') S.cheat=!S.cheat;
      break;
    case 'Minus':
      S.cam.zoom=Math.max(ZOOM_MIN,+(S.cam.zoom-ZOOM_STEP).toFixed(2));
      break;
    case 'Equal':case 'Plus':
      S.cam.zoom=Math.min(ZOOM_MAX,+(S.cam.zoom+ZOOM_STEP).toFixed(2));
      break;
    case 'KeyM':
      S.showMinimap=!S.showMinimap;
      break;
    case 'Space':
      if(S.phase==='playing') fireLaser();
      break;
  }
},{passive:false});

window.addEventListener('keyup',e=>{keys[e.code]=false;});

// ================================================================
// GAME LOOP
// ================================================================
let lastTs=0;

function startRun(){
  initAudio();
  if(S.phase==='dead'||S.phase==='win') S.runCount=(S.runCount||0)+1;
  S.phase='playing'; S.cheat=false; S.showMinimap=true;
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
    updateLasers(dt);
    updateObjectives(dt);
    updateAudio(dt);
  }

  render();
  requestAnimationFrame(loop);
}

// ================================================================
// INIT
// ================================================================
function init(){
  initState();
  S.bgStars=[];
  for(let i=0;i<200;i++)
    S.bgStars.push({x:Math.random()*MAP,y:Math.random()*MAP,r:Math.random()*1.5+0.3,a:Math.random()*0.7+0.3});
  requestAnimationFrame(ts=>{lastTs=ts;loop(ts);});
}

init();
