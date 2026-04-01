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
let   MAP        = 12000;  // set from CONFIG.mapSize at genWorld()
const EDGE_WARN_FRAC = 0.10; // fraction of MAP width that triggers edge warning
const G          = 1950;           // ~4× baseline — gravity is dominant
const SOI_ACCEL  = 15;             // threshold accel (units/s²) for SOI display (~10% of max thrust)

const SHIP_R     = 8;
const THRUST     = 150;
const BOOST_MULT = 2;
const ROT_SPEED  = 2.8;
// FUEL_MAX is now CONFIG.fuelMax (set below)
const FUEL_RATE  = 45;
const FUEL_BOOST = 135;
const DEAD_DRIFT = 30;
const GRACE_TIME = 1.5;   // seconds of spawn invincibility

const DRAW_SCALE  = 2.5;   // visual radius multiplier (physics radius unchanged)

const ARM_LEN    = SHIP_R * 11; // mining arm length (world units, = ship sprite width)
const DOCK_RADIUS = 55;         // unified station proximity trigger
const DOCK_SPEED  = 50;         // max approach speed to complete dock
const DOCK_ALIGN  = 0.82;       // min |cos θ| ship-heading vs ship→station (≈35° cone)

const ZOOM_MIN   = 0.25;
const ZOOM_MAX   = 2.0;
const ZOOM_STEP  = 0.12;
const ZOOM_DEF   = 1.0;

const TRAJ_STEPS = 500;
const TRAJ_DT    = 1 / 60;

const COMET_SPD  = 290;
const COMET_MIN  = 5;
const COMET_MAX  = 11;
const COMET_LIFE = 25;
const AIM_CHANCE = 0.70;

const LASER_FUEL = 15;
const LASER_COOL = 0.3;
const LASER_RANGE= 1400;

// ================================================================
// CONFIG  — runtime-adjustable settings
// ================================================================
const CONFIG = {
  gravMult:   1.0,   // multiplier on G
  cometRate:  1.0,   // multiplier on comet frequency (0 = off)
  music:      true,
  showFPS:    false,
  fuelMax:      1000,  // ship fuel capacity
  refuelMult:   1.0,   // multiplier on all fuel rewards
  mapSize:      12000, // applied at next genWorld()
  bodyDensity:  1.0,   // multiplier on planet/asteroid/moon counts
  // cheats
  gravContours:    false,
  gravVectorScale: 1.0,   // length multiplier on the grav arrow
  fieldLineDensity:1.0,   // multiplier on contour grid resolution (higher = more lines)
};

const COMET_PRESETS  = [['Off',0],['Light',0.5],['Normal',1.0],['Heavy',2.5]];
const GRAV_PRESETS   = [['×½',0.5],['×1',1.0],['×1½',1.5],['×2',2.0],['×3',3.0]];
const FUEL_PRESETS    = [['500',500],['1000',1000],['2000',2000]];
const REFUEL_PRESETS  = [['×½',0.5],['×1',1.0],['×1½',1.5],['×2',2.0]];
const MAP_PRESETS     = [['Small',8000],['Med',12000],['Large',20000],['Huge',40000]];
const DENSITY_PRESETS = [['Sparse',0.5],['Normal',1.0],['Dense',1.5],['Packed',2.0]];
const GRAV_VECTOR_PRESETS  = [['×½',0.5],['×1',1.0],['×2',2.0],['×4',4.0]];
const FIELD_DENSITY_PRESETS= [['Sparse',0.5],['Normal',1.0],['Dense',1.5],['Fine',2.0]];

// Risk-level presets bundle: [label, {gravMult,cometRate,fuelMax,refuelMult}]
const RISK_PRESETS = [
  ['Routine',   {gravMult:0.5,  cometRate:0.5,  fuelMax:2000, refuelMult:2.0}],
  ['Challenge', {gravMult:1.0,  cometRate:1.0,  fuelMax:1000, refuelMult:1.0}],
  ['Danger',    {gravMult:1.5,  cometRate:2.5,  fuelMax:500,  refuelMult:0.5}],
  ['Nerves',    {gravMult:2.0,  cometRate:2.5,  fuelMax:500,  refuelMult:0.5}],
];

// ================================================================
// UI STATE
// ================================================================
const UI = { configOpen: false, configPaused: false };
let _configBtns = [];   // rebuilt each renderConfig frame

// ================================================================
// ASSETS
// ================================================================
const ASSETS = {};
function loadAssets(manifest, cb){
  let n=manifest.length; if(!n){cb();return;}
  for(const[key,src]of manifest){
    const img=new Image();
    img.onload =()=>{if(--n===0)cb();};
    img.onerror=()=>{console.warn('Asset missing:',src);if(--n===0)cb();};
    img.src=src; ASSETS[key]=img;
  }
}
function spriteOk(key){ return ASSETS[key]&&ASSETS[key].naturalWidth>0; }

// ================================================================
// PALETTE  — everything in cool cyan/blue/purple tones
// ================================================================
const PLANET_COLORS = ['#4488ff','#ff6644','#ffaa33','#44cc88','#cc88ff','#ff4488','#33ddff'];
const MOON_COLORS   = ['#aaaaaa','#bbbb99','#998877','#aabb99','#aa9988'];

// HUD color constants
const C_LABEL  = '#22ddee';   // cyan labels
const C_VALUE  = '#99ccff';   // light-blue values
const C_DIM    = '#334466';   // dim hints
const C_WARN   = '#ff4455';   // warnings
const C_GOOD   = '#44ffaa';   // success / complete

// ================================================================
// DEATH MESSAGES
// ================================================================
const DEATHS = {
  star:     ["You flew into a star. Bold strategy.",
             "The star was not a destination.",
             "Nuclear fusion: not a spa treatment.",
             "10,000 solar masses. You had 1. Math happened."],
  planet:   ["The planet was not expecting visitors.",
             "You discovered a new crater. It is named after you.",
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
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgb(${clamp(r+amt,0,255)},${clamp(g+amt,0,255)},${clamp(b+amt,0,255)})`;
}

function lineCircleHit(x1,y1,x2,y2,cx,cy,r) {
  const dx=x2-x1,dy=y2-y1,fx=x1-cx,fy=y1-cy;
  const a=dx*dx+dy*dy,b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-r*r;
  let disc=b*b-4*a*c; if(disc<0) return false;
  disc=Math.sqrt(disc);
  const t1=(-b-disc)/(2*a),t2=(-b+disc)/(2*a);
  return (t1>=0&&t1<=1)||(t2>=0&&t2<=1);
}

// ================================================================
// AUDIO
// ================================================================
let AUD = null;

// ---- Chord progression: Am → F → C → G  (A natural minor, i–VI–III–VII)
// Clean triads — no tritones, no dissonance. Spacious and melodic.
const MUSIC = [
  // Am — floating tonic (A C E)
  { arp:  [110.00, 130.81, 164.81, 220.00],   // A2 C3 E3 A3
    lead: [440.00, 523.25, 659.25, 880.00] },  // A4 C5 E5 A5
  // F — warm lift (F A C)
  { arp:  [87.307, 110.00, 130.81, 174.61],   // F2 A2 C3 F3
    lead: [349.23, 440.00, 523.25, 698.46] },  // F4 A4 C5 F5
  // C — open and bright (C E G)
  { arp:  [65.406,  82.407,  98.000, 130.81], // C2 E2 G2 C3
    lead: [523.25,  659.25,  784.00, 1046.5] },// C5 E5 G5 C6
  // G — return / dominant (G B D)
  { arp:  [98.000, 123.47, 146.83, 196.00],   // G2 B2 D3 G3
    lead: [392.00, 493.88, 587.33, 784.00] },  // G4 B4 D5 G5
];
// Sub-bass: low root on chord downbeat
const BASS_ROOTS = [55.00, 43.654, 65.406, 48.999]; // A1 F1 C2 G1

const ARP_PAT     = [0, 1, 2, 3, 2, 1];    // up-down through 4-note voicing
const ARP_INT     = 0.30;                   // seconds per arp step
const CHORD_STEPS = ARP_PAT.length * 2;    // 12 steps (~3.6s) per chord

let _arpStep  = 0;
let _cStep    = 0;    // steps within current chord
let _cIdx     = 0;    // chord index
let _nextArp  = 0;    // scheduled time of next arp note
let _nextLead = 0;    // scheduled time of next lead note

function initAudio() {
  if (AUD) { try { AUD.ctx.resume(); } catch(_){} return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master
    const master = ctx.createGain(); master.gain.value = 0.40; master.connect(ctx.destination);

    // Reverb: delay+feedback
    const revDelay = ctx.createDelay(1.5); revDelay.delayTime.value = 0.44;
    const revFB  = ctx.createGain(); revFB.gain.value  = 0.48;
    const revOut = ctx.createGain(); revOut.gain.value = 0.30;
    revDelay.connect(revFB); revFB.connect(revDelay);
    revDelay.connect(revOut); revOut.connect(master);

    // Low-pass warmth filter (proximity-modulated)
    const filt = ctx.createBiquadFilter();
    filt.type='lowpass'; filt.frequency.value=1600; filt.Q.value=1.0;
    filt.connect(master); filt.connect(revDelay);

    // Thrust noise
    const nBuf = (() => {
      const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
      const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
      return b;
    })();
    const nSrc=ctx.createBufferSource(); nSrc.buffer=nBuf; nSrc.loop=true;
    const nFilt=ctx.createBiquadFilter(); nFilt.type='bandpass'; nFilt.frequency.value=340; nFilt.Q.value=2.5;
    const nGain=ctx.createGain(); nGain.gain.value=0;
    nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(master);
    nSrc.start();

    // Boost bass — deep sine rumble when shift-thrusting
    const boostOsc=ctx.createOscillator(); boostOsc.type='sine'; boostOsc.frequency.value=46;
    const boostGain=ctx.createGain(); boostGain.gain.value=0;
    boostOsc.connect(boostGain); boostGain.connect(master);
    boostOsc.start();

    AUD = { ctx, master, filt, revDelay, nGain, boostGain };
    _resetMusic();
  } catch(e) { console.warn('Web Audio unavailable:', e); AUD=null; }
}

// Sub-bass: deep sine hit on chord downbeat
function _schedBass(freq, time) {
  const c=AUD.ctx;
  const osc=c.createOscillator(), env=c.createGain();
  osc.type='sine'; osc.frequency.value=freq;
  osc.connect(env); env.connect(AUD.master);
  env.gain.setValueAtTime(0,time);
  env.gain.linearRampToValueAtTime(0.28, time+0.02);
  env.gain.exponentialRampToValueAtTime(0.001, time+1.8);
  osc.start(time); osc.stop(time+1.9);
}

// Arp voice: sine through reverb
function _schedArp(freq, time, vol) {
  const c=AUD.ctx;
  const osc=c.createOscillator(), env=c.createGain();
  osc.type='sine'; osc.frequency.value=freq;
  osc.connect(env); env.connect(AUD.filt);
  env.gain.setValueAtTime(0,time);
  env.gain.linearRampToValueAtTime(vol, time+0.035);
  env.gain.exponentialRampToValueAtTime(0.001, time+0.50);
  osc.start(time); osc.stop(time+0.55);
}

// Lead voice: triangle, glassy shimmer, drier
function _schedLead(freq, time, vol) {
  const c=AUD.ctx;
  const osc=c.createOscillator(), env=c.createGain();
  osc.type='triangle'; osc.frequency.value=freq;
  osc.frequency.setValueAtTime(freq*1.004, time);
  osc.frequency.exponentialRampToValueAtTime(freq, time+0.10);
  osc.connect(env); env.connect(AUD.filt); env.connect(AUD.master);
  env.gain.setValueAtTime(0,time);
  env.gain.linearRampToValueAtTime(vol, time+0.02);
  env.gain.exponentialRampToValueAtTime(0.001, time+0.90);
  osc.start(time); osc.stop(time+0.95);
}

function _resetMusic() { _arpStep=0;_cStep=0;_cIdx=0;_nextArp=0;_nextLead=0; }

function scheduleMusic() {
  if (!AUD || S.phase !== 'playing' || !CONFIG.music) return;
  const now = AUD.ctx.currentTime;
  if (_nextArp  < now) _nextArp  = now + 0.04;
  if (_nextLead < now) _nextLead = now + 0.12 + Math.random()*1.2;

  // Schedule arp notes up to 0.8s ahead
  while (_nextArp < now + 0.8) {
    const chord = MUSIC[_cIdx];
    const noteFreq = chord.arp[ARP_PAT[_arpStep % ARP_PAT.length]];

    _schedArp(noteFreq, _nextArp, 0.16);

    // Sub-bass + chord reset on first step of each chord
    if (_cStep === 0) _schedBass(BASS_ROOTS[_cIdx], _nextArp);

    _arpStep++; _cStep++; _nextArp += ARP_INT;

    if (_cStep >= CHORD_STEPS) {
      _cStep = 0;
      _cIdx  = (_cIdx + 1) % MUSIC.length;
    }
  }

  // Sparse lead — chord-aware pitch selection
  if (_nextLead < now + 0.8) {
    const pool = MUSIC[_cIdx].lead;
    _schedLead(pool[Math.floor(Math.random()*pool.length)], _nextLead, 0.10);
    _nextLead += 1.8 + Math.random()*3.0;
  }
}

function updateAudio(dt) {
  if (!AUD) return;
  scheduleMusic();

  // Filter warmth tracks proximity to nearest heavy body
  let minD = Infinity;
  for (const b of S.bodies) {
    const d = dist(S.ship.x,S.ship.y,b.x,b.y)-b.radius;
    if (d<minD) minD=d;
  }
  const prox = clamp(1-minD/1600,0,1);
  AUD.filt.frequency.setTargetAtTime(500+(1-prox)*1800, AUD.ctx.currentTime, 0.7);

  // Thrust noise
  const thr = S.ship.alive && S.ship.thrusting && S.ship.fuel>0;
  AUD.nGain.gain.setTargetAtTime(thr?0.13:0, AUD.ctx.currentTime, 0.09);

  // Boost bass
  const boosting = thr && (keys.ShiftLeft||keys.ShiftRight);
  AUD.boostGain.gain.setTargetAtTime(boosting?0.055:0, AUD.ctx.currentTime, 0.15);
}

function playChime() {
  if (!AUD) return;
  const c=AUD.ctx;
  [261.63,329.63,392.00,523.25].forEach((freq,i)=>{
    const osc=c.createOscillator(),g=c.createGain();
    osc.type='triangle'; osc.frequency.value=freq;
    osc.connect(g); g.connect(AUD.master);
    const t=c.currentTime+i*0.11;
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(0.25,t+0.04);
    g.gain.exponentialRampToValueAtTime(0.001,t+0.65);
    osc.start(t); osc.stop(t+0.7);
  });
}

function playLaserSfx() {
  if (!AUD) return;
  const c=AUD.ctx;
  const osc=c.createOscillator(),g=c.createGain();
  osc.type='sine';
  osc.frequency.setValueAtTime(1400,c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200,c.currentTime+0.13);
  osc.connect(g); g.connect(AUD.master);
  g.gain.setValueAtTime(0.2,c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.13);
  osc.start(); osc.stop(c.currentTime+0.14);
}

function playHitSfx() {
  if (!AUD) return;
  const c=AUD.ctx;
  const buf=c.createBuffer(1,c.sampleRate*0.07,c.sampleRate);
  const d=buf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  const src=c.createBufferSource(); src.buffer=buf;
  const flt=c.createBiquadFilter(); flt.type='bandpass'; flt.frequency.value=900; flt.Q.value=1.5;
  const g=c.createGain();
  g.gain.setValueAtTime(0.28,c.currentTime); g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.07);
  src.connect(flt); flt.connect(g); g.connect(AUD.master);
  src.start(); src.stop(c.currentTime+0.08);
}

function playDeathSfx() {
  if (!AUD) return;
  const c=AUD.ctx;
  const osc=c.createOscillator(),g=c.createGain();
  osc.type='sine';
  osc.frequency.setValueAtTime(220,c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40,c.currentTime+2.0);
  osc.connect(g); g.connect(AUD.master);
  g.gain.setValueAtTime(0.42,c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+2.0);
  osc.start(); osc.stop(c.currentTime+2.1);
}

function playEdgeAlarm(){
  if(!AUD) return;
  const c=AUD.ctx, t=c.currentTime;
  const osc=c.createOscillator(), g=c.createGain();
  osc.type='square';
  osc.frequency.setValueAtTime(660,t);
  osc.frequency.exponentialRampToValueAtTime(330,t+0.25);
  osc.connect(g); g.connect(AUD.master);
  g.gain.setValueAtTime(0.08,t);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.3);
  osc.start(t); osc.stop(t+0.3);
}

// ================================================================
// GAME STATE
// ================================================================
let S = {};

function initState() {
  S = {
    phase:'menu', runCount:0, time:0, wave:1, waveTimer:0, waveBanner:false, objectivesDone:0,
    bodies:[], comets:[], objectives:[], lasers:[],
    ship:{x:0,y:0,vx:0,vy:0,angle:0,fuel:CONFIG.fuelMax,alive:true,
          thrusting:false,thrustDir:1,zeroFuelTimer:0,laserCooldown:0,grace:0},
    cam:{x:0,y:0,zoom:ZOOM_DEF},
    showMinimap:true, cheat:false,
    cometTimer:0, nextComet:rn(COMET_MIN,COMET_MAX),
    bgStars:[], fuelPopups:[], death:null,
    nearEdge:false, edgeAlarmTimer:0,
    docking:null,
    extraFuelReady:true,
    explosion:null,
    boostTrail:[],
  };
}

// ================================================================
// WORLD GENERATION
// ================================================================
function genWorld() {
  MAP = CONFIG.mapSize;  // apply map size setting
  seedRng(Date.now());
  S.bodies=[]; S.comets=[]; S.objectives=[]; S.lasers=[];

  S.bgStars=[];
  // dim background layer
  for(let i=0;i<3600;i++)
    S.bgStars.push({x:nr()*MAP,y:nr()*MAP,r:nr()*0.9+0.2,a:nr()*0.5+0.15,phase:nr()*Math.PI*2,speed:nr()*0.4+0.1,bright:false});
  // medium twinkling stars
  for(let i=0;i<900;i++)
    S.bgStars.push({x:nr()*MAP,y:nr()*MAP,r:nr()*0.8+0.9,a:nr()*0.4+0.55,phase:nr()*Math.PI*2,speed:nr()*1.0+0.5,bright:false});
  // bright glowing stars
  for(let i=0;i<120;i++)
    S.bgStars.push({x:nr()*MAP,y:nr()*MAP,r:nr()*1.2+1.6,a:0.90+nr()*0.10,phase:nr()*Math.PI*2,speed:nr()*1.5+0.8,bright:true});

  S.nearEdge=false; S.edgeAlarmTimer=0; S.docking=null; S.explosion=null;

  // Star types: [color, glow, radius, mass]
  const STAR_TYPES=[
    ['#fff5cc','#ff8800',80,10000],  // yellow sun
    ['#ffd8aa','#ff5500',92,12000],  // orange giant
    ['#cce0ff','#5588ff',62, 8000],  // blue dwarf
    ['#ffcccc','#ff2200',68, 9000],  // red dwarf
  ];

  const rings=[950,1400,1950,2550,3200];
  const dens=CONFIG.bodyDensity;
  const systemCount=clamp(Math.round(MAP/4500),2,7);
  const minStarSep=Math.max(4000,MAP*0.30);
  const margin=MAP*0.14;

  const starPositions=[];
  const planetIdxs=[], asteroidIdxs=[];

  for(let s=0;s<systemCount;s++){
    // Place star well away from map edges and other stars
    let stx,sty,sat=0;
    do{
      stx=rn(margin,MAP-margin); sty=rn(margin,MAP-margin); sat++;
    } while(sat<100 && starPositions.some(p=>dist(stx,sty,p.x,p.y)<minStarSep));
    starPositions.push({x:stx,y:sty});

    const [sc,sg,sr,sm]=STAR_TYPES[ri(0,STAR_TYPES.length)];
    const starIdx=S.bodies.length;
    S.bodies.push({type:'star',x:stx,y:sty,mass:sm,radius:sr,color:sc,glow:sg,parentIdx:-1});

    // Planets + moons
    const pCount=clamp(Math.round(ri(3,5)*dens),1,rings.length);
    const pCols=[...PLANET_COLORS].sort(()=>nr()-0.5);
    for(let i=0;i<pCount;i++){
      const ang=ra(),d=rings[i]+rn(-100,100);
      const pi=S.bodies.length; planetIdxs.push(pi);
      S.bodies.push({
        type:'planet',
        x:clamp(stx+Math.cos(ang)*d,300,MAP-300),
        y:clamp(sty+Math.sin(ang)*d,300,MAP-300),
        mass:1000,radius:rn(26,46),color:pCols[i],glow:pCols[i],parentIdx:starIdx,
      });
      const moonCount=clamp(Math.round(ri(1,4)*dens),0,7);
      for(let j=0;j<moonCount;j++){
        const orR=S.bodies[pi].radius*DRAW_SCALE+rn(160,480),orA=ra();
        const retrograde=nr()<0.08;
        const orS=rn(0.08,0.22)*(retrograde?-1:1);
        S.bodies.push({
          type:'moon',
          x:S.bodies[pi].x+Math.cos(orA)*orR,
          y:S.bodies[pi].y+Math.sin(orA)*orR,
          mass:25,radius:rn(2,5),
          color:MOON_COLORS[ri(0,MOON_COLORS.length)],glow:'#aaaaaa',
          parentIdx:pi,orbitR:orR,orbitAngle:orA,orbitSpeed:orS,
        });
      }
    }

    // Asteroid belt — ring of asteroids beyond outermost planet
    const beltR=rings[pCount-1]+rn(500,900);
    const beltN=clamp(Math.round(ri(16,28)*dens),6,48);
    for(let j=0;j<beltN;j++){
      const ang=ra(), r=beltR+rn(-200,200);
      const ai=S.bodies.length;
      S.bodies.push({
        type:'asteroid',
        x:clamp(stx+Math.cos(ang)*r,200,MAP-200),
        y:clamp(sty+Math.sin(ang)*r,200,MAP-200),
        mass:10,radius:rn(6,13),color:'#887766',glow:'#99887a',
        isMining:false,vx:0,vy:0,parentIdx:-1,
      });
      asteroidIdxs.push(ai);
    }
  }

  // Ship spawn — in interstellar space, away from all stars and map edges
  const spawnMargin=MAP*0.14, starClear=2000;
  let sx=MAP/2, sy=MAP/2;
  for(let att=0;att<200;att++){
    const tx=rn(spawnMargin,MAP-spawnMargin), ty=rn(spawnMargin,MAP-spawnMargin);
    const clearStars=starPositions.every(p=>dist(tx,ty,p.x,p.y)>starClear);
    const clearBodies=S.bodies.every(b=>dist(tx,ty,b.x,b.y)>b.radius*DRAW_SCALE+SHIP_R+80);
    if(clearStars&&clearBodies){sx=tx;sy=ty;break;}
  }

  // Face the nearest star on spawn
  const nearest=starPositions.reduce((a,b)=>dist(sx,sy,a.x,a.y)<dist(sx,sy,b.x,b.y)?a:b);
  const spawnAngle=Math.atan2(nearest.y-sy,nearest.x-sx)-Math.PI/2;
  S.ship={
    x:sx,y:sy,vx:0,vy:0,
    angle:spawnAngle,
    fuel:CONFIG.fuelMax,alive:true,
    thrusting:false,thrustDir:1,zeroFuelTimer:0,laserCooldown:0,
    grace:GRACE_TIME,
  };
  S.cam.x=sx; S.cam.y=sy; S.cam.zoom=ZOOM_DEF;
  S.cometTimer=0; S.nextComet=rn(COMET_MIN,COMET_MAX);
  S.time=0; S.wave=1; S.waveTimer=0; S.waveBanner=false; S.objectivesDone=0;

  genObjectives(planetIdxs,asteroidIdxs);
}

function safePos(){
  for(let a=0;a<200;a++){
    const x=rn(400,MAP-400),y=rn(400,MAP-400);
    if(S.bodies.every(b=>dist(x,y,b.x,b.y)>b.radius+180)) return{x,y};
  }
  return{x:rn(400,MAP-400),y:rn(400,MAP-400)};
}

// Gravitational acceleration magnitude at a world point (stars+planets only)
function gravAccAt(x,y){
  let ax=0,ay=0;
  const Geff=G*CONFIG.gravMult;
  for(const b of S.bodies){
    if(b.type!=='star'&&b.type!=='planet') continue;
    const dx=b.x-x, dy=b.y-y, r2=dx*dx+dy*dy;
    if(r2<400) continue;
    const inv=1/Math.sqrt(r2);
    const f=Geff*b.mass*inv*inv;
    ax+=f*dx*inv; ay+=f*dy*inv;
  }
  return Math.hypot(ax,ay);
}

// Risk multiplier for an objective at (x,y) — combines grav field, distance, asteroid density
function riskMult(x,y){
  const grav=gravAccAt(x,y);
  const d=S.ship ? dist(S.ship.x,S.ship.y,x,y) : 0;
  const nearAst=S.bodies.filter(b=>b.type==='asteroid'&&dist(x,y,b.x,b.y)<1500).length;
  const g=clamp(grav/20,0,2.0);
  const dFac=clamp(d/7000,0,1.0);
  const aFac=clamp(nearAst*0.07,0,0.5);
  return clamp(1.0+g+dFac+aFac,1.0,3.8);
}

function riskLabel(m){
  if(m>=2.8) return ' ⚡DANGER';
  if(m>=2.0) return ' ⚡HIGH RISK';
  if(m>=1.5) return ' ⚡RISK';
  return '';
}

function genObjectives(planetIdxs,asteroidIdxs){
  S.objectives=[];
  const tier=Math.min(4,1+Math.floor(S.runCount/2));

  const sp=safePos();
  const spRisk=riskMult(sp.x,sp.y);
  S.objectives.push({type:'reach',x:sp.x,y:sp.y,radius:DOCK_RADIUS,
    label:`Reach Station Alpha${riskLabel(spRisk)}`,complete:false,
    fuelReward:Math.round(180*CONFIG.refuelMult*spRisk),color:'#00ffcc'});

  if(tier>=2){
    if(nr()>0.5&&asteroidIdxs.length>0){
      const ai=asteroidIdxs[ri(0,asteroidIdxs.length)];
      const ab=S.bodies[ai];
      ab.isMining=true; ab.vx=rn(-35,35); ab.vy=rn(-35,35);
      const mRisk=riskMult(ab.x,ab.y);
      S.objectives.push({type:'mine',targetIdx:ai,
        label:`Mine Asteroid B-7 (3s)${riskLabel(mRisk)}`,complete:false,
        fuelReward:Math.round(300*CONFIG.refuelMult*mRisk),color:'#ffaa00',progress:0});
    } else {
      const cp=safePos();
      const cRisk=riskMult(cp.x,cp.y);
      S.objectives.push({type:'collect',x:cp.x,y:cp.y,radius:DOCK_RADIUS,
        label:`Collect Resource Pod${riskLabel(cRisk)}`,complete:false,
        fuelReward:Math.round(200*CONFIG.refuelMult*cRisk),color:'#ffff44'});
    }
  }
  if(tier>=3&&nr()>0.35){
    if(nr()>0.5&&planetIdxs.length>=2){
      const n=Math.min(2,planetIdxs.length);
      const tgts=[...planetIdxs].sort(()=>nr()-0.5).slice(0,n);
      const avgRisk=tgts.reduce((s,i)=>s+riskMult(S.bodies[i].x,S.bodies[i].y),0)/tgts.length;
      S.objectives.push({type:'slingshot',targets:tgts,completed:new Set(),
        label:`Slingshot ${n} planet${n>1?'s':''}${riskLabel(avgRisk)}`,complete:false,
        fuelReward:Math.round(400*CONFIG.refuelMult*avgRisk),color:'#ff88ff'});
    } else if(planetIdxs.length>0){
      const pi=planetIdxs[ri(0,planetIdxs.length)];
      const pRisk=riskMult(S.bodies[pi].x,S.bodies[pi].y);
      S.objectives.push({type:'orbit',targetIdx:pi,
        label:`Establish orbit (5s)${riskLabel(pRisk)}`,complete:false,
        fuelReward:Math.round(350*CONFIG.refuelMult*pRisk),color:'#88ffff',timer:0,required:5});
    }
  }
  if(tier>=4&&nr()>0.5){
    const fp=safePos();
    const fpRisk=riskMult(fp.x,fp.y);
    S.objectives.push({type:'reach',x:fp.x,y:fp.y,radius:DOCK_RADIUS,
      label:`Reach Station Beta${riskLabel(fpRisk)}`,complete:false,
      fuelReward:Math.round(180*CONFIG.refuelMult*fpRisk),color:'#ff8844'});
  }
}

// ================================================================
// PHYSICS
// ================================================================
function gravAt(x,y){
  let ax=0,ay=0;
  const Geff=G*CONFIG.gravMult;
  for(const b of S.bodies){
    const dx=b.x-x,dy=b.y-y,r2=dx*dx+dy*dy,r=Math.sqrt(r2);
    if(r<1) continue;
    const a=Geff*b.mass/r2; ax+=a*dx/r; ay+=a*dy/r;
  }
  return{ax,ay};
}

function updatePhysics(dt){
  const sh=S.ship;
  if(!sh.alive) return;
  if(sh.laserCooldown>0) sh.laserCooldown-=dt;
  if(sh.grace>0){sh.grace-=dt; if(sh.grace<0)sh.grace=0;}

  if(S.docking){
    sh.x=S.docking.x; sh.y=S.docking.y;
    sh.vx=0; sh.vy=0; sh.thrusting=false;
    return;
  }

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
    if(boosting&&tAmt>0) S.boostTrail.push({x:sh.x,y:sh.y,age:0});
  }
  // Age and cull boost trail
  for(const pt of S.boostTrail) pt.age+=dt;
  if(S.boostTrail.length>80) S.boostTrail.splice(0,S.boostTrail.length-80);
  for(let i=S.boostTrail.length-1;i>=0;i--)
    if(S.boostTrail[i].age>0.55) S.boostTrail.splice(i,1);

  if(sh.fuel<=0){
    sh.zeroFuelTimer+=dt;
    if(sh.zeroFuelTimer>=DEAD_DRIFT){killShip('fuel');return;}
  } else {
    sh.zeroFuelTimer=0;
  }

  const g=gravAt(sh.x,sh.y);
  sh.vx+=g.ax*dt; sh.vy+=g.ay*dt;
  sh.x+=sh.vx*dt; sh.y+=sh.vy*dt;

  if(sh.grace>0) return; // invincible during grace

  if(sh.x<-200||sh.x>MAP+200||sh.y<-200||sh.y>MAP+200){killShip('oob');return;}
  for(const b of S.bodies)
    if(dist(sh.x,sh.y,b.x,b.y)<b.radius*DRAW_SCALE+SHIP_R){killShip(b.type);return;}
  for(const c of S.comets)
    if(dist(sh.x,sh.y,c.x,c.y)<c.radius+SHIP_R){killShip('comet');return;}
}

function killShip(cause){
  S.cam.x=S.ship.x; S.cam.y=S.ship.y; // snap so explosion is centred on screen
  S.ship.alive=false; S.phase='dead';
  S.death={cause,message:deathMsg(cause)};
  // Explosion on physical impacts (not fuel drain or out-of-bounds)
  if(cause!=='fuel'&&cause!=='oob'){
    const sh=S.ship;
    const EXCOLORS=['#ff6600','#ffaa00','#ffffff','#ff3300','#ffdd44','#ff8833','#ffcc99'];
    const particles=[];
    for(let i=0;i<32;i++){
      const ang=Math.random()*Math.PI*2;
      const spd=40+Math.random()*200;
      const life=0.5+Math.random()*1.5;
      particles.push({x:sh.x,y:sh.y,
        vx:Math.cos(ang)*spd+sh.vx*0.4,
        vy:Math.sin(ang)*spd+sh.vy*0.4,
        r:1.5+Math.random()*5,
        color:EXCOLORS[Math.floor(Math.random()*EXCOLORS.length)],
        life,maxLife:life});
    }
    S.explosion={particles};
  }
  playDeathSfx();
}

// ================================================================
// LASERS
// ================================================================
function fireLaser(){
  const sh=S.ship;
  if(sh.laserCooldown>0||sh.fuel<LASER_FUEL||!sh.alive) return;
  sh.fuel-=LASER_FUEL; sh.laserCooldown=LASER_COOL;

  const dx=Math.sin(sh.angle),dy=-Math.cos(sh.angle);
  const ox=sh.x+dx*SHIP_R*2,oy=sh.y+dy*SHIP_R*2;
  const ex=sh.x+dx*LASER_RANGE,ey=sh.y+dy*LASER_RANGE;
  let hx=ex,hy=ey,hit=false;

  for(let i=S.bodies.length-1;i>=0;i--){
    const b=S.bodies[i];
    if(b.type!=='asteroid') continue;
    if(lineCircleHit(ox,oy,ex,ey,b.x,b.y,b.radius)){
      hx=b.x;hy=b.y;hit=true;
      for(const obj of S.objectives){
        if(obj.type==='mine'&&obj.targetIdx===i){obj.targetIdx=-1;obj.complete=true;}
        if(obj.targetIdx!==undefined&&obj.targetIdx>i) obj.targetIdx--;
      }
      S.bodies.splice(i,1);
      break;
    }
  }
  if(!hit){
    for(let i=S.comets.length-1;i>=0;i--){
      const c=S.comets[i];
      if(lineCircleHit(ox,oy,ex,ey,c.x,c.y,c.radius)){
        hx=c.x;hy=c.y;hit=true;S.comets.splice(i,1);break;
      }
    }
  }

  S.lasers.push({ox,oy,ex:hx,ey:hy,life:0.18,maxLife:0.18,hit});
  playLaserSfx(); if(hit) playHitSfx();
}

function updateLasers(dt){
  for(let i=S.lasers.length-1;i>=0;i--){
    S.lasers[i].life-=dt; if(S.lasers[i].life<=0) S.lasers.splice(i,1);
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
      b.x+=b.vx*dt;b.y+=b.vy*dt;
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
  const vx=(tx-cx)/len*COMET_SPD,vy=(ty-cy)/len*COMET_SPD;
  const trail=[]; for(let i=0;i<25;i++) trail.push({x:cx,y:cy});
  S.comets.push({x:cx,y:cy,vx,vy,radius:10,life:COMET_LIFE,
                 isFixed:!aimed,sx:cx,sy:cy,dx:vx/COMET_SPD,dy:vy/COMET_SPD,trail});
}

function updateComets(dt){
  if(CONFIG.cometRate<=0){S.comets=[];return;}
  S.cometTimer+=dt;
  const interval=rn(COMET_MIN,COMET_MAX)/CONFIG.cometRate;
  if(S.cometTimer>=S.nextComet){S.cometTimer=0;S.nextComet=interval;spawnComet();}
  for(let i=S.comets.length-1;i>=0;i--){
    const c=S.comets[i];
    c.trail.unshift({x:c.x,y:c.y}); if(c.trail.length>30) c.trail.pop();
    c.x+=c.vx*dt;c.y+=c.vy*dt;c.life-=dt;
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
    if(obj.type==='reach'){
      if(S.docking) continue;
      const d=dist(sh.x,sh.y,obj.x,obj.y);
      if(d<DOCK_RADIUS&&d>0.1){
        const nx=(obj.x-sh.x)/d, ny=(obj.y-sh.y)/d;
        const hdx=Math.sin(sh.angle), hdy=-Math.cos(sh.angle);
        const dot=hdx*nx+hdy*ny;
        if(Math.abs(dot)>=DOCK_ALIGN && Math.hypot(sh.vx,sh.vy)<DOCK_SPEED){
          const fuelTarget=Math.min(CONFIG.fuelMax,sh.fuel+obj.fuelReward);
          S.docking={obj,x:sh.x,y:sh.y,timer:0,
            duration:obj.fuelReward>0?2.2:0.9,
            fuelStart:sh.fuel, fuelTarget};
        }
      }
    } else if(obj.type==='collect'){
      if(dist(sh.x,sh.y,obj.x,obj.y)<DOCK_RADIUS) completObj(obj);
    } else if(obj.type==='mine'){
      if(obj.targetIdx<0||obj.targetIdx>=S.bodies.length){obj.complete=true;continue;}
      const tgt=S.bodies[obj.targetIdx];
      if(tgt.type!=='asteroid'){obj.complete=true;continue;}
      if(dist(sh.x,sh.y,tgt.x,tgt.y)<tgt.radius*DRAW_SCALE+ARM_LEN){
        obj.progress=Math.min(1,obj.progress+dt/3);
        if(obj.progress>=1) completObj(obj);
      } else {
        obj.progress=Math.max(0,obj.progress-dt*0.25);
      }
    } else if(obj.type==='slingshot'){
      for(const pi of obj.targets){
        if(obj.completed.has(pi)||pi>=S.bodies.length) continue;
        if(dist(sh.x,sh.y,S.bodies[pi].x,S.bodies[pi].y)<S.bodies[pi].radius*DRAW_SCALE*1.4) obj.completed.add(pi);
      }
      if(obj.completed.size>=obj.targets.length) completObj(obj);
    } else if(obj.type==='orbit'){
      const b=S.bodies[obj.targetIdx];
      const r=dist(sh.x,sh.y,b.x,b.y);
      const vCirc=Math.sqrt(G*b.mass/Math.max(r,1));
      const vShip=Math.hypot(sh.vx,sh.vy);
      const ux=(b.x-sh.x)/r,uy=(b.y-sh.y)/r;
      const vRad=sh.vx*ux+sh.vy*uy;
      const vTan=Math.sqrt(Math.max(0,vShip*vShip-vRad*vRad));
      if(r>b.radius*DRAW_SCALE*1.2&&r<b.radius*DRAW_SCALE*3.2&&Math.abs(vTan-vCirc)/vCirc<0.45){
        obj.timer+=dt; if(obj.timer>=obj.required) completObj(obj);
      } else {
        obj.timer=Math.max(0,obj.timer-dt*0.5);
      }
    }
  }
  if(S.objectives.length>0&&S.objectives.every(o=>o.complete)&&!S.waveBanner){
    S.waveBanner=true; S.waveTimer=2.4;
  }
  if(S.waveBanner){
    S.waveTimer-=dt;
    if(S.waveTimer<=0){S.waveBanner=false;appendObjectives();}
  }
}

function completObj(obj){
  obj.complete=true; S.objectivesDone++;
  if(obj.fuelReward>0){
    S.ship.fuel=Math.min(CONFIG.fuelMax,S.ship.fuel+obj.fuelReward);
    S.fuelPopups.push({amount:obj.fuelReward,alpha:1.0,dy:0,wx:S.ship.x,wy:S.ship.y});
  }
  playChime();
}

function updateFuelPopups(dt){
  for(let i=S.fuelPopups.length-1;i>=0;i--){
    S.fuelPopups[i].alpha-=dt/2.2;
    S.fuelPopups[i].dy+=dt*28;
    if(S.fuelPopups[i].alpha<=0) S.fuelPopups.splice(i,1);
  }
}

function updateEdgeWarning(dt){
  if(!S.ship.alive){S.nearEdge=false;return;}
  const sh=S.ship;
  const warn=MAP*EDGE_WARN_FRAC;
  S.nearEdge=sh.x<warn||sh.x>MAP-warn||sh.y<warn||sh.y>MAP-warn;
  if(S.nearEdge){
    S.edgeAlarmTimer-=dt;
    if(S.edgeAlarmTimer<=0){playEdgeAlarm();S.edgeAlarmTimer=2.5;}
  } else {
    S.edgeAlarmTimer=0;
  }
}

function updateDocking(dt){
  if(!S.docking) return;
  const d=S.docking;
  d.timer=Math.min(d.timer+dt, d.duration);
  const progress=d.timer/d.duration;
  S.ship.fuel=d.fuelStart+(d.fuelTarget-d.fuelStart)*progress;
  if(d.timer>=d.duration){
    S.ship.fuel=d.fuelTarget;
    d.obj.complete=true; S.objectivesDone++;
    if(d.fuelTarget>d.fuelStart)
      S.fuelPopups.push({amount:Math.round(d.fuelTarget-d.fuelStart),alpha:1.0,dy:0,wx:S.ship.x,wy:S.ship.y});
    playChime();
    S.docking=null;
  }
}

function appendObjectives(){
  S.objectives=S.objectives.filter(o=>!o.complete);
  S.wave++;
  const tier=Math.min(4,1+Math.floor(S.wave/2));
  const planetIdxs=S.bodies.map((b,i)=>b.type==='planet'?i:-1).filter(i=>i>=0);
  const asteroidIdxs=S.bodies.map((b,i)=>b.type==='asteroid'&&!b.isMining?i:-1).filter(i=>i>=0);

  const sp=safePos();
  const spRisk=riskMult(sp.x,sp.y);
  S.objectives.push({type:'reach',x:sp.x,y:sp.y,radius:DOCK_RADIUS,
    label:`Reach Station ${S.wave}${riskLabel(spRisk)}`,complete:false,
    fuelReward:Math.round(180*CONFIG.refuelMult*spRisk),color:'#00ffcc'});

  if(tier>=2){
    if(asteroidIdxs.length>0&&nr()>0.4){
      const ai=asteroidIdxs[ri(0,asteroidIdxs.length)];
      const ab=S.bodies[ai];
      ab.isMining=true; ab.vx=rn(-35,35); ab.vy=rn(-35,35);
      const mRisk=riskMult(ab.x,ab.y);
      S.objectives.push({type:'mine',targetIdx:ai,
        label:`Mine Asteroid (3s)${riskLabel(mRisk)}`,complete:false,
        fuelReward:Math.round(300*CONFIG.refuelMult*mRisk),color:'#ffaa00',progress:0});
    } else if(nr()>0.4){
      const cp=safePos();
      const cRisk=riskMult(cp.x,cp.y);
      S.objectives.push({type:'collect',x:cp.x,y:cp.y,radius:DOCK_RADIUS,
        label:`Collect Resource Pod${riskLabel(cRisk)}`,complete:false,
        fuelReward:Math.round(200*CONFIG.refuelMult*cRisk),color:'#ffff44'});
    }
  }
  if(tier>=3&&nr()>0.35){
    if(nr()>0.5&&planetIdxs.length>=2){
      const n=Math.min(2,planetIdxs.length);
      const tgts=[...planetIdxs].sort(()=>nr()-0.5).slice(0,n);
      const avgRisk=tgts.reduce((s,i)=>s+riskMult(S.bodies[i].x,S.bodies[i].y),0)/tgts.length;
      S.objectives.push({type:'slingshot',targets:tgts,completed:new Set(),
        label:`Slingshot ${n} planet${n>1?'s':''}${riskLabel(avgRisk)}`,complete:false,
        fuelReward:Math.round(400*CONFIG.refuelMult*avgRisk),color:'#ff88ff'});
    } else if(planetIdxs.length>0){
      const pi=planetIdxs[ri(0,planetIdxs.length)];
      const pRisk=riskMult(S.bodies[pi].x,S.bodies[pi].y);
      S.objectives.push({type:'orbit',targetIdx:pi,
        label:`Establish orbit (5s)${riskLabel(pRisk)}`,complete:false,
        fuelReward:Math.round(350*CONFIG.refuelMult*pRisk),color:'#88ffff',timer:0,required:5});
    }
  }
}

// ================================================================
// TRAJECTORY PREVIEW
// ================================================================
function computeTraj(){
  const pts=[]; let hit=false;
  let x=S.ship.x,y=S.ship.y,vx=S.ship.vx,vy=S.ship.vy;
  const Geff=G*CONFIG.gravMult;
  for(let i=0;i<TRAJ_STEPS;i++){
    pts.push({x,y});
    let ax=0,ay=0;
    for(const b of S.bodies){
      const dx=b.x-x,dy=b.y-y,r2=dx*dx+dy*dy,r=Math.sqrt(r2);
      if(r<b.radius*DRAW_SCALE){hit=true;break;}
      const a=Geff*b.mass/r2; ax+=a*dx/r; ay+=a*dy/r;
    }
    if(hit) break;
    vx+=ax*TRAJ_DT;vy+=ay*TRAJ_DT;x+=vx*TRAJ_DT;y+=vy*TRAJ_DT;
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
  return{x:(wx-S.cam.x)*S.cam.zoom+canvas.width/2,
         y:(wy-S.cam.y)*S.cam.zoom+canvas.height/2};
}

// ================================================================
// RENDER — BODIES
// ================================================================
function applyCamera(){
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.scale(S.cam.zoom,S.cam.zoom);
  ctx.translate(-S.cam.x,-S.cam.y);
}

function renderBgStars(){
  const t=S.time||0;
  for(const s of S.bgStars){
    const twinkle=0.65+0.35*Math.sin(t*s.speed+s.phase);
    const alpha=s.a*twinkle;
    if(s.bright){
      // soft radial glow
      const gr=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r*4);
      gr.addColorStop(0,`rgba(180,210,255,${alpha*0.55})`);
      gr.addColorStop(1,'rgba(180,210,255,0)');
      ctx.globalAlpha=1;ctx.fillStyle=gr;
      ctx.beginPath();ctx.arc(s.x,s.y,s.r*4,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=alpha;
    ctx.fillStyle=s.bright?'#ddeeff':'#ffffff';
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

function hex2rgb(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}

function renderNebula(){
  const BAND=1200;  // gradient fades inward this many world units from each edge
  const OUTER=2000; // solid fill outside map bounds (visible when zoomed out)

  // Solid fill outside the map square
  ctx.fillStyle='#ff0000';
  ctx.fillRect(-OUTER,-OUTER,MAP+2*OUTER,OUTER);        // top
  ctx.fillRect(-OUTER,MAP,MAP+2*OUTER,OUTER);           // bottom
  ctx.fillRect(-OUTER,0,OUTER,MAP);                     // left
  ctx.fillRect(MAP,0,OUTER,MAP);                        // right

  // Top gradient band: red at y=0, transparent at y=BAND
  let gr=ctx.createLinearGradient(0,0,0,BAND);
  gr.addColorStop(0,'rgba(255,0,0,0.88)'); gr.addColorStop(1,'rgba(255,0,0,0)');
  ctx.fillStyle=gr; ctx.fillRect(0,0,MAP,BAND);

  // Bottom gradient band: red at y=MAP, transparent at y=MAP-BAND
  gr=ctx.createLinearGradient(0,MAP,0,MAP-BAND);
  gr.addColorStop(0,'rgba(255,0,0,0.88)'); gr.addColorStop(1,'rgba(255,0,0,0)');
  ctx.fillStyle=gr; ctx.fillRect(0,MAP-BAND,MAP,BAND);

  // Left gradient band: red at x=0, transparent at x=BAND
  gr=ctx.createLinearGradient(0,0,BAND,0);
  gr.addColorStop(0,'rgba(255,0,0,0.88)'); gr.addColorStop(1,'rgba(255,0,0,0)');
  ctx.fillStyle=gr; ctx.fillRect(0,0,BAND,MAP);

  // Right gradient band: red at x=MAP, transparent at x=MAP-BAND
  gr=ctx.createLinearGradient(MAP,0,MAP-BAND,0);
  gr.addColorStop(0,'rgba(255,0,0,0.88)'); gr.addColorStop(1,'rgba(255,0,0,0)');
  ctx.fillStyle=gr; ctx.fillRect(MAP-BAND,0,BAND,MAP);
}

function renderBodies(){
  for(const b of S.bodies){
    const{x,y}=b;
    // Visual radius: DRAW_SCALE, but never smaller than ~5px on screen
    const minWorld=5/S.cam.zoom;
    const r=Math.max(b.radius*DRAW_SCALE, minWorld);

    if(b.type==='star'){
      const cg=ctx.createRadialGradient(x,y,r*.5,x,y,r*3.2);
      cg.addColorStop(0,'rgba(255,150,0,0.22)');cg.addColorStop(1,'rgba(255,80,0,0)');
      ctx.fillStyle=cg;ctx.beginPath();ctx.arc(x,y,r*3.2,0,Math.PI*2);ctx.fill();
      const sg=ctx.createRadialGradient(x-r*.35,y-r*.35,r*.08,x,y,r);
      sg.addColorStop(0,'#ffffff');sg.addColorStop(0.35,'#ffee88');sg.addColorStop(1,'#ff6600');
      ctx.fillStyle=sg;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    } else if(b.type==='planet'){
      const ag=ctx.createRadialGradient(x,y,r*.8,x,y,r*2.1);
      ag.addColorStop(0,b.color+'55');ag.addColorStop(1,b.color+'00');
      ctx.fillStyle=ag;ctx.beginPath();ctx.arc(x,y,r*2.1,0,Math.PI*2);ctx.fill();
      const pg=ctx.createRadialGradient(x-r*.3,y-r*.3,r*.05,x,y,r);
      pg.addColorStop(0,'#ffffff33');pg.addColorStop(0.3,b.color);pg.addColorStop(1,shadeColor(b.color,-45));
      ctx.fillStyle=pg;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    } else if(b.type==='moon'){
      // Halo for visibility at distance
      ctx.fillStyle='rgba(180,180,180,0.12)';
      ctx.beginPath();ctx.arc(x,y,r*1.6,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=b.color;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(0,0,0,0.38)';
      ctx.beginPath();ctx.arc(x+r*.3,y+r*.1,r,0,Math.PI*2);ctx.fill();

    } else if(b.type==='asteroid'){
      if(b.isMining){
        ctx.strokeStyle='rgba(255,170,0,0.75)';ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(x,y,r+10,0,Math.PI*2);ctx.stroke();
      }
      // Subtle halo so small asteroids stay visible
      ctx.fillStyle='rgba(136,119,102,0.25)';
      ctx.beginPath();ctx.arc(x,y,r*1.5,0,Math.PI*2);ctx.fill();
      if(spriteOk('asteroid')){
        const sz=r*2.2;
        ctx.drawImage(ASSETS.asteroid,x-sz/2,y-sz/2,sz,sz);
      } else {
        ctx.fillStyle=b.color;
        ctx.beginPath();
        const sides=6;
        for(let i=0;i<sides;i++){
          const a=(i/sides)*Math.PI*2, rr=r*(0.68+0.32*Math.sin(i*2.5+x*0.01));
          i===0?ctx.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr):ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);
        }
        ctx.closePath();ctx.fill();
        ctx.strokeStyle=shadeColor(b.color,30);ctx.lineWidth=1;ctx.stroke();
      }
    }
  }
}

function renderComets(){
  for(const c of S.comets){
    if(c.isFixed){
      ctx.strokeStyle='rgba(100,200,255,0.18)';ctx.lineWidth=1;ctx.setLineDash([12,12]);
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

    if(obj.type==='reach'){
      // Station sprite
      const sz=64;
      if(spriteOk('station')){
        ctx.drawImage(ASSETS.station,obj.x-sz/2,obj.y-sz/2,sz,sz);
      } else {
        ctx.strokeStyle=obj.color;ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(obj.x,obj.y,sz/2,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(obj.x-20,obj.y);ctx.lineTo(obj.x+20,obj.y);
        ctx.moveTo(obj.x,obj.y-20);ctx.lineTo(obj.x,obj.y+20);
        ctx.stroke();
      }

      // Docking guide — visible when ship is within 4× dock radius, not yet docking
      if(S.ship.alive&&!S.docking){
        const sh=S.ship;
        const dd=dist(sh.x,sh.y,obj.x,obj.y);
        if(dd<DOCK_RADIUS*4&&dd>0.1){
          const nx=(obj.x-sh.x)/dd, ny=(obj.y-sh.y)/dd;
          const hdx=Math.sin(sh.angle), hdy=-Math.cos(sh.angle);
          const dot=hdx*nx+hdy*ny;
          const aligned=Math.abs(dot)>=DOCK_ALIGN;
          const slow=Math.hypot(sh.vx,sh.vy)<DOCK_SPEED;
          const col=aligned&&slow?'#00ff88':aligned?'#ffee00':'#556677';
          const arrowAng=Math.atan2(ny,nx);
          ctx.save();ctx.globalAlpha=0.88;
          for(const flip of [0,Math.PI]){
            const ax=obj.x+Math.cos(arrowAng+flip)*(sz/2+18);
            const ay=obj.y+Math.sin(arrowAng+flip)*(sz/2+18);
            ctx.save();ctx.translate(ax,ay);ctx.rotate(arrowAng+flip+Math.PI);
            ctx.fillStyle=col;ctx.lineWidth=1.5;
            ctx.beginPath();
            ctx.moveTo(0,-9);ctx.lineTo(7,7);ctx.lineTo(0,2);ctx.lineTo(-7,7);
            ctx.closePath();ctx.fill();
            ctx.restore();
          }
          ctx.restore();
          if(dd<DOCK_RADIUS*1.5){
            ctx.font='bold '+fnt(17);ctx.textAlign='center';
            if(aligned&&slow){
              ctx.fillStyle='#00ff88';ctx.fillText('DOCKING...',obj.x,obj.y-sz/2-10);
            } else if(aligned){
              ctx.fillStyle='#ffee00';
              ctx.fillText(`SLOW DOWN  ${Math.hypot(sh.vx,sh.vy).toFixed(0)}`,obj.x,obj.y-sz/2-10);
            } else {
              ctx.fillStyle='#556677';ctx.fillText('ALIGN NOSE / TAIL',obj.x,obj.y-sz/2-10);
            }
            ctx.textAlign='left';
          }
        }
      }

    } else if(obj.type==='collect'){
      // Resource pod — spinning double hexagon
      const podR=22;
      ctx.save();ctx.translate(obj.x,obj.y);ctx.rotate(t*0.9);
      ctx.strokeStyle=obj.color;ctx.lineWidth=2.5;
      ctx.beginPath();
      for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;i===0?ctx.moveTo(Math.cos(a)*podR,Math.sin(a)*podR):ctx.lineTo(Math.cos(a)*podR,Math.sin(a)*podR);}
      ctx.closePath();ctx.stroke();
      ctx.rotate(Math.PI/6);
      ctx.strokeStyle=obj.color+'88';ctx.lineWidth=1.5;
      ctx.beginPath();
      for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;i===0?ctx.moveTo(Math.cos(a)*(podR*0.52),Math.sin(a)*(podR*0.52)):ctx.lineTo(Math.cos(a)*(podR*0.52),Math.sin(a)*(podR*0.52));}
      ctx.closePath();ctx.stroke();
      const grd=ctx.createRadialGradient(0,0,0,0,0,podR*0.5);
      grd.addColorStop(0,'rgba(255,255,100,0.35)');grd.addColorStop(1,'rgba(255,220,0,0)');
      ctx.fillStyle=grd;ctx.beginPath();ctx.arc(0,0,podR*0.5,0,Math.PI*2);ctx.fill();
      ctx.restore();
      ctx.strokeStyle=obj.color+'44';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(obj.x,obj.y,podR*1.6,0,Math.PI*2);ctx.stroke();

    } else if(obj.type==='mine'){
      if(obj.targetIdx<0||obj.targetIdx>=S.bodies.length) continue;
      const tgt=S.bodies[obj.targetIdx];

      // Mining progress arc
      if(obj.progress>0){
        ctx.strokeStyle=obj.color;ctx.lineWidth=4;
        ctx.beginPath();
        ctx.arc(tgt.x,tgt.y,tgt.radius*DRAW_SCALE+14,-Math.PI/2,-Math.PI/2+obj.progress*Math.PI*2);
        ctx.stroke();
      }

      // Mining arm — deploy when ship is within reach
      if(S.ship.alive){
        const sh=S.ship;
        const armDist=dist(sh.x,sh.y,tgt.x,tgt.y);
        const deployRange=tgt.radius*DRAW_SCALE+ARM_LEN+40;
        if(armDist<deployRange&&armDist>0.1){
          const nx=(tgt.x-sh.x)/armDist, ny=(tgt.y-sh.y)/armDist;
          const ax=sh.x+nx*ARM_LEN, ay=sh.y+ny*ARM_LEN;
          const mining=armDist<tgt.radius*DRAW_SCALE+ARM_LEN;
          const vibe=mining?(0.4+0.6*Math.sin(Date.now()/55)):0;

          // Arm shaft
          ctx.strokeStyle=mining?'#cc9933':'#778866';
          ctx.lineWidth=2.5;
          ctx.beginPath();ctx.moveTo(sh.x,sh.y);ctx.lineTo(ax,ay);ctx.stroke();

          // Drill head
          const dr=5+vibe*3;
          ctx.fillStyle=mining?`rgba(255,${140+Math.floor(vibe*80)},0,0.92)`:'rgba(180,140,60,0.7)';
          ctx.beginPath();ctx.arc(ax,ay,dr,0,Math.PI*2);ctx.fill();
          if(mining){
            ctx.strokeStyle=`rgba(255,200,0,${0.5+vibe*0.5})`;ctx.lineWidth=1.5;
            ctx.beginPath();ctx.arc(ax,ay,dr+4,0,Math.PI*2);ctx.stroke();
          }
        }
      }

    } else if(obj.type==='slingshot'){
      for(const pi of obj.targets){
        if(obj.completed.has(pi)||pi>=S.bodies.length) continue;
        const b=S.bodies[pi];
        ctx.strokeStyle=obj.color;ctx.lineWidth=2;ctx.setLineDash([10,8]);ctx.globalAlpha=pulse;
        ctx.beginPath();ctx.arc(b.x,b.y,b.radius*DRAW_SCALE*1.4,0,Math.PI*2);
        ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
      }
    } else if(obj.type==='orbit'){
      const b=S.bodies[obj.targetIdx];
      ctx.strokeStyle=obj.color;ctx.lineWidth=1;ctx.globalAlpha=0.35;
      ctx.beginPath();ctx.arc(b.x,b.y,b.radius*DRAW_SCALE*1.2,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.arc(b.x,b.y,b.radius*DRAW_SCALE*3.2,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;
      if(obj.timer>0){
        ctx.strokeStyle=obj.color;ctx.lineWidth=4;
        ctx.beginPath();ctx.arc(b.x,b.y,b.radius*DRAW_SCALE*2.2,-Math.PI/2,-Math.PI/2+(obj.timer/obj.required)*Math.PI*2);
        ctx.stroke();
      }
    }
  }
}

function renderBoostTrail(){
  if(!S.boostTrail.length) return;
  const LIFE=0.55;
  for(const pt of S.boostTrail){
    const frac=1-pt.age/LIFE;
    const r=frac*7;
    const gr=ctx.createRadialGradient(pt.x,pt.y,0,pt.x,pt.y,r);
    gr.addColorStop(0,`rgba(255,100,20,${frac*0.85})`);
    gr.addColorStop(0.5,`rgba(255,40,0,${frac*0.45})`);
    gr.addColorStop(1,'rgba(200,0,0,0)');
    ctx.fillStyle=gr;
    ctx.beginPath();ctx.arc(pt.x,pt.y,r,0,Math.PI*2);ctx.fill();
  }
}

function renderShip(){
  if(!S.ship.alive) return;
  const sh=S.ship;
  const u=SHIP_R*2.8;  // base unit — all ship geometry in multiples of u

  // Grace-period shield ring
  if(sh.grace>0){
    const a=sh.grace/GRACE_TIME;
    ctx.save();ctx.translate(sh.x,sh.y);
    ctx.strokeStyle=`rgba(80,200,255,${a*0.45})`;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,u*3.4,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(sh.x,sh.y);
  ctx.rotate(sh.angle);

  const now=Date.now()/1000;

  // ---- Ion drive exhaust (single central) ----
  if(sh.thrusting&&sh.fuel>0){
    const flicker=0.72+0.28*Math.sin(now*38);
    if(sh.thrustDir>0){
      const flen=u*3.2*flicker;
      const fg=ctx.createLinearGradient(0,u*1.3,0,u*1.3+flen);
      fg.addColorStop(0,'rgba(120,180,255,0.95)');
      fg.addColorStop(0.35,'rgba(60,120,255,0.70)');
      fg.addColorStop(1,'rgba(20,60,200,0)');
      ctx.fillStyle=fg;
      ctx.beginPath();
      ctx.moveTo(-u*0.18,u*1.25);ctx.lineTo(u*0.18,u*1.25);
      ctx.lineTo(u*0.06,u*1.3+flen);ctx.lineTo(-u*0.06,u*1.3+flen);
      ctx.closePath();ctx.fill();
      ctx.fillStyle=`rgba(200,220,255,${0.9*flicker})`;
      ctx.beginPath();ctx.arc(0,u*1.28,u*0.16,0,Math.PI*2);ctx.fill();
    } else {
      const fg=ctx.createLinearGradient(0,-u*2.6,0,-u*2.6-u*0.9*flicker);
      fg.addColorStop(0,'rgba(255,200,80,0.8)');
      fg.addColorStop(1,'rgba(255,100,0,0)');
      ctx.fillStyle=fg;
      ctx.beginPath();
      ctx.moveTo(-u*0.12,-u*2.6);ctx.lineTo(u*0.12,-u*2.6);
      ctx.lineTo(0,-u*2.6-u*0.9*flicker);
      ctx.closePath();ctx.fill();
    }
  }

  // ---- Ship body ----
  if(spriteOk('ship')){
    const sz=SHIP_R*11;
    ctx.drawImage(ASSETS.ship,-sz/2,-sz/2,sz,sz);
  } else {
    // Canvas fallback: draw probe body
    ctx.fillStyle='#445566';
    ctx.fillRect( u*0.30,-u*0.50, u*1.45, u*0.10);
    ctx.fillRect(-u*1.75,-u*0.50, u*1.45, u*0.10);
    ctx.fillStyle='#0d2040';ctx.strokeStyle='#1a4070';ctx.lineWidth=0.8;
    ctx.fillRect( u*1.75,-u*0.68, u*0.75, u*0.56);ctx.strokeRect( u*1.75,-u*0.68,u*0.75,u*0.56);
    ctx.fillRect(-u*2.50,-u*0.68, u*0.75, u*0.56);ctx.strokeRect(-u*2.50,-u*0.68,u*0.75,u*0.56);
    ctx.strokeStyle='#1a3a60';ctx.lineWidth=0.5;
    for(const dx of [u*2.00,u*2.25]){
      ctx.beginPath();ctx.moveTo( dx,-u*0.68);ctx.lineTo( dx,-u*0.12);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-dx,-u*0.68);ctx.lineTo(-dx,-u*0.12);ctx.stroke();
    }
    ctx.fillStyle='rgba(60,120,200,0.15)';
    ctx.fillRect( u*1.75,-u*0.68, u*0.75, u*0.18);
    ctx.fillRect(-u*2.50,-u*0.68, u*0.75, u*0.18);
    ctx.fillStyle='#556677';ctx.strokeStyle='#334455';ctx.lineWidth=0.8;
    for(const s of [-1,1]){
      ctx.beginPath();
      ctx.moveTo(s*u*0.28,u*0.80);ctx.lineTo(s*u*0.65,u*1.10);ctx.lineTo(s*u*0.26,u*1.30);
      ctx.closePath();ctx.fill();ctx.stroke();
    }
    const hullGrad=ctx.createLinearGradient(-u*0.32,-u*2.5,u*0.32,u*1.2);
    hullGrad.addColorStop(0,'#dde8ff');hullGrad.addColorStop(0.45,'#c0d0e8');hullGrad.addColorStop(1,'#778899');
    ctx.fillStyle=hullGrad;ctx.strokeStyle='#445566';ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.moveTo(0,-u*2.7);ctx.lineTo(u*0.22,-u*2.0);ctx.lineTo(u*0.30,-u*0.8);
    ctx.lineTo(u*0.28,u*0.6);ctx.lineTo(u*0.20,u*1.30);ctx.lineTo(-u*0.20,u*1.30);
    ctx.lineTo(-u*0.28,u*0.6);ctx.lineTo(-u*0.30,-u*0.8);ctx.lineTo(-u*0.22,-u*2.0);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#556688';ctx.strokeStyle='#334455';ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(-u*0.18,u*1.25);ctx.lineTo(u*0.18,u*1.25);
    ctx.lineTo(u*0.22,u*1.36);ctx.lineTo(-u*0.22,u*1.36);
    ctx.closePath();ctx.fill();ctx.stroke();
    const thrGlow=sh.thrusting&&sh.fuel>0;
    ctx.strokeStyle=thrGlow?'rgba(100,160,255,0.85)':'rgba(60,80,120,0.55)';
    ctx.lineWidth=thrGlow?2:1;
    ctx.beginPath();ctx.arc(0,u*1.33,u*0.18,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='rgba(60,80,120,0.45)';ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(0,-u*2.2);ctx.lineTo(0,u*1.0);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-u*0.27,-u*0.5);ctx.lineTo(u*0.27,-u*0.5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-u*0.28,u*0.3);ctx.lineTo(u*0.28,u*0.3);ctx.stroke();
    const sGrad=ctx.createRadialGradient(-u*0.05,-u*2.62,0,0,-u*2.55,u*0.22);
    sGrad.addColorStop(0,'#aaccff');sGrad.addColorStop(0.5,'#2255bb');sGrad.addColorStop(1,'#0a1a44');
    ctx.fillStyle=sGrad;ctx.strokeStyle='#334488';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(0,-u*2.55,u*0.22,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='rgba(200,230,255,0.40)';
    ctx.beginPath();ctx.arc(-u*0.07,-u*2.64,u*0.08,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ff3333';
    ctx.beginPath();ctx.arc(-u*2.50,-u*0.40,u*0.15,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#33ff88';
    ctx.beginPath();ctx.arc(u*2.50,-u*0.40,u*0.15,0,Math.PI*2);ctx.fill();
    if(Math.floor(now*2)%2===0){
      ctx.fillStyle='rgba(255,255,255,0.9)';
      ctx.beginPath();ctx.arc(0,u*1.26,u*0.10,0,Math.PI*2);ctx.fill();
    }
  }

  // ---- Laser cooldown ring ----
  if(sh.laserCooldown>0){
    const pct=sh.laserCooldown/LASER_COOL;
    ctx.strokeStyle=`rgba(0,255,180,${pct*0.55})`;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,u*3.0,0,Math.PI*2);ctx.stroke();
  }

  ctx.restore();
}

function renderGravVector(){
  if(!S.ship.alive) return;
  const sh=S.ship;
  const g=gravAt(sh.x,sh.y);
  const mag=Math.hypot(g.ax,g.ay);
  if(mag<0.5) return;
  const sc=CONFIG.gravVectorScale;
  const len=clamp(mag*0.6,22,90)*sc;
  const nx=g.ax/mag, ny=g.ay/mag;
  const ex=sh.x+nx*len, ey=sh.y+ny*len;
  const ang=Math.atan2(ny,nx);
  const as=9/S.cam.zoom;
  ctx.save();
  ctx.strokeStyle='rgba(255,200,60,0.82)';ctx.fillStyle='rgba(255,200,60,0.82)';
  ctx.lineWidth=2/S.cam.zoom;
  ctx.beginPath();ctx.moveTo(sh.x,sh.y);ctx.lineTo(ex,ey);ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex,ey);
  ctx.lineTo(ex-as*Math.cos(ang-0.42),ey-as*Math.sin(ang-0.42));
  ctx.lineTo(ex-as*Math.cos(ang+0.42),ey-as*Math.sin(ang+0.42));
  ctx.closePath();ctx.fill();
  ctx.restore();
}

function renderAccelVector(){
  const sh=S.ship;
  const boosting=keys.ShiftLeft||keys.ShiftRight;
  const thr=THRUST*(boosting?BOOST_MULT:1)*(sh.thrustDir>0?1:0.4);
  const nx=Math.sin(sh.angle)*sh.thrustDir;
  const ny=-Math.cos(sh.angle)*sh.thrustDir;
  const sc=CONFIG.gravVectorScale;
  const len=clamp(thr*0.6,22,90)*sc;
  const ex=sh.x+nx*len,ey=sh.y+ny*len;
  const ang=Math.atan2(ny,nx);
  const as=9/S.cam.zoom;
  ctx.save();
  ctx.strokeStyle='rgba(0,220,255,0.85)';ctx.fillStyle='rgba(0,220,255,0.85)';
  ctx.lineWidth=2/S.cam.zoom;
  ctx.beginPath();ctx.moveTo(sh.x,sh.y);ctx.lineTo(ex,ey);ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex,ey);
  ctx.lineTo(ex-as*Math.cos(ang-0.42),ey-as*Math.sin(ang-0.42));
  ctx.lineTo(ex-as*Math.cos(ang+0.42),ey-as*Math.sin(ang+0.42));
  ctx.closePath();ctx.fill();
  ctx.restore();
}

function updateExplosion(dt){
  if(!S.explosion) return;
  const p=S.explosion.particles;
  for(let i=p.length-1;i>=0;i--){
    const q=p[i];
    q.x+=q.vx*dt; q.y+=q.vy*dt;
    q.vx*=0.94; q.vy*=0.94; // drag
    q.life-=dt;
    if(q.life<=0) p.splice(i,1);
  }
  if(p.length===0) S.explosion=null;
}

function renderExplosion(){
  if(!S.explosion) return;
  ctx.save();
  for(const q of S.explosion.particles){
    const a=Math.max(0,q.life/q.maxLife);
    ctx.globalAlpha=a*0.9;
    ctx.fillStyle=q.color;
    ctx.shadowColor=q.color; ctx.shadowBlur=10*a;
    ctx.beginPath();ctx.arc(q.x,q.y,q.r*a*0.6+q.r*0.4,0,Math.PI*2);ctx.fill();
  }
  ctx.shadowBlur=0;ctx.restore();
}

function renderLasers(){
  ctx.save();
  for(const l of S.lasers){
    const a=l.life/l.maxLife;
    ctx.strokeStyle=`rgba(0,255,170,${a*0.9})`;ctx.lineWidth=3*a+1;
    ctx.shadowColor='#00ffcc';ctx.shadowBlur=12*a;
    ctx.beginPath();ctx.moveTo(l.ox,l.oy);ctx.lineTo(l.ex,l.ey);ctx.stroke();
    if(l.hit){
      ctx.fillStyle=`rgba(255,220,80,${a})`;ctx.shadowColor='#ffdd44';ctx.shadowBlur=20*a;
      ctx.beginPath();ctx.arc(l.ex,l.ey,10*a,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.shadowBlur=0;ctx.restore();
}

// Spheres of influence — shown in cheat mode as dotted circles
// Radius where body gravity = SOI_ACCEL (10% of max thrust)
function renderGravContours(){
  if(!CONFIG.gravContours) return;

  const cw=canvas.width, ch=canvas.height;
  const hw=cw/2/S.cam.zoom, hh=ch/2/S.cam.zoom;
  const wx0=S.cam.x-hw, wy0=S.cam.y-hh;
  const ww=hw*2, wh=hh*2;

  // Cell size in screen pixels — fieldLineDensity shrinks the step (more cells = finer lines)
  const STEP_PX=Math.max(4, Math.round(14/CONFIG.fieldLineDensity));
  const COLS=Math.ceil(cw/STEP_PX), ROWS=Math.ceil(ch/STEP_PX);
  const wStep=ww/COLS, hStep=wh/ROWS;
  const W=COLS+1, H=ROWS+1;

  // Stars and planets dominate at game scales; skip moons/asteroids
  const bodies=S.bodies.filter(b=>b.type==='star'||b.type==='planet');
  if(!bodies.length) return;

  const Geff=G*CONFIG.gravMult;

  // Sample gravitational acceleration magnitude on the visible-world grid
  const field=new Float32Array(W*H);
  for(let r=0;r<H;r++){
    const wy=wy0+r*hStep;
    for(let c=0;c<W;c++){
      const wx=wx0+c*wStep;
      let ax=0,ay=0;
      for(const b of bodies){
        const dx=b.x-wx, dy=b.y-wy;
        const r2=dx*dx+dy*dy;
        if(r2<400) continue;
        const inv=1/Math.sqrt(r2);
        const f=Geff*b.mass*inv*inv;
        ax+=f*dx*inv; ay+=f*dy*inv;
      }
      field[r*W+c]=Math.hypot(ax,ay);
    }
  }

  // Log-spaced iso-levels 0.3→1000; count scales with fieldLineDensity so
  // Sparse(0.5)=4 levels, Normal(1.0)=8, Dense(1.5)=12, Fine(2.0)=16
  const nLev=Math.max(2,Math.round(8*CONFIG.fieldLineDensity));
  const logMin=Math.log10(0.3),logMax=Math.log10(1000);
  const LEVELS=Array.from({length:nLev},(_,i)=>Math.pow(10,logMin+(logMax-logMin)*i/Math.max(nLev-1,1)));
  const COLORS=LEVELS.map((_,i)=>{const t=i/Math.max(nLev-1,1);return`rgb(${Math.round(t*128)},${Math.round(40+t*200)},${Math.round(64+t*191)})`;});
  const ALPHAS=LEVELS.map((_,i)=>0.30+(i/Math.max(nLev-1,1))*0.42);
  const WIDTHS=LEVELS.map((_,i)=>1.0+(i/Math.max(nLev-1,1))*0.6);

  ctx.save();
  ctx.lineCap='round'; ctx.lineJoin='round';

  for(let li=0;li<LEVELS.length;li++){
    const lv=LEVELS[li];
    ctx.strokeStyle=COLORS[li];
    ctx.lineWidth=WIDTHS[li]/S.cam.zoom;
    ctx.globalAlpha=ALPHAS[li];
    ctx.beginPath();

    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const f00=field[r*W+c],     f10=field[r*W+c+1];
        const f01=field[(r+1)*W+c], f11=field[(r+1)*W+c+1];
        const x0=wx0+c*wStep, x1=x0+wStep;
        const y0=wy0+r*hStep, y1=y0+hStep;

        const b00=f00>=lv, b10=f10>=lv, b01=f01>=lv, b11=f11>=lv;
        const eT=b00!==b10, eR=b10!==b11, eB=b01!==b11, eL=b00!==b01;
        if(!eT&&!eR&&!eB&&!eL) continue;

        // Interpolated crossing point on each crossed edge
        const pt=eT?{x:x0+wStep*(lv-f00)/(f10-f00),y:y0}:null;
        const pr=eR?{x:x1,y:y0+hStep*(lv-f10)/(f11-f10)}:null;
        const pb=eB?{x:x0+wStep*(lv-f01)/(f11-f01),y:y1}:null;
        const pl=eL?{x:x0,y:y0+hStep*(lv-f00)/(f01-f00)}:null;

        const pts=[pt,pr,pb,pl].filter(Boolean);

        if(pts.length===2){
          ctx.moveTo(pts[0].x,pts[0].y);
          ctx.lineTo(pts[1].x,pts[1].y);
        } else if(pts.length===4){
          // Saddle — resolve topology by diagonal corner pair above threshold
          if(b00&&b11){
            ctx.moveTo(pt.x,pt.y); ctx.lineTo(pl.x,pl.y);
            ctx.moveTo(pr.x,pr.y); ctx.lineTo(pb.x,pb.y);
          } else {
            ctx.moveTo(pt.x,pt.y); ctx.lineTo(pr.x,pr.y);
            ctx.moveTo(pb.x,pb.y); ctx.lineTo(pl.x,pl.y);
          }
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function renderSOI(){
  ctx.save();
  ctx.setLineDash([6,10]);
  for(const b of S.bodies){
    const soiR=Math.sqrt(G*b.mass/SOI_ACCEL);
    // Skip if circle would be tiny on screen
    if(soiR*S.cam.zoom<20) continue;
    let col;
    if      (b.type==='star')     col='rgba(255,200,60,0.28)';
    else if (b.type==='planet')   col=b.color+'55';
    else if (b.type==='moon')     col='rgba(160,160,160,0.22)';
    else                          col='rgba(120,100,80,0.18)';
    ctx.strokeStyle=col; ctx.lineWidth=1.2/S.cam.zoom;
    ctx.beginPath();ctx.arc(b.x,b.y,soiR,0,Math.PI*2);ctx.stroke();
  }
  ctx.setLineDash([]);ctx.restore();
}

function renderTraj(){
  const{pts,hit}=computeTraj(); if(pts.length<2) return;
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
function fnt(sz, mono=true) { return `${sz}px ${mono?'"Orbitron", monospace':'Georgia, serif'}`; }

function renderHUD(){
  const cw=canvas.width,ch=canvas.height;
  const sh=S.ship;

  // ---- Fuel bar ----
  const fw=300,fh=22,fx=22,fy=22;
  const fp=sh.fuel/CONFIG.fuelMax;
  const now_ms=Date.now();

  // Blink timing: slow at <10%, fast at <3%
  const blinkSlow = Math.floor(now_ms/500)%2===0;   // 1 Hz
  const blinkFast = Math.floor(now_ms/165)%2===0;   // ~3 Hz
  const isLow      = fp<0.10;
  const isCritical = fp<0.03;
  const isAlarm    = fp<0.01;
  const barVisible = isCritical ? blinkFast : (isLow ? blinkSlow : true);

  // Bar color
  let fc;
  if(isCritical)       fc='#ff2233';
  else if(isLow)       fc='#ffdd00';
  else if(fp>0.50)     fc='#22ffbb';
  else if(fp>0.25)     fc='#ffaa00';
  else                 fc=C_WARN;

  ctx.fillStyle='#0a0f1a';ctx.fillRect(fx,fy,fw,fh);
  if(barVisible) { ctx.fillStyle=fc;ctx.fillRect(fx,fy,fw*fp,fh); }
  ctx.strokeStyle=isLow?fc:'#1a3355';ctx.lineWidth=1;ctx.strokeRect(fx,fy,fw,fh);

  ctx.fillStyle=C_LABEL;ctx.font=fnt(20);ctx.fillText('FUEL',fx+fw+10,fy+10);
  // Emergency fuel tank indicator
  if(S.extraFuelReady){
    const et=Date.now()/1000;
    const pulse=0.7+0.3*Math.sin(et*2.5);
    ctx.fillStyle=`rgba(80,255,160,${pulse})`;
    ctx.font='bold '+fnt(18);
    ctx.fillText('F · EMERGENCY TANK +30%',fx+fw+10,fy+44);
  } else {
    ctx.fillStyle='#223344';ctx.font=fnt(18);
    ctx.fillText('F · tank used (next run)',fx+fw+10,fy+44);
  }
  ctx.fillStyle=fc;ctx.font=fnt(18);
  ctx.fillText(`${Math.ceil(sh.fuel)} / ${CONFIG.fuelMax}  ·  ${Math.floor(fp*100)}%`,fx+fw+10,fy+26);

  // CRITICAL label
  if(isAlarm){
    ctx.fillStyle=`rgba(255,30,40,${blinkFast?1:0.4})`;
    ctx.font='bold '+fnt(22);ctx.textAlign='center';
    ctx.fillText('CRITICAL',fx+fw/2,fy+16);
    ctx.textAlign='left';
  }

  // Fuel bonus popups — large floating text at ship position
  ctx.textAlign='center';
  for(const p of S.fuelPopups){
    const sx=p.wx!=null ? w2s(p.wx,p.wy).x : fx+fw/2;
    const sy=p.wx!=null ? w2s(p.wx,p.wy).y-p.dy*2.5-50 : fy-12-p.dy;
    ctx.globalAlpha=p.alpha;
    ctx.shadowColor='rgba(60,255,150,0.9)'; ctx.shadowBlur=16;
    ctx.fillStyle='#55ffbb';
    ctx.font='bold '+fnt(38);
    ctx.fillText(`+${p.amount} FUEL`,sx,sy);
    ctx.shadowBlur=0;
  }
  ctx.globalAlpha=1; ctx.textAlign='left';

  // Low-fuel screen pulse (only below 3%, synced to fast blink)
  if(isCritical&&blinkFast){
    ctx.fillStyle='rgba(255,40,40,0.10)';ctx.fillRect(0,0,cw,ch);
  }

  // Laser cooldown bar
  const lfy=fy+fh+5;
  if(sh.laserCooldown>0){
    const lp=sh.laserCooldown/LASER_COOL;
    ctx.fillStyle='#071410';ctx.fillRect(fx,lfy,fw,7);
    ctx.fillStyle=`rgba(0,255,180,${0.6-lp*0.2})`;
    ctx.fillRect(fx,lfy,fw*(1-lp),7);
    ctx.strokeStyle='#0a2a22';ctx.lineWidth=1;ctx.strokeRect(fx,lfy,fw,7);
  }

  const statY=lfy+(sh.laserCooldown>0?14:8)+16;

  if(sh.fuel<=0&&sh.zeroFuelTimer>0){
    const sLeft=Math.ceil(DEAD_DRIFT-sh.zeroFuelTimer);
    ctx.fillStyle=C_WARN;ctx.font='bold '+fnt(30);
    ctx.fillText(`DRIFTING — ${sLeft}s`,fx,statY);
  } else {
    const spd=Math.hypot(sh.vx,sh.vy).toFixed(0);
    ctx.fillStyle=C_VALUE;ctx.font=fnt(27);
    ctx.fillText(`SPD  ${spd}`,fx,statY);
  }

  // ---- Cheat HUD: gravity magnitude + bearing ----
  let gravHudH=0;
  if(S.cheat&&sh.alive){
    const g=gravAt(sh.x,sh.y);
    const gMag=Math.hypot(g.ax,g.ay);
    if(gMag>=0.5){
      const fwdX=Math.sin(sh.angle),fwdY=-Math.cos(sh.angle);
      const gnx=g.ax/gMag,gny=g.ay/gMag;
      const cross=fwdX*gny-fwdY*gnx;
      const dot=fwdX*gnx+fwdY*gny;
      const bearDeg=Math.round(Math.atan2(cross,dot)*180/Math.PI);
      const bearStr=bearDeg===0?'fwd':Math.abs(bearDeg)>=175?'aft':`${Math.abs(bearDeg)}° ${cross>=0?'R':'L'}`;
      ctx.fillStyle=C_LABEL;ctx.font=fnt(22);
      ctx.fillText(`GRAV  ${gMag.toFixed(1)} u/s²  ·  ${bearStr}`,fx,statY+28);
      gravHudH=28;
    }
  }

  // Grace indicator
  if(sh.grace>0){
    ctx.fillStyle='rgba(80,200,255,0.7)';ctx.font='bold '+fnt(26);
    ctx.textAlign='center';ctx.fillText('SPAWN SHIELD',cw/2,46);ctx.textAlign='left';
  }

  // Edge of space warning
  if(S.nearEdge){
    const blink=Math.floor(now_ms/400)%2===0;
    ctx.fillStyle=`rgba(255,0,0,${blink?1:0.45})`;
    ctx.font='bold '+fnt(28);ctx.textAlign='center';
    ctx.fillText('WARNING: EDGE OF SPACE',cw/2,74);
    ctx.textAlign='left';
  }

  // ---- Objectives ----
  ctx.font=fnt(30);
  const oy=statY+36+gravHudH;
  for(let i=0;i<S.objectives.length;i++){
    const obj=S.objectives[i];
    ctx.fillStyle=obj.complete?C_GOOD:obj.color;
    let lbl=`${obj.complete?'✓':'○'}  ${obj.label}`;
    if(!obj.complete){
      if(obj.type==='mine'&&obj.progress>0)   lbl+=`  [${(obj.progress*100).toFixed(0)}%]`;
      if(obj.type==='orbit'&&obj.timer>0)      lbl+=`  [${obj.timer.toFixed(1)}s]`;
      if(obj.type==='slingshot')               lbl+=`  [${obj.completed.size}/${obj.targets.length}]`;
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
      } else{tx=obj.x;ty=obj.y;}
      if(tx!=null) drawArrow(tx,ty,obj.color);
    }
  }

  // ---- Cheat mode ----
  if(S.cheat){
    ctx.fillStyle=C_WARN;ctx.font='bold '+fnt(30);
    const gravLabel=CONFIG.gravContours?'grav field ON':'G:grav field';
    ctx.textAlign='center';ctx.fillText(`⚠  CHEAT MODE  —  trajectory · SOI · grav/accel vectors · ${gravLabel}`,cw/2,28);ctx.textAlign='left';
  }

  // Wave number — top right
  ctx.fillStyle=C_DIM;ctx.font=fnt(26);
  ctx.textAlign='right';ctx.fillText(`WAVE ${S.wave}`,cw-16,38);ctx.textAlign='left';

  // Wave-complete banner
  if(S.waveBanner){
    const fade=Math.min(1,S.waveTimer/0.4)*Math.min(1,(S.waveTimer/2.4)*2);
    ctx.fillStyle=`rgba(0,255,160,${fade})`;
    ctx.font='bold '+fnt(64);
    ctx.textAlign='center';ctx.fillText(`WAVE ${S.wave} COMPLETE`,cw/2,ch/2-60);ctx.textAlign='left';
  }

  // Bottom row: version left, controls centre, zoom right
  const ver = window.GAME_VER || 'dev';
  ctx.fillStyle=C_DIM;ctx.font=fnt(21);
  ctx.textAlign='left';
  ctx.fillText(ver, 22, ch-14);
  ctx.textAlign='center';
  ctx.fillText('WASD · SHIFT:boost · SPACE:laser · F:emerg.fuel · -/=:zoom · M:map · Tab:settings · `:cheat · R:restart · ESC:pause', cw/2, ch-14);
  ctx.textAlign='right';
  ctx.fillText(`×${S.cam.zoom.toFixed(2)}`, cw-16, ch-14);
  if(CONFIG.showFPS){ctx.fillText(`${_fps} fps`,cw-16,ch-34);}
  ctx.textAlign='left';

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
  ctx.fillStyle=color;ctx.font=fnt(22);
  ctx.textAlign='center';ctx.fillText(d.toFixed(0),0,30);ctx.textAlign='left';
  ctx.restore();
}

function renderMinimap(){
  const mm=170,mx=canvas.width-mm-14,my=canvas.height-mm-44;
  const sc=mm/MAP;
  ctx.fillStyle='rgba(0,0,18,0.75)';ctx.fillRect(mx,my,mm,mm);
  ctx.strokeStyle='#1a3355';ctx.lineWidth=1;ctx.strokeRect(mx,my,mm,mm);
  for(const b of S.bodies){
    const bx=mx+b.x*sc,by=my+b.y*sc,br=Math.max(2,b.radius*sc*3);
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
      if(pi!=null){ox=S.bodies[pi].x;oy=S.bodies[pi].y;}else continue;
    }
    if(ox==null) continue;
    ctx.fillStyle=obj.color;ctx.beginPath();ctx.arc(mx+ox*sc,my+oy*sc,4,0,Math.PI*2);ctx.fill();
  }
  // Ship — bright oriented triangle with glow ring
  const smx=mx+S.ship.x*sc, smy=my+S.ship.y*sc, smr=7;
  ctx.save();ctx.translate(smx,smy);ctx.rotate(S.ship.angle);
  ctx.strokeStyle='rgba(0,255,180,0.55)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.arc(0,0,smr+4,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#00ffcc';
  ctx.beginPath();
  ctx.moveTo(0,-smr);ctx.lineTo(smr*0.65,smr*0.9);ctx.lineTo(0,smr*0.35);ctx.lineTo(-smr*0.65,smr*0.9);
  ctx.closePath();ctx.fill();
  ctx.restore();
  ctx.fillStyle=C_DIM;ctx.font=fnt(20);ctx.fillText('M · hide',mx+2,my+mm+22);
}

// ================================================================
// SCREENS
// ================================================================
function renderMenu(){
  const cw=canvas.width,ch=canvas.height;
  const mt=Date.now()/1000;
  for(const s of S.bgStars){
    const twinkle=0.65+0.35*Math.sin(mt*s.speed+s.phase);
    ctx.globalAlpha=s.a*twinkle*0.65;ctx.fillStyle=s.bright?'#cce8ff':'#ffffff';
    ctx.beginPath();ctx.arc(s.x%cw,s.y%ch,s.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
  ctx.textAlign='center';

  // Title — large, bold cyan
  ctx.fillStyle='#11ddff';
  ctx.font='bold 144px "Orbitron", monospace';
  ctx.fillText('SPACE PIONEER',cw/2,ch*0.38);

  // Subtitle
  ctx.fillStyle='#336688';ctx.font=fnt(40);
  ctx.fillText('navigate gravity · reach objectives · survive',cw/2,ch*0.38+64);

  // Prompt — pulsing
  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(0,220,180,${0.55+0.45*Math.sin(t*2)})`;
  ctx.font='bold '+fnt(56);
  ctx.fillText('PRESS  ENTER  TO  LAUNCH',cw/2,ch*0.38+148);

  // Controls
  ctx.fillStyle=C_DIM;ctx.font=fnt(30);
  ctx.fillText('WASD · SHIFT:boost · SPACE:laser · F:emerg.fuel · -/=:zoom · `:cheat',cw/2,ch*0.38+212);

  // Version tag (bottom-right)
  const ver = (window.GAME_VER) || 'dev';
  ctx.fillStyle='#223344';ctx.font=fnt(24);
  ctx.textAlign='right';ctx.fillText(ver,cw-20,ch-16);

  ctx.textAlign='left';
}

function renderDead(){
  const cw=canvas.width,ch=canvas.height;
  // Light vignette only — keep explosion visible through the overlay
  ctx.fillStyle='rgba(4,0,0,0.25)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';

  ctx.fillStyle='rgba(255,34,68,0.70)';ctx.font='bold 120px "Orbitron", monospace';
  ctx.fillText('SHIP  DESTROYED',cw/2,ch/2-110);

  const causeLabels={star:'struck a star',planet:'planetary collision',moon:'moon impact',
    asteroid:'asteroid strike',comet:'comet impact',fuel:'fuel exhausted',oob:'lost in the void'};
  ctx.fillStyle='rgba(255,170,68,0.60)';ctx.font=fnt(48);
  ctx.fillText(`cause:  ${causeLabels[S.death.cause]||'unknown forces'}`,cw/2,ch/2-40);

  ctx.fillStyle='rgba(170,187,221,0.55)';ctx.font=`italic ${fnt(52,false)}`;
  ctx.fillText(`"${S.death.message}"`,cw/2,ch/2+30);

  ctx.fillStyle='rgba(80,100,130,0.50)';ctx.font=fnt(38);
  ctx.fillText(`time: ${S.time.toFixed(1)}s  ·  objectives: ${S.objectivesDone}  ·  wave: ${S.wave}`,cw/2,ch/2+96);

  const t=Date.now()/1000;
  ctx.fillStyle=`rgba(100,180,220,${0.45+0.45*Math.sin(t*2)})`;
  ctx.font=fnt(46);
  ctx.fillText('ENTER · new mission      ESC · menu',cw/2,ch/2+172);
  ctx.textAlign='left';
}


function renderPause(){
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(0,0,cw,ch);
  ctx.textAlign='center';
  ctx.fillStyle='#aaccff';ctx.font='bold 120px "Orbitron", monospace';
  ctx.fillText('PAUSED',cw/2,ch/2+20);
  ctx.fillStyle=C_DIM;ctx.font=fnt(46);
  ctx.fillText('ESC · resume',cw/2,ch/2+96);
  ctx.textAlign='left';
}

// ================================================================
// VIEWPORT VIGNETTE
// ================================================================
function renderVignette(){
  const cw=canvas.width,ch=canvas.height;
  const cx=cw/2,cy=ch/2,rad=Math.max(cw,ch)*0.75;
  const g=ctx.createRadialGradient(cx,cy,rad*0.35,cx,cy,rad);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,'rgba(55,0,0,0.55)');
  ctx.fillStyle=g;ctx.fillRect(0,0,cw,ch);
}

// ================================================================
// CONFIG PANEL
// ================================================================
function _cfgBtn(label,active,x,y,w,h,action){
  ctx.fillStyle=active?'#1a3a5a':'#080e1c';
  ctx.strokeStyle=active?'#22aaee':'#223344';
  ctx.lineWidth=1.2;
  ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
  ctx.fillStyle=active?'#88ddff':C_DIM;
  ctx.font=fnt(20);ctx.textAlign='center';
  ctx.fillText(label,x+w/2,y+h*0.67);
  _configBtns.push({rect:[x,y,w,h],action});
}

function renderConfig(){
  const cw=canvas.width,ch=canvas.height;
  const pw=500,ph=700,px=(cw-pw)/2,py=Math.max(8,(ch-ph)/2);
  _configBtns=[];

  ctx.fillStyle='rgba(4,8,20,0.96)';
  ctx.fillRect(px,py,pw,ph);
  ctx.strokeStyle='#334466';ctx.lineWidth=1.5;
  ctx.strokeRect(px,py,pw,ph);

  ctx.fillStyle=C_LABEL;ctx.font='bold '+fnt(28);
  ctx.textAlign='center';ctx.fillText('SETTINGS',cw/2,py+38);
  ctx.fillStyle=C_DIM;ctx.font=fnt(18);
  ctx.fillText('Tab · close',cw/2,py+58);

  const lx=px+18,bh=34,gap=8,labelW=130;
  let row=py+78;

  // ---- Risk Level ----
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('RISK',lx,row+bh*0.67);
  const rlW=Math.floor((pw-36-labelW-gap*3)/4);
  RISK_PRESETS.forEach(([lbl,vals],i)=>{
    const active=CONFIG.gravMult===vals.gravMult&&CONFIG.cometRate===vals.cometRate&&
                 CONFIG.fuelMax===vals.fuelMax&&CONFIG.refuelMult===vals.refuelMult;
    _cfgBtn(lbl,active,lx+labelW+i*(rlW+gap),row,rlW,bh,()=>{
      CONFIG.gravMult=vals.gravMult; CONFIG.cometRate=vals.cometRate;
      CONFIG.fuelMax=vals.fuelMax;   CONFIG.refuelMult=vals.refuelMult;
    });
  });

  row+=bh+10;
  // Gravity
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('GRAVITY',lx,row+bh*0.67);
  const gw=56;
  GRAV_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.gravMult===val,lx+labelW+i*(gw+gap),row,gw,bh,()=>{CONFIG.gravMult=val;});
  });

  row+=bh+10;
  // Comets
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('COMETS',lx,row+bh*0.67);
  const cw2=68;
  COMET_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.cometRate===val,lx+labelW+i*(cw2+gap),row,cw2,bh,()=>{CONFIG.cometRate=val;});
  });

  row+=bh+10;
  // Music
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('MUSIC',lx,row+bh*0.67);
  _cfgBtn('On', CONFIG.music,  lx+labelW,      row,76,bh,()=>{CONFIG.music=true;});
  _cfgBtn('Off',!CONFIG.music, lx+labelW+84,   row,76,bh,()=>{CONFIG.music=false;});

  row+=bh+10;
  // FPS
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('FPS',lx,row+bh*0.67);
  _cfgBtn('On', CONFIG.showFPS, lx+labelW,     row,76,bh,()=>{CONFIG.showFPS=true;});
  _cfgBtn('Off',!CONFIG.showFPS,lx+labelW+84,  row,76,bh,()=>{CONFIG.showFPS=false;});

  // ---- next-run divider ----
  row+=bh+14;
  ctx.strokeStyle='#1a2a44';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(px+16,row);ctx.lineTo(px+pw-16,row);ctx.stroke();
  ctx.fillStyle=C_DIM;ctx.font=fnt(17);ctx.textAlign='center';
  ctx.fillText('takes effect on next run  (R / Enter)',cw/2,row+14);
  row+=22;

  // Max Fuel
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('MAX FUEL',lx,row+bh*0.67);
  const fw=80;
  FUEL_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.fuelMax===val,lx+labelW+i*(fw+gap),row,fw,bh,()=>{CONFIG.fuelMax=val;});
  });

  row+=bh+10;
  // Refuel factor
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('REFUEL',lx,row+bh*0.67);
  const rfw=68;
  REFUEL_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.refuelMult===val,lx+labelW+i*(rfw+gap),row,rfw,bh,()=>{CONFIG.refuelMult=val;});
  });

  row+=bh+10;
  // Map size
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('MAP SIZE',lx,row+bh*0.67);
  const mw=70;
  MAP_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.mapSize===val,lx+labelW+i*(mw+gap),row,mw,bh,()=>{CONFIG.mapSize=val;});
  });

  row+=bh+10;
  // Body density
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('BODIES',lx,row+bh*0.67);
  const dw=70;
  DENSITY_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.bodyDensity===val,lx+labelW+i*(dw+gap),row,dw,bh,()=>{CONFIG.bodyDensity=val;});
  });

  // ---- cheats divider ----
  row+=bh+14;
  ctx.strokeStyle='#1a2a44';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(px+16,row);ctx.lineTo(px+pw-16,row);ctx.stroke();
  ctx.fillStyle='#334466';ctx.font='bold '+fnt(17);ctx.textAlign='center';
  ctx.fillText('CHEATS  (active in cheat mode only — ` key)',cw/2,row+14);
  row+=22;

  // Grav Contours toggle
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('GRAV FIELD',lx,row+bh*0.67);
  _cfgBtn('On', CONFIG.gravContours, lx+labelW,     row,76,bh,()=>{CONFIG.gravContours=true;});
  _cfgBtn('Off',!CONFIG.gravContours,lx+labelW+84,  row,76,bh,()=>{CONFIG.gravContours=false;});

  row+=bh+10;
  // Gravity vector scale
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('VEC SCALE',lx,row+bh*0.67);
  const vw=64;
  GRAV_VECTOR_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.gravVectorScale===val,lx+labelW+i*(vw+gap),row,vw,bh,()=>{CONFIG.gravVectorScale=val;});
  });

  row+=bh+10;
  // Field line density
  ctx.fillStyle=C_VALUE;ctx.font=fnt(21);ctx.textAlign='left';
  ctx.fillText('FIELD LINES',lx,row+bh*0.67);
  const fdw=68;
  FIELD_DENSITY_PRESETS.forEach(([lbl,val],i)=>{
    _cfgBtn(lbl,CONFIG.fieldLineDensity===val,lx+labelW+i*(fdw+gap),row,fdw,bh,()=>{CONFIG.fieldLineDensity=val;});
  });

  ctx.textAlign='left';
}

function handleConfigClick(mx,my){
  for(const b of _configBtns){
    const[x,y,w,h]=b.rect;
    if(mx>=x&&mx<=x+w&&my>=y&&my<=y+h){b.action();return;}
  }
  // Click outside panel closes it
  const cw=canvas.width,ch=canvas.height,pw=500,ph=700;
  const px=(cw-pw)/2,py=Math.max(8,(ch-ph)/2);
  if(mx<px||mx>px+pw||my<py||my>py+ph){UI.configOpen=false;if(UI.configPaused){S.phase='playing';UI.configPaused=false;}}
}

function renderDocking(){
  if(!S.docking) return;
  const d=S.docking;
  const progress=d.timer/d.duration;
  const now=Date.now()/1000;

  // World-space: animated fuel cable ship→station
  ctx.save();
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.scale(S.cam.zoom,S.cam.zoom);
  ctx.translate(-S.cam.x,-S.cam.y);
  const flow=(now*2.5)%1;
  ctx.setLineDash([14,10]);ctx.lineDashOffset=-flow*24;
  ctx.strokeStyle='rgba(68,255,170,0.72)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(d.x,d.y);ctx.lineTo(d.obj.x,d.obj.y);ctx.stroke();
  ctx.setLineDash([]);
  // Glow at station end
  const gr=ctx.createRadialGradient(d.obj.x,d.obj.y,0,d.obj.x,d.obj.y,48);
  gr.addColorStop(0,`rgba(68,255,170,${0.28*progress})`);
  gr.addColorStop(1,'rgba(68,255,170,0)');
  ctx.fillStyle=gr;ctx.beginPath();ctx.arc(d.obj.x,d.obj.y,48,0,Math.PI*2);ctx.fill();
  ctx.restore();

  // HUD overlay
  const cw=canvas.width,ch=canvas.height;
  ctx.fillStyle='rgba(68,255,170,0.92)';ctx.font='bold '+fnt(26);
  ctx.textAlign='center';ctx.fillText('DOCKING',cw/2,ch/2-26);
  // Progress bar
  const bw=220,bh=8,bx=cw/2-bw/2,by=ch/2-10;
  ctx.fillStyle='#071814';ctx.fillRect(bx,by,bw,bh);
  ctx.fillStyle='#44ffaa';ctx.fillRect(bx,by,bw*progress,bh);
  ctx.strokeStyle='#22aa77';ctx.lineWidth=1;ctx.strokeRect(bx,by,bw,bh);
  ctx.textAlign='left';
}

// ================================================================
// MASTER RENDER
// ================================================================
function render(){
  ctx.fillStyle='#020818';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(S.phase==='menu'){renderMenu();return;}

  ctx.save();applyCamera();
  renderBgStars();
  renderNebula();
  if(S.cheat) renderSOI();
  renderGravContours();
  renderBodies();renderComets();
  renderObjMarkers();renderLasers();
  renderBoostTrail();
  if(S.ship.alive) renderShip();
  if(S.cheat&&S.ship.alive) renderGravVector();
  if(S.cheat&&S.ship.alive&&S.ship.thrusting) renderAccelVector();
  renderExplosion();
  ctx.restore();

  renderVignette();
  if(S.docking) renderDocking();
  if(S.cheat&&S.ship.alive&&S.phase==='playing') renderTraj();
  if(S.phase==='playing'||S.phase==='paused') renderHUD();
  if(S.phase==='paused'&&!UI.configOpen) renderPause();
  if(S.phase==='dead')  {renderHUD();renderDead();}
  if(UI.configOpen) renderConfig();
}

// ================================================================
// INPUT
// ================================================================
const keys={};
canvas.addEventListener('mousedown',e=>{
  if(UI.configOpen) handleConfigClick(e.clientX,e.clientY);
});

window.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  keys[e.code]=true;

  switch(e.code){
    case 'Tab':
      e.preventDefault();
      if(!UI.configOpen){
        UI.configOpen=true;
        if(S.phase==='playing'){S.phase='paused';UI.configPaused=true;}
      } else {
        UI.configOpen=false;
        if(UI.configPaused){S.phase='playing';UI.configPaused=false;}
      }
      break;
    case 'Escape':
      if(UI.configOpen){UI.configOpen=false;if(UI.configPaused){S.phase='playing';UI.configPaused=false;}break;}
      if(S.phase==='playing')     S.phase='paused';
      else if(S.phase==='paused') S.phase='playing';
      else if(S.phase==='dead') S.phase='menu';
      break;
    case 'Enter':case 'NumpadEnter':
      if(S.phase==='menu'||S.phase==='dead') startRun();
      break;
    case 'KeyR':
      if(S.phase==='playing'||S.phase==='paused') startRun();
      break;
    case 'Backquote':
      if(S.phase==='playing') S.cheat=!S.cheat;
      break;
    case 'KeyG':
      if(S.phase==='playing'&&S.cheat) CONFIG.gravContours=!CONFIG.gravContours;
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
    case 'KeyF':
      if(S.phase==='playing'&&S.extraFuelReady&&S.ship.alive){
        const bonus=Math.round(CONFIG.fuelMax*0.30);
        S.ship.fuel=Math.min(CONFIG.fuelMax,S.ship.fuel+bonus);
        S.fuelPopups.push({amount:bonus,alpha:1.0,dy:0,wx:S.ship.x,wy:S.ship.y});
        S.extraFuelReady=false;
        playChime();
      }
      break;
  }
},{passive:false});
window.addEventListener('keyup',e=>{keys[e.code]=false;});

// ================================================================
// GAME LOOP
// ================================================================
let lastTs=0;
let _fps=60, _fpsFrames=0, _fpsTimer=0;

function startRun(){
  initAudio();
  _resetMusic();
  if(S.phase==='dead') S.runCount=(S.runCount||0)+1;
  S.phase='playing';S.cheat=false;S.showMinimap=true;
  S.extraFuelReady=(S.runCount%2===0);
  genWorld();
}

function loop(ts){
  const dt=Math.min((ts-lastTs)/1000,0.05);
  lastTs=ts;
  _fpsFrames++; _fpsTimer+=dt;
  if(_fpsTimer>=0.5){_fps=Math.round(_fpsFrames/_fpsTimer);_fpsFrames=0;_fpsTimer=0;}
  if(S.phase==='playing'){
    S.time+=dt;
    updateCam(dt);updateBodies(dt);updateComets(dt);
    updatePhysics(dt);updateLasers(dt);
    updateObjectives(dt);updateDocking(dt);updateFuelPopups(dt);updateEdgeWarning(dt);updateAudio(dt);
  }
  updateExplosion(dt);
  render();
  requestAnimationFrame(loop);
}

// ================================================================
// INIT
// ================================================================
function init(){
  initState();
  S.bgStars=[];
  for(let i=0;i<300;i++)
    S.bgStars.push({x:Math.random()*MAP,y:Math.random()*MAP,r:Math.random()*0.9+0.3,a:Math.random()*0.5+0.2,phase:Math.random()*Math.PI*2,speed:Math.random()*0.8+0.2,bright:false});
  for(let i=0;i<30;i++)
    S.bgStars.push({x:Math.random()*MAP,y:Math.random()*MAP,r:Math.random()*1.2+1.4,a:0.85+Math.random()*0.15,phase:Math.random()*Math.PI*2,speed:Math.random()*1.5+0.8,bright:true});
  requestAnimationFrame(ts=>{lastTs=ts;loop(ts);});
}

loadAssets([['ship','assets/ship.webp'],['station','assets/station.webp'],['asteroid','assets/asteroid.webp']], init);
