/* ==========================================================================
   MOSQUITO SLAYER
   A tiny bedtime arcade game.
   --------------------------------------------------------------------------
   Drop your own assets in the CONFIG block below. Nothing else needs editing.
   ========================================================================== */
(() => {
  'use strict';

  /* ======================= CONFIG — edit me ======================= */
  const CONFIG = {
    FACES: {
      // IMG1 is the normal face; IMG3 replaces it during the bite.
      sleep: ['assets/faces/main.png'],
      hit: 'assets/faces/bite.png',
      tilt: -50 * Math.PI / 180 // 50 degrees counterclockwise (toward the left); change 50 to tune
    },

    SOUNDS: {
      // Leave a value empty ('') to use the built-in synthesized sound.
      // Files can be .m4a, .mp3, .wav or .ogg.
      buzz: 'assets/sounds/mosquito-loop.mp3',
      fire: 'assets/sounds/fire.mp3',
      lose: 'assets/sounds/game-over.mp3',
      highscore: 'assets/sounds/high-score.mp3', // SOUND4: new best score
      hit:  '',   // successful zap        e.g. 'assets/sounds/splat.mp3'
      miss: '',   // missed shot
      bite: '',   // mosquito bites you
      ui:   ''    // button click
    },

    // The mosquito is a sprite. It was pre-rotated so the nose points right (+x).
    // pivotX/pivotY = where the body sits inside the image (0..1).
    // length = sprite length in multiples of the mosquito size (bigger = bigger bug).
    MOSQUITO: { src: 'assets/mosquito.png', pivotX: 0.532, pivotY: 0.437, length: 2.55 },

    // A new level every N kills.
    KILLS_PER_LEVEL: 5,

    VOLUME: 0.85,

    // Difficulty
    START_SPEED: 0.30,      // screen-widths per second at score 0
    SPEED_PER_SCORE: 0.022, // gets faster every point
    MAX_SPEED: 0.92,
    DIVE_AFTER: [2.3, 3.9], // seconds before it dives for your face
    DIVE_SPEED: 1.5,        // multiplier while diving
    COOLDOWN: 0.30,         // seconds between zaps
    RESPAWN: 0.70,          // seconds until the next mosquito
    AIM_ASSIST: 0.95        // forgiving hit radius (multiplier of bug size)
  };
  /* ================================================================ */

  /* ---------------- tiny helpers ---------------- */
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const INK = '#22202c';
  const FONT = 'ui-rounded, "SF Pro Rounded", "Segoe UI", "Trebuchet MS", system-ui, sans-serif';

  /* ---------------- DOM ---------------- */
  const cv = $('game');
  const ctx = cv.getContext('2d', { alpha: false });
  const stage = $('stage');
  const hud = $('hud');
  const scoreEl = $('score');
  const streakEl = $('streakLine');
  const bestEl = $('best');
  const bestMenuEl = $('bestMenu');
  const lvlEl = $('lvl');
  const hintEl = $('hint');
  const screens = {
    menu: $('screenMenu'),
    pause: $('screenPause'),
    over: $('screenOver')
  };
  const btnMute = $('btnMute');
  const btnMuteMenu = $('btnMuteMenu');
  const btnMutePause = $('btnMutePause');

  /* ---------------- state ---------------- */
  const G = {
    mode: 'menu',        // menu | playing | paused | dying | over
    t: 0,                // scene clock (stops when paused)
    animT: 0,            // ambient character animation clock (keeps running while paused)
    score: 0,
    streak: 0,
    streakTimer: 0,
    best: parseInt(store.get('ms2.best', '0'), 10) || 0,
    muted: store.get('ms2.mute', '0') === '1',
    cool: 0,
    respawn: 0,
    mq: null,
    aim: null,
    aiming: false,
    pointerId: null,
    rigExt: 0,
    kick: 0,
    holdT: 0,
    holdAim: null,
    shake: 0,
    flash: 0,
    red: 0,
    biteT: 0,
    trail: [],
    trailT: 0,
    particles: [],
    pulses: [],
    texts: [],
    splats: [],
    beams: [],
    face: null,
    bestAtStart: 0,
    hinted: false,
    hintTimer: 0,
    // run stats / progression
    kills: 0, shots: 0, hits: 0, bestStreak: 0, level: 1,
    slow: 0,
    banner: null
  };

  let W = 0, H = 0, DPR = 1;
  const bed = { x: 0, y: 0, s: 1, w: 0, h: 0, bottom: 0, top: 0 };
  const rig = {
    shoulder: { x: 0, y: 0 },
    supportShoulder: { x: 0, y: 0 },
    hand: { x: 0, y: 0 },
    gripBack: { x: 0, y: 0 },
    gripFront: { x: 0, y: 0 },
    elbowBack: { x: 0, y: 0 },
    elbowFront: { x: 0, y: 0 },
    weaponCenter: { x: 0, y: 0 },
    angle: -0.15,
    face: { x: 0, y: 0, r: 20 },
    loaded: false
  };
  let bgCanvas = null;
  let dust = [];

  /* ---------------- face images ---------------- */
  function loadImage(src) {
    const wrap = { img: null, ok: false };
    if (!src) return wrap;
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { wrap.ok = true; };
    im.onerror = () => { wrap.ok = false; };
    im.src = src;
    wrap.img = im;
    return wrap;
  }
  const sleepSrcs = Array.isArray(CONFIG.FACES.sleep)
    ? CONFIG.FACES.sleep.filter(Boolean)
    : (CONFIG.FACES.sleep ? [CONFIG.FACES.sleep] : []);
  const sleepFaces = sleepSrcs.map(loadImage);
  const hitFace = loadImage(CONFIG.FACES.hit);
  G.face = sleepFaces.length ? sleepFaces[0] : null;
  const mosqImg = loadImage(CONFIG.MOSQUITO.src);

  function pickFace() {
    if (!sleepFaces.length) return null;
    const ready = sleepFaces.filter(f => f.ok);
    const pool = ready.length ? ready : sleepFaces;
    return pool[(Math.random() * pool.length) | 0];
  }

  /* ---------------- layout ---------------- */
  function layout() {
    const rect = cv.getBoundingClientRect();
    const nw = Math.max(1, rect.width);
    const nh = Math.max(1, rect.height);
    const ndpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const oldW = W, oldH = H;

    W = nw; H = nh; DPR = ndpr;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);

    // Restore the original bed's full-width, low placement.
    const hk = W > H * 1.1 ? 0.46 : 0.33; // taller bed on wide screens
    const s = Math.min(W * 0.86 / 720, H * hk / 440);
    bed.s = s;
    bed.w = 720 * s;
    bed.h = 440 * s;
    bed.x = W * 0.5 - bed.w * 0.5;
    bed.bottom = H * 0.90;
    bed.y = bed.bottom - bed.h;
    bed.top = bed.y;

    if (rig.loaded && oldW > 0 && oldH > 0) {
      rig.hand.x *= W / oldW; rig.hand.y *= H / oldH;
      if (G.mq) {
        G.mq.x *= W / oldW;
        G.mq.y *= H / oldH;
        G.trail = [];
      }
    }

    buildBackground();
    buildDust();
    G.aim = null;
    G.aiming = false;
    G.pointerId = null;
    updateRig(0, true);
    rig.loaded = true;
  }

  const toScreen = (lx, ly) => ({
    x: bed.x + lx * bed.s,
    y: bed.y + ly * bed.s
  });

  function buildBackground() {
    const c = document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    const g = c.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Match the clean white phone screen in the reference clip.
    const lg = g.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, '#f6eeff'); lg.addColorStop(0.5, '#fff2ef'); lg.addColorStop(1, '#e9f3ff');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    [[0.88, 0.1, 0.55, '255,168,118,.34'], [0.06, 0.4, 0.6, '170,140,255,.28'], [0.72, 0.86, 0.66, '110,200,255,.30']].forEach(([bx, by, br, col]) => {
      const rg = g.createRadialGradient(W * bx, H * by, 0, W * bx, H * by, Math.max(W, H) * br);
      rg.addColorStop(0, `rgba(${col})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    });

    bgCanvas = c;
  }

  function buildDust() {
    dust = [];
    const n = W < 380 ? 12 : 18;
    for (let i = 0; i < n; i++) {
      dust.push({
        x: rand(0, W),
        y: rand(0, H * 0.7),
        r: rand(0.7, 2.1),
        spd: rand(2, 7),
        sway: rand(5, 16),
        ph: rand(0, TAU),
        a: rand(0.04, 0.10)
      });
    }
  }

  /* ---------------- rounded rect helper ---------------- */
  function rrPath(c, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  function paint(c, fill, stroke, lw) {
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }
  function roundBox(x, y, w, h, r, fill, stroke, lw) {
    rrPath(ctx, x, y, w, h, r);
    paint(ctx, fill, stroke, lw);
  }

  /* ---------------- rig (stickman arm) ---------------- */
  function updateRig(dt, snap) {
    const s = bed.s;
    const breath = Math.sin(G.t * 2.05);
    const headBob = -1.4 * breath;
    const face = toScreen(170, 160 + headBob);
    rig.face = { x: face.x, y: face.y, r: 66 * s };

    const aimPoint = G.aiming ? G.aim : (G.holdT > 0 ? G.holdAim : null);
    const wantAim = G.mode === 'playing' && !!aimPoint;
    G.rigExt = snap ? (wantAim ? 1 : 0) : damp(G.rigExt, wantAim ? 1 : 0, wantAim ? 16 : 7, dt);

    // Keep the nonsexual zapper fixed above the abdomen. Only wrists and hands
    // travel vertically; the aim ray still turns toward the target.
    rig.angle = 0;
    rig.weaponCenter = toScreen(352, 254);
    // Hands travel along the rod, from just above its base to just below its tip.
    const handProgress = (Math.sin(G.animT * 20) + 1) * 0.5;
    const handY = rig.weaponCenter.y + (-98 + handProgress * 88) * s;
    rig.shoulder = toScreen(245, 218 + 0.6 * breath);
    rig.supportShoulder = toScreen(284, 228 + 0.6 * breath);
    rig.gripBack = {
      x: rig.weaponCenter.x - 6 * s,
      y: handY + 3 * s
    };
    rig.gripFront = {
      x: rig.weaponCenter.x + 6 * s,
      y: handY - 3 * s
    };
    rig.hand = {
      x: rig.weaponCenter.x,
      y: rig.weaponCenter.y - 108 * s
    };

    const elbowFor = (shoulder, hand, bend) => {
      const vx = hand.x - shoulder.x, vy = hand.y - shoulder.y;
      const len = Math.hypot(vx, vy) || 1;
      let nx = -vy / len, ny = vx / len;
      if (ny < 0) { nx = -nx; ny = -ny; }
      return {
        x: (shoulder.x + hand.x) * 0.5 + nx * bend * s,
        y: (shoulder.y + hand.y) * 0.5 + ny * bend * s
      };
    };
    rig.elbowBack = elbowFor(rig.shoulder, {
      x: rig.weaponCenter.x - 6 * s,
      y: rig.weaponCenter.y - 54 * s
    }, 27);
    rig.elbowFront = elbowFor(rig.supportShoulder, {
      x: rig.weaponCenter.x + 6 * s,
      y: rig.weaponCenter.y - 54 * s
    }, 27);
  }

  function drawArm() {
    const s = bed.s;
    const r = rig;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(4, 10 * s);

    // Two bent arms stay connected from the shoulders to the shared grip.
    ctx.beginPath();
    ctx.moveTo(r.shoulder.x, r.shoulder.y);
    ctx.lineTo(r.elbowBack.x, r.elbowBack.y);
    ctx.lineTo(r.gripBack.x, r.gripBack.y);
    ctx.moveTo(r.supportShoulder.x, r.supportShoulder.y);
    ctx.lineTo(r.elbowFront.x, r.elbowFront.y);
    ctx.lineTo(r.gripFront.x, r.gripFront.y);
    ctx.stroke();

    // Fixed round zapper over the abdomen; the wrists move around it.
    ctx.save();
    ctx.translate(r.weaponCenter.x, r.weaponCenter.y);
    // Upright fixed barrel, aligned with the dashed shot guide.
    roundBox(-10 * s, -108 * s, 20 * s, 108 * s, 9 * s, '#16171c', INK, 2.5 * s);
    ctx.beginPath();
    ctx.arc(0, 0, 17 * s, 0, TAU);
    ctx.fillStyle = '#383842';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5 * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 10 * s, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,.30)';
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.fillStyle = G.kick > 0.18 ? '#fff2a6' : '#ff8a45';
    ctx.beginPath();
    ctx.arc(0, -108 * s, (G.kick > 0.18 ? 5 : 3) * s, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Hands stay on the rod and slide only between its two endpoints.
    const handRadius = Math.max(4, 7 * s);
    [r.gripBack, r.gripFront].forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, handRadius, 0, TAU);
      ctx.fillStyle = INK;
      ctx.fill();
    });
    ctx.restore();
  }
  /* ---------------- the bedroom ---------------- */
  function drawScene() {
    const s = bed.s;
    const breathe = Math.sin(G.t * 2.05);
    const jolt = G.kick * 1.8;

    // Soft contact shadow under the raised bed.
    ctx.save();
    ctx.translate(bed.x + bed.w * 0.5, bed.y + 402 * s + jolt * s * 0.35);
    ctx.scale(1, 0.18);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 340 * s);
    shadow.addColorStop(0, 'rgba(33,34,40,.20)');
    shadow.addColorStop(0.58, 'rgba(33,34,40,.09)');
    shadow.addColorStop(1, 'rgba(33,34,40,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 340 * s, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(bed.x, bed.y + jolt);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Modern upholstered headboard with clean inset panels.
    roundBox(18, 42, 174, 294, 24, '#d9dce1', '#4b4d55', 6);
    roundBox(31, 55, 148, 267, 18, '#e9ebee', 'rgba(65,68,76,.22)', 3);
    ctx.strokeStyle = 'rgba(82,85,94,.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(46, 73); ctx.lineTo(46, 305);
    ctx.moveTo(166, 73); ctx.lineTo(166, 305);
    ctx.stroke();

    // Low platform frame, dark feet, and a separate 3D mattress side.
    ctx.beginPath();
    ctx.moveTo(44, 300);
    ctx.lineTo(704, 311);
    ctx.lineTo(698, 356);
    ctx.lineTo(48, 345);
    ctx.closePath();
    const frameGrad = ctx.createLinearGradient(0, 300, 0, 356);
    frameGrad.addColorStop(0, '#666a73');
    frameGrad.addColorStop(1, '#373a43');
    paint(ctx, frameGrad, '#30323a', 6);
    roundBox(75, 344, 32, 76, 5, '#343740', '#282a31', 5);
    roundBox(639, 355, 32, 65, 5, '#343740', '#282a31', 5);

    ctx.beginPath();
    ctx.moveTo(56, 224);
    ctx.quadraticCurveTo(57, 212, 77, 210);
    ctx.lineTo(690, 224);
    ctx.quadraticCurveTo(709, 225, 708, 243);
    ctx.lineTo(686, 312);
    ctx.quadraticCurveTo(681, 322, 660, 321);
    ctx.lineTo(74, 304);
    ctx.quadraticCurveTo(55, 303, 53, 286);
    ctx.closePath();
    const sideGrad = ctx.createLinearGradient(0, 245, 0, 322);
    sideGrad.addColorStop(0, '#e2e3e6');
    sideGrad.addColorStop(1, '#aeb2ba');
    paint(ctx, sideGrad, '#656871', 5);

    // Neat, uncovered mattress top with a soft edge and subtle quilting.
    ctx.beginPath();
    ctx.moveTo(66, 206);
    ctx.quadraticCurveTo(69, 190, 90, 190);
    ctx.lineTo(682, 204);
    ctx.quadraticCurveTo(704, 205, 703, 222);
    ctx.lineTo(681, 280);
    ctx.quadraticCurveTo(677, 292, 656, 291);
    ctx.lineTo(83, 276);
    ctx.quadraticCurveTo(63, 275, 62, 258);
    ctx.closePath();
    const topGrad = ctx.createLinearGradient(0, 190, 0, 292);
    topGrad.addColorStop(0, '#fffefa');
    topGrad.addColorStop(0.55, '#f2f1ef');
    topGrad.addColorStop(1, '#dedfe2');
    paint(ctx, topGrad, '#858891', 4);
    ctx.strokeStyle = 'rgba(117,120,128,.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(91, 214);
    ctx.quadraticCurveTo(355, 220, 670, 228);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(83, 270);
    ctx.quadraticCurveTo(350, 277, 659, 285);
    ctx.stroke();

    // Pillow at the head, with a slight raised seam.
    roundBox(73, 155, 205, 75, 27, '#fffefd', '#aeb0b6', 3);
    ctx.strokeStyle = 'rgba(120,122,130,.23)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(94, 212);
    ctx.quadraticCurveTo(174, 222, 255, 210);
    ctx.stroke();

    // Full stickman body: a simple spine, hip joint, and two relaxed legs.
    ctx.strokeStyle = '#202129';
    ctx.fillStyle = '#202129';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(211, 202);
    ctx.quadraticCurveTo(286, 222, 378, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(378, 256, 7, 0, TAU);
    ctx.fill();

    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(382, 258);
    ctx.quadraticCurveTo(450, 245, 497, 253);
    ctx.lineTo(605, 266);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(380, 260);   // starts at the hip joint, so the leg is attached
    ctx.quadraticCurveTo(425, 277, 500, 289);
    ctx.lineTo(605, 300);
    ctx.stroke();
    [[610, 266, 9], [610, 300, 9]].forEach(([x, y, r]) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    });

    // The face remains separate so it can be replaced later.
    // The clockwise tilt matches the reclined face angle in the reference video.
    drawHead(170, 160 - 0.7 * breathe, 66, CONFIG.FACES.tilt + breathe * 0.006);
    ctx.restore();

    drawArm();
  }
  /* ---------------- face ---------------- */
  function drawHead(lx, ly, r, tilt) {
    const face = (G.mode === 'dying' || G.mode === 'over') ? (hitFace.ok ? hitFace : G.face) : G.face;
    const upset = G.mode === 'dying' || G.mode === 'over';

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(tilt);
    if (upset) {
      const w = Math.sin(G.t * 40) * 1.6;
      ctx.translate(w, 0);
    }

    if (face && face.ok) {
      ctx.save();
      const im = face.img;
      const d = r * 2.08;
      const ar = im.width / im.height || 1;
      const dw = ar > 1 ? d : d * ar;
      const dh = ar > 1 ? d / ar : d;
      // These are transparent cutouts. Draw the complete head silhouette so
      // the hair and chin stay intact instead of forcing the face into a circle.
      ctx.shadowColor = 'rgba(34,32,44,.16)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      drawPlaceholderFace(r, upset);
    }

    // bite mark
    if (upset) {
      const t = G.mode === 'dying' ? clamp(G.biteT / 0.25, 0, 1) : 1;
      if (t > 0) {
        ctx.save();
        ctx.translate(r * 0.61, r * 0.13);
        ctx.scale(t, t);
        ctx.fillStyle = 'rgba(226,72,55,.85)';
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd9c9';
        ctx.beginPath(); ctx.arc(-2.5, -2, 2.6, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(226,72,55,.65)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 14, -0.5, 1.8); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawPlaceholderFace(r, upset) {
    ctx.save();
    const skin = '#eec099';
    const hair = '#2c262c';

    // ears
    ctx.fillStyle = skin;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.4;
    [-1, 1].forEach(sgn => {
      ctx.beginPath();
      ctx.arc(sgn * (r - 3), 4, r * 0.18, 0, TAU);
      ctx.fill(); ctx.stroke();
    });

    // head
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4.5;
    ctx.stroke();

    // hair (clipped to the head)
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 2, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(-r, -6);
    ctx.bezierCurveTo(-r - 3, -r * 0.98, -r * 0.36, -r * 1.24, r * 0.14, -r * 1.06);
    ctx.bezierCurveTo(r * 0.7, -r * 1.0, r * 1.04, -r * 0.62, r * 0.98, -4);
    ctx.bezierCurveTo(r * 0.72, -r * 0.33, r * 0.4, -r * 0.5, r * 0.2, -r * 0.62);
    ctx.bezierCurveTo(r * 0.06, -r * 0.3, -r * 0.24, -r * 0.42, -r * 0.4, -r * 0.6);
    ctx.bezierCurveTo(-r * 0.62, -r * 0.42, -r * 0.84, -r * 0.24, -r, -6);
    ctx.closePath();
    ctx.fillStyle = hair;
    ctx.fill();
    // hair highlight
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.62);
    ctx.bezierCurveTo(-r * 0.24, -r * 0.88, r * 0.16, -r * 0.9, r * 0.46, -r * 0.66);
    ctx.strokeStyle = 'rgba(255,255,255,.13)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // blush
    ctx.fillStyle = 'rgba(240,124,104,.16)';
    [-1, 1].forEach(sgn => {
      ctx.beginPath();
      ctx.ellipse(sgn * r * 0.56, r * 0.34, r * 0.16, r * 0.1, 0, 0, TAU);
      ctx.fill();
    });

    if (!upset) {
      // closed eyes
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.6;
      ctx.lineCap = 'round';
      [-1, 1].forEach(sgn => {
        ctx.beginPath();
        ctx.moveTo(sgn * r * 0.42, -r * 0.02);
        ctx.quadraticCurveTo(sgn * r * 0.26, r * 0.11, sgn * r * 0.1, -r * 0.01);
        ctx.stroke();
      });
      // brows
      ctx.strokeStyle = 'rgba(60,46,44,.7)';
      ctx.lineWidth = 2.6;
      [-1, 1].forEach(sgn => {
        ctx.beginPath();
        ctx.moveTo(sgn * r * 0.45, -r * 0.22);
        ctx.quadraticCurveTo(sgn * r * 0.28, -r * 0.29, sgn * r * 0.12, -r * 0.22);
        ctx.stroke();
      });
      // nose
      ctx.strokeStyle = 'rgba(150,92,66,.7)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(r * 0.04, r * 0.12);
      ctx.quadraticCurveTo(r * 0.1, r * 0.24, -r * 0.02, r * 0.25);
      ctx.stroke();
      // snoring mouth
      ctx.beginPath();
      ctx.ellipse(r * 0.02, r * 0.5, r * 0.115, r * 0.135, 0, 0, TAU);
      ctx.fillStyle = '#713f3b';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r * 0.02, r * 0.55, r * 0.07, r * 0.07, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,148,136,.45)';
      ctx.fill();
    } else {
      // X eyes
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      [-1, 1].forEach(sgn => {
        const cx = sgn * r * 0.27, cy = 0;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.1, cy - r * 0.1);
        ctx.lineTo(cx + r * 0.1, cy + r * 0.1);
        ctx.moveTo(cx + r * 0.1, cy - r * 0.1);
        ctx.lineTo(cx - r * 0.1, cy + r * 0.1);
        ctx.stroke();
      });
      // worried brows
      ctx.strokeStyle = 'rgba(60,46,44,.8)';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, -r * 0.28); ctx.lineTo(-r * 0.14, -r * 0.2);
      ctx.moveTo(r * 0.45, -r * 0.28); ctx.lineTo(r * 0.14, -r * 0.2);
      ctx.stroke();
      // open mouth
      ctx.beginPath();
      ctx.ellipse(r * 0.02, r * 0.5, r * 0.13, r * 0.16, 0, 0, TAU);
      ctx.fillStyle = '#5f322f';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r * 0.02, r * 0.55, r * 0.085, r * 0.075, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,145,130,.5)';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawZzz() {
    const f = rig.face;
    const s = bed.s;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const t = (G.t * 0.23 + i * 0.33) % 1;
      const alpha = Math.sin(t * Math.PI) * 0.5;
      if (alpha < 0.02) continue;
      const x = f.x + f.r * 0.9 + t * f.r * 0.62 + Math.sin(t * 6 + i) * f.r * 0.07;
      const y = f.y - f.r * 1.15 - t * f.r * 0.95;
      const size = Math.max(12, (13 + t * 15) * s * 2.4);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#6d6478';
      ctx.font = `italic 800 ${size}px ${FONT}`;
      ctx.fillText('z', x, y);
    }
    ctx.restore();
  }


  /* ---------------- mosquito ---------------- */
  const mqSize = () => clamp(W * 0.092, 33, 42);

  function spawnMosquito() {
    const face = rig.face;
    const size = mqSize();
    const side = Math.random();
    let x, y, a;
    if (side < 0.15) {
      x = rand(W * 0.2, W * 0.8); y = -size; a = Math.PI / 2;
    } else if (side < 0.575) {
      x = -size; y = rand(H * 0.14, H * 0.5); a = 0;
    } else {
      x = W + size; y = rand(H * 0.14, H * 0.5); a = Math.PI;
    }
    const kr = Math.random();
    let kind = 'normal';
    if (G.score >= 3 && kr < 0.08) kind = 'gold';        // rare, worth +5
    else if (G.score >= 4 && kr < 0.28) kind = 'fast';   // quick zigzagger
    else if (G.score >= 7 && kr < 0.46) kind = 'tank';   // big, takes 2 hits
    const diveDelay = rand(CONFIG.DIVE_AFTER[0], CONFIG.DIVE_AFTER[1]) - Math.min(G.score * 0.035, 1.1);
    G.mq = {
      x, y, a,
      tx: face.x + rand(-60, 60),
      ty: rand(H * 0.16, H * 0.5),
      size: kind === 'tank' ? size * 1.28 : size,
      kind,
      hp: kind === 'tank' ? 2 : 1,
      spd: kind === 'fast' ? 1.45 : kind === 'gold' ? 1.25 : 1,
      age: 0,
      wing: rand(0, 10),
      tilt: 0,
      flip: Math.cos(a) < 0 ? -1 : 1,
      mode: 'wander',
      retarget: 0.3,
      diveAt: Math.max(1.1, diveDelay * (kind === 'gold' ? 0.8 : 1)),
      bob: rand(0, TAU)
    };
    G.trail = [];
    G.trailT = 0;
  }

  function updateMosquito(dt) {
    const m = G.mq;
    if (!m) return;
    const f = rig.face;
    m.age += dt;

    if (m.mode === 'bitten') {
      m.wing += dt * 30;
      const an = biteAnchor(m);
      m.x = an.x + Math.sin(m.age * 26) * 2;
      m.y = an.y;
      return;
    }

    const diving = m.mode === 'dive';
    m.wing += dt * (52 + (W * 0.3) / 400);

    if (diving) {
      m.tx = f.x; m.ty = f.y;
    } else {
      m.retarget -= dt;
      if (m.age > m.diveAt) {
        m.mode = 'dive';
        addPulse(f.x, f.y, f.r * 0.8, f.r * 2.6, 0.65, 'rgba(226,72,55,.5)', 2.5);
        Sfx.play('warn');
        vibrate(30);
      } else if (m.retarget <= 0) {
        m.tx = rand(W * 0.08, W * 0.92);
        m.ty = rand(H * 0.15, H * 0.52);
        m.retarget = rand(0.65, 1.25) * (m.kind === 'fast' ? 0.6 : 1);
      }
    }

    const want = Math.atan2(m.ty - m.y, m.tx - m.x);
    const diff = wrapAngle(want - m.a);
    const turn = (diving ? 4.6 : 3.2) * (m.kind === 'fast' ? 1.5 : 1) * dt;
    m.a += clamp(diff, -turn, turn);
    m.a += Math.sin(m.age * 7.4 + m.bob) * 0.55 * dt;
    m.tilt = damp(m.tilt, clamp(diff * 0.45, -0.45, 0.45), 8, dt);
    // Keep the sprite upright: mirror it when it flies leftwards (squashes through
    // zero, which reads as a quick turn-around).
    const cx = Math.cos(m.a);
    m.flip = damp(m.flip === undefined ? 1 : m.flip, cx < -0.08 ? -1 : cx > 0.08 ? 1 : Math.sign(m.flip || 1), 13, dt);

    const base = W * clamp(
      CONFIG.START_SPEED + G.score * CONFIG.SPEED_PER_SCORE,
      0, CONFIG.MAX_SPEED
    );
    let sp = base * (diving ? CONFIG.DIVE_SPEED : 1) * (m.spd || 1);
    sp *= 1 + Math.sin(m.age * 6.2 + m.bob) * 0.07;
    if (m.mode === 'wander' && dist(m.x, m.y, m.tx, m.ty) < 26) sp *= 0.55;

    m.x += Math.cos(m.a) * sp * dt;
    m.y += Math.sin(m.a) * sp * dt;

    if (!diving) {
      m.y = clamp(m.y, 92, H * 0.56);
      m.x = clamp(m.x, 14, W - 14);
    }

    // trail
    G.trailT -= dt;
    if (G.trailT <= 0) {
      G.trailT = 0.04;
      G.trail.push({ x: m.x, y: m.y, life: 0.30 });
      if (G.trail.length > 8) G.trail.shift();
    }

    // bite
    if (diving) {
      const d = dist(m.x, m.y, f.x, f.y);
      if (d < biteReach(m)) bite();
    }
  }

  /* sprite helpers */
  const spriteReady = () => mosqImg.ok && mosqImg.img.naturalWidth > 0;
  const spriteLen = (m) => m.size * CONFIG.MOSQUITO.length;
  // distance from the body pivot to the tip of the nose
  const noseLen = (m) => (1 - CONFIG.MOSQUITO.pivotX) * spriteLen(m) * 0.92;
  // how close (pivot to face centre) the bug must get to bite
  function biteReach(m) {
    const f = rig.face;
    return spriteReady() ? noseLen(m) + f.r * 0.6 : f.r * 1.06 + m.size * 0.25;
  }
  // where a biting mosquito hangs: nose stuck into the cheek it came from
  function biteAnchor(m) {
    const f = rig.face;
    if (!spriteReady()) return { x: f.x + f.r * 0.32, y: f.y - f.r * 0.14 };
    const dx = Math.cos(m.a), dy = Math.sin(m.a);
    const hx = f.x - dx * f.r * 0.55, hy = f.y - dy * f.r * 0.55;
    return { x: hx - dx * noseLen(m), y: hy - dy * noseLen(m) };
  }

  function drawMosquitoSprite(m) {
    const im = mosqImg.img, C = CONFIG.MOSQUITO;
    const L = spriteLen(m);
    const Hh = L * im.naturalHeight / im.naturalWidth;
    const buzz = m.mode === 'bitten' ? 1.6 : 1;
    ctx.save();
    ctx.translate(m.x, m.y + Math.sin(m.wing * 0.31) * 1.1 * buzz);
    ctx.rotate(m.a + m.tilt * 0.25);
    ctx.scale(1, (m.flip === undefined ? 1 : m.flip) * (1 + Math.sin(m.wing) * 0.03));
    ctx.shadowColor = 'rgba(34,32,44,.28)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(im, -C.pivotX * L, -C.pivotY * Hh, L, Hh);
    ctx.restore();
  }

  function drawMosquito(m) {
    const s = m.size / 46;

    // trail
    ctx.save();
    G.trail.forEach((p, i) => {
      const a = (p.life / 0.30) * 0.10 * (i / G.trail.length);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#413844';
      ctx.beginPath();
      ctx.arc(p.x, p.y, m.size * 0.16, 0, TAU);
      ctx.fill();
    });
    ctx.restore();

    if (m.kind && m.kind !== 'normal' && m.mode !== 'bitten') {
      const col = m.kind === 'gold' ? '255,190,30' : m.kind === 'fast' ? '60,170,255' : '226,72,55';
      const pr = m.size * (1.3 + 0.12 * Math.sin(G.t * 9));
      const ag = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, pr);
      ag.addColorStop(0, `rgba(${col},.45)`); ag.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(m.x, m.y, pr, 0, TAU); ctx.fill();
    }
    if (spriteReady()) {
      if (m.mode === 'dive' && G.mode === 'playing') {
        ctx.save();
        ctx.strokeStyle = 'rgba(226,72,55,.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * (0.7 + Math.sin(G.t * 8) * 0.06), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      drawMosquitoSprite(m);
      return;
    }

    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.a + m.tilt * 0.25);
    ctx.scale(s, s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // dive warning
    if (m.mode === 'dive' && G.mode === 'playing') {
      ctx.save();
      ctx.rotate(-(m.a + m.tilt * 0.25));
      const pr = 26 + Math.sin(G.t * 8) * 3;
      ctx.strokeStyle = 'rgba(226,72,55,.42)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Six fine, jointed legs, with narrow tarsi rather than cartoon strokes.
    ctx.strokeStyle = '#29242d';
    ctx.lineWidth = 0.9;
    const legSets = [
      [-3, -2, -7, -10, -16, -18],
      [1, -3, 1, -11, -3, -23],
      [4, -2, 10, -9, 17, -18],
      [-3, 2, -8, 10, -18, 19],
      [1, 3, 5, 11, 3, 24],
      [4, 2, 11, 9, 19, 17]
    ];
    legSets.forEach(l => {
      ctx.beginPath();
      ctx.moveTo(l[0], l[1]);
      ctx.lineTo(l[2], l[3]);
      ctx.lineTo(l[4], l[5]);
      ctx.lineTo(l[4] + (l[4] < 0 ? -4 : 4), l[5] + (l[5] < 0 ? -3 : 3));
      ctx.stroke();
      ctx.beginPath(); ctx.arc(l[2], l[3], 0.7, 0, TAU); ctx.fillStyle = '#564653'; ctx.fill();
    });

    // Long, translucent wings with visible veins and a fast, asymmetric flap.
    const drawWing = (side, phase, alpha) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(-1, side * 2.4);
      ctx.rotate(side * (0.12 + Math.sin(m.wing + phase) * 0.42));
      ctx.scale(1, side);
      ctx.beginPath();
      ctx.moveTo(-2, -1);
      ctx.quadraticCurveTo(-7, -8, -20, -18);
      ctx.quadraticCurveTo(-24, -19, -23, -14);
      ctx.quadraticCurveTo(-19, -6, -13, -2);
      ctx.closePath();
      const wingShade = ctx.createLinearGradient(-4, -2, -22, -18);
      wingShade.addColorStop(0, 'rgba(225,218,205,.58)');
      wingShade.addColorStop(1, 'rgba(177,192,199,.12)');
      ctx.fillStyle = wingShade;
      ctx.fill();
      ctx.strokeStyle = 'rgba(67,69,77,.55)';
      ctx.lineWidth = 0.55;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3, -2); ctx.lineTo(-20, -17);
      ctx.moveTo(-8, -6); ctx.lineTo(-21, -12);
      ctx.moveTo(-12, -9); ctx.lineTo(-21, -16);
      ctx.moveTo(-15, -12); ctx.lineTo(-18, -5);
      ctx.strokeStyle = 'rgba(80,78,84,.52)';
      ctx.lineWidth = 0.42;
      ctx.stroke();
      ctx.restore();
    };
    drawWing(-1, 0.35, 0.44);
    drawWing(1, 0, 0.78);

    // Narrow, segmented brown abdomen with muted amber bands.
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.bezierCurveTo(-20, -4.1, -9, -5.1, -2, -2.8);
    ctx.bezierCurveTo(-0.2, -1.1, -0.2, 1.1, -2, 2.8);
    ctx.bezierCurveTo(-9, 5.1, -20, 4.1, -24, 0);
    ctx.closePath();
    ctx.fillStyle = '#30262d';
    ctx.fill();
    ctx.strokeStyle = '#17151c';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(174,133,83,.68)';
    ctx.lineWidth = 1.05;
    [-19, -15, -11, -7, -3].forEach(x => {
      ctx.beginPath();
      ctx.moveTo(x, -5);
      ctx.lineTo(x + 2, 5);
      ctx.stroke();
    });
    ctx.restore();

    // thorax
    ctx.beginPath();
    ctx.ellipse(1, 0, 6.5, 5.2, -0.12, 0, TAU);
    ctx.fillStyle = '#362a30';
    ctx.fill();
    ctx.strokeStyle = '#15131b';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(214,180,139,.26)';
    ctx.beginPath();
    ctx.arc(-1, -1.5, 3.2, Math.PI * 0.9, Math.PI * 1.7);
    ctx.stroke();

    // Dark compound eye and a slender proboscis.
    ctx.beginPath();
    ctx.ellipse(10, -0.2, 4.2, 3.7, -0.22, 0, TAU);
    ctx.fillStyle = '#241a22';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(11.3, -1.05, 1.05, 0.7, -0.3, 0, TAU);
    ctx.fillStyle = 'rgba(213,155,146,.72)';
    ctx.fill();

    ctx.strokeStyle = '#241b23';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(13.5, 0.2);
    ctx.lineTo(28, 1.1);
    ctx.stroke();

    // Fine antennae, kept subtle at game scale.
    ctx.lineWidth = 0.62;
    ctx.beginPath();
    ctx.moveTo(12, -3);
    ctx.quadraticCurveTo(18, -8, 23, -7);
    ctx.moveTo(12, -2.5);
    ctx.quadraticCurveTo(19, -5.5, 24, -3.5);
    ctx.stroke();

    ctx.restore();
  }

  /* ---------------- effects ---------------- */
  function addPulse(x, y, r0, r1, life, color, width) {
    G.pulses.push({ x, y, r0, r1, life, max: life, color, width });
  }
  function addText(x, y, text, color, size) {
    G.texts.push({ x, y, text, color: color || '#ff8a45', size: size || 1, life: 0.95, max: 0.95 });
  }
  function addParticles(x, y, count) {
    const colors = ['#ff9a52', '#e5432f', '#f6c453', '#2b2a35'];
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(45, 190);
      G.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 50,
        r: rand(1.6, 4.4),
        life: rand(0.4, 0.85),
        max: 0.85,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
  }
  function addShotSparks(x, y, ux, uy) {
    const base = Math.atan2(uy, ux);
    for (let i = 0; i < 6; i++) {
      const a = base + rand(-0.52, 0.52);
      const speed = rand(90, 210);
      const life = rand(0.16, 0.28);
      G.particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: rand(1.3, 2.5),
        life,
        max: life,
        color: '#fff'
      });
    }
  }
  function addSplat(x, y) {
    const drops = [];
    const n = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const d = rand(16, 34);
      drops.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rand(2, 5.5) });
    }
    G.splats.push({
      x, y,
      rot: rand(0, TAU),
      seed: rand(0, 100),
      r: rand(17, 23),
      life: 2.1,
      max: 2.1,
      drops
    });
    if (G.splats.length > 5) G.splats.shift();
  }
  function addBeamDrops(x1, y1, x2, y2) {
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    for (let i = 0; i < 18; i++) {
      const t = Math.random(), side = Math.random() < 0.5 ? -1 : 1, sp = rand(30, 140), life = rand(0.35, 0.85);
      G.particles.push({
        x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t,
        vx: nx * side * sp + rand(-20, 20), vy: ny * side * sp + rand(-20, 20) - 25,
        r: rand(0.7, 1.7), life, max: life, color: '#fff', drop: true
      });
    }
  }
  function addBeam(x1, y1, x2, y2, life) {
    G.beams.push({ x1, y1, x2, y2, life, max: life });
  }

  function updateEffects(dt) {
    G.particles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g === undefined ? 430 : p.g) * dt;
      p.life -= dt;
    });
    G.particles = G.particles.filter(p => p.life > 0);

    G.pulses.forEach(p => p.life -= dt);
    G.pulses = G.pulses.filter(p => p.life > 0);

    G.texts.forEach(t => {
      t.life -= dt;
      t.y -= 40 * dt;
    });
    G.texts = G.texts.filter(t => t.life > 0);

    G.splats.forEach(s => s.life -= dt);
    G.splats = G.splats.filter(s => s.life > 0);

    G.beams.forEach(b => b.life -= dt);
    G.beams = G.beams.filter(b => b.life > 0);

    G.trail.forEach(t => t.life -= dt);
    G.trail = G.trail.filter(t => t.life > 0);

    G.shake = damp(G.shake, 0, 9, dt);
    G.flash = Math.max(0, G.flash - dt * 3.2);
    G.red = Math.max(0, G.red - dt * 1.1);
    G.kick = damp(G.kick, 0, 15, dt);
  }

  function drawEffectsBack() {
    G.splats.forEach(s => {
      const k = clamp((s.max - s.life) / 0.16, 0, 1);
      const fade = clamp(s.life / 0.7, 0, 1);
      const a = fade * 0.88 * k;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(0.55 + k * 0.45, 0.55 + k * 0.45);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ff8a45';
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const ang = (i / 12) * TAU;
        const rad = s.r * (0.78 + 0.3 * Math.sin(i * 2.7 + s.seed));
        const x = Math.cos(ang) * rad;
        const y = Math.sin(ang) * rad;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(226,72,52,.7)';
      ctx.beginPath();
      ctx.arc(-s.r * 0.18, s.r * 0.05, s.r * 0.34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,226,190,.55)';
      ctx.beginPath();
      ctx.arc(s.r * 0.22, -s.r * 0.2, s.r * 0.17, 0, TAU);
      ctx.fill();
      s.drops.forEach(d => {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fillStyle = '#ff8a45';
        ctx.fill();
      });
      ctx.restore();
    });
  }

  function drawBeams() {
    G.beams.forEach(b => {
      const k = clamp(b.life / b.max, 0, 1);
      const a = easeOut(k);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(214,150,0,${a * 0.18})`;
      ctx.lineWidth = 22;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = `rgba(205,138,0,${a * 0.36})`;
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = `rgba(196,130,0,${a * 0.98})`;
      ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,236,150,${a * 0.95})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();

      // muzzle flash
      const fr = 15 + (1 - k) * 10;
      const fire = ctx.createRadialGradient(b.x1, b.y1, 0, b.x1, b.y1, fr);
      fire.addColorStop(0, `rgba(255,244,190,${a * 0.95})`);
      fire.addColorStop(0.35, `rgba(224,160,10,${a * 0.65})`);
      fire.addColorStop(1, 'rgba(200,135,0,0)');
      ctx.fillStyle = fire;
      ctx.beginPath();
      ctx.arc(b.x1, b.y1, fr, 0, TAU);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawEffectsFront() {
    G.particles.forEach(p => {
      ctx.globalAlpha = clamp(p.life / 0.35, 0, 1);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.drop ? 'rgba(190,120,0,.75)' : 'transparent';
      ctx.shadowBlur = p.drop ? 4 : 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    G.pulses.forEach(p => {
      const t = 1 - p.life / p.max;
      const r = lerp(p.r0, p.r1, easeOut(t));
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width || 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    G.texts.forEach(t => {
      const k = 1 - t.life / t.max;
      const pop = k < 0.18 ? lerp(0.65, 1.12, k / 0.18) : lerp(1.12, 1, clamp((k - 0.18) / 0.3, 0, 1));
      const alpha = t.life > 0.3 ? 1 : t.life / 0.3;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(t.x, t.y);
      ctx.scale(pop * t.size, pop * t.size);
      ctx.font = `800 24px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,253,251,.95)';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    });
  }

  /* ---------------- aim + firing ---------------- */
  function aimRay() {
    if (!G.aim) return null;
    const h = rig.hand;
    const dx = G.aim.x - h.x;
    const dy = G.aim.y - h.y;
    const len = Math.hypot(dx, dy);
    if (len < 7) return null;
    return { hx: h.x, hy: h.y, ux: dx / len, uy: dy / len, len };
  }

  function aimLocked() {
    const m = G.mq;
    const r = aimRay();
    if (!m || !r || m.mode === 'bitten') return false;
    const vx = m.x - r.hx, vy = m.y - r.hy;
    const along = vx * r.ux + vy * r.uy;
    if (along < 0) return false;
    const perp = Math.abs(vx * r.uy - vy * r.ux);
    return perp < m.size * CONFIG.AIM_ASSIST;
  }

  function drawAim() {
    const r = aimRay();
    if (!r || G.mode !== 'playing') return;
    const locked = aimLocked();
    const extended = 3000;
    const ex = r.hx + r.ux * extended;
    const ey = r.hy + r.uy * extended;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([9, 13]);
    ctx.lineDashOffset = -G.t * 22;
    ctx.strokeStyle = 'rgba(255,253,251,.55)';
    ctx.lineWidth = 5.4;
    ctx.beginPath(); ctx.moveTo(r.hx, r.hy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = locked ? 'rgba(34,32,44,.95)' : 'rgba(34,32,44,.55)';
    ctx.lineWidth = 2.7;
    ctx.beginPath(); ctx.moveTo(r.hx, r.hy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);

    // touch point
    const pr = 9;
    ctx.strokeStyle = locked ? '#d99a00' : 'rgba(34,32,44,.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(G.aim.x, G.aim.y, pr, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawIdleShotGuide() {
    if (G.mode !== 'playing' || G.aiming) return;
    const top = Math.max(24, H * 0.18);
    const x = rig.hand.x, y = rig.hand.y;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([9, 13]);
    ctx.strokeStyle = 'rgba(255,253,251,.68)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top); ctx.stroke();
    ctx.strokeStyle = 'rgba(34,32,44,.72)';
    ctx.lineWidth = 2.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top); ctx.stroke();
    ctx.restore();
  }

  function drawReticle() {
    const m = G.mq;
    if (!m || G.mode !== 'playing' || !aimLocked()) return;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(G.t * 1.2);
    ctx.strokeStyle = '#d99a00';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, m.size * 0.82, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * m.size * 0.92, Math.sin(a) * m.size * 0.92);
      ctx.lineTo(Math.cos(a) * m.size * 1.12, Math.sin(a) * m.size * 1.12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function fire() {
    if (G.mode !== 'playing' || G.cool > 0) return;
    const r = aimRay();
    if (!r) return;
    G.cool = CONFIG.COOLDOWN;
    G.shots++;
    G.kick = 1;
    G.holdT = 0.16;
    G.holdAim = { x: G.aim.x, y: G.aim.y };
    Sfx.play('fire');
    addShotSparks(r.hx, r.hy, r.ux, r.uy);

    let hit = false;
    const m = G.mq;
    if (m && m.mode !== 'bitten') {
      const vx = m.x - r.hx, vy = m.y - r.hy;
      const along = vx * r.ux + vy * r.uy;
      const perp = Math.abs(vx * r.uy - vy * r.ux);
      if (along > 0 && perp < m.size * CONFIG.AIM_ASSIST + 4) hit = true;
    }

    if (hit) {
      G.hits++;
      addBeam(r.hx, r.hy, m.x, m.y, 0.17);
      addBeamDrops(r.hx, r.hy, m.x, m.y);
      if (--m.hp > 0) {
        addPulse(m.x, m.y, m.size * 0.2, m.size * 1.2, 0.3, 'rgba(226,72,55,.6)', 2.5);
        addText(m.x, m.y - m.size * 0.4, 'HIT!', '#e24a37', 0.8);
        G.shake = Math.max(G.shake, 3.5);
        vibrate(6);
      } else killMosquito(m);
    } else {
      const len = Math.min(r.len, 230);
      addBeam(r.hx, r.hy, r.hx + r.ux * len, r.hy + r.uy * len, 0.14);
      addBeamDrops(r.hx, r.hy, r.hx + r.ux * len, r.hy + r.uy * len);
      addPulse(r.hx + r.ux * len, r.hy + r.uy * len, 2, 22, 0.3, 'rgba(214,150,0,.55)', 2);
      G.streak = 0;
      G.streakTimer = 0;
      streakEl.classList.remove('on');
      G.shake = Math.max(G.shake, 1.6);
    }
    addPulse(r.hx, r.hy, 3, 30, 0.26, 'rgba(226,166,10,.85)', 2.4);
  }

  function killMosquito(m) {
    const x = m.x, y = m.y;
    G.streak = G.streakTimer > 0 ? G.streak + 1 : 1;
    G.streakTimer = 4.2;
    const bonus = G.streak >= 3 ? 1 : 0;
    const pts = m.kind === 'gold' ? 5 : 1;
    G.score += pts + bonus;
    G.kills++;
    G.bestStreak = Math.max(G.bestStreak, G.streak);
    G.slow = pts > 1 ? 0.26 : 0.12;   // brief slow-mo on every kill
    const lv = 1 + Math.floor(G.kills / CONFIG.KILLS_PER_LEVEL);
    if (lv > G.level) levelUp(lv);
    if (G.streak >= 2) {
      streakEl.textContent = `COMBO x${G.streak}`;
      streakEl.classList.add('on');
    } else {
      streakEl.classList.remove('on');
    }
    if (G.score > G.best) {
      G.best = G.score;
      store.set('ms2.best', String(G.best));
    }
    updateScore(true);
    updateBestLabels();
    if (G.bestAtStart > 0 && G.score > G.bestAtStart && !G.beatBest) {
      G.beatBest = true;
      Confetti.burst(60);
      addText(rig.face.x, rig.face.y - rig.face.r * 2.2, 'NEW BEST!', '#d99a00', 1.5);
      vibrate([20, 40, 20]);
    }

    vibrate(9);

    addPulse(x, y, m.size * 0.25, m.size * 1.7, 0.45, '#ff8a45', 3);
    addParticles(x, y, pts > 1 ? 36 : 18);
    addSplat(x, y);
    addText(x, y - m.size * 0.35, pts > 1 ? `+${pts + bonus} GOLD!` : bonus ? '+2 COMBO' : '+1', pts > 1 ? '#d99a00' : '#ff7d3c', pts > 1 ? 1.1 : bonus ? 0.82 : 1);
    G.shake = Math.max(G.shake, 5.5);
    G.flash = 0.13;

    G.mq = null;
    G.respawn = CONFIG.RESPAWN;
    G.trail = [];
  }

  function levelUp(lv) {
    G.level = lv;
    lvlEl.textContent = String(lv);
    G.banner = { text: 'LEVEL ' + lv, sub: lv < 4 ? 'They\u2019re getting faster' : lv < 8 ? 'Stay sharp' : 'Absolute legend', life: 1.5, max: 1.5 };
    G.flash = Math.max(G.flash, 0.16);
    Confetti.burst(28);
    vibrate([12, 30, 12]);
  }

  const RANKS = [[1, 'Fresh meat'], [3, 'Sleepy rookie'], [6, 'Bug swatter'], [10, 'Zap apprentice'], [15, 'Mosquito menace'], [25, 'Zapper pro'], [Infinity, 'Mosquito slayer']];

  function bite() {
    if (G.mode !== 'playing' || !G.mq) return;
    const f = rig.face;
    G.mode = 'dying';
    G.biteT = 0;
    G.aim = null;
    G.aiming = false;
    G.pointerId = null;
    G.rigExt = 0;
    G.holdT = 0;
    G.holdAim = null;
    G.mq.mode = 'bitten';
    G.mq.age = 0;
    G.mq.a = Math.atan2(f.y - G.mq.y, f.x - G.mq.x);
    G.mq.tilt = 0;
    G.mq.flip = Math.cos(G.mq.a) < 0 ? -1 : 1;
    const an = biteAnchor(G.mq);
    G.mq.x = an.x;
    G.mq.y = an.y;
    G.shake = 13;
    G.red = 1;
    G.flash = 0.2;

    Sfx.play('lose');
    vibrate([25, 45, 90]);
    addPulse(f.x, f.y, f.r * 0.6, f.r * 2.4, 0.55, 'rgba(226,72,55,.55)', 3);
    addText(f.x, f.y - f.r * 1.3, 'OW!', '#e24a37', 1.35);
    updateHUDVisibility();
  }

  function gameOver() {
    G.mode = 'over';
    if (G.score > G.best) {
      G.best = G.score;
      store.set('ms2.best', String(G.best));
    }
    updateBestLabels();
    $('overScore').textContent = String(G.score);
    $('stKills').textContent = String(G.kills);
    $('stAcc').textContent = G.shots ? Math.round(G.hits / G.shots * 100) + '%' : '\u2013';
    $('stCombo').textContent = String(G.bestStreak);
    $('overEyebrow').textContent = 'Rank \u00b7 ' + RANKS.find(r => G.score < r[0])[1];
    $('overBest').textContent = String(G.best);
    const isNewBest = G.score > G.bestAtStart && G.score > 0;
    $('newBest').classList.toggle('on', isNewBest);
    if (isNewBest) { Sfx.play('highscore'); Confetti.burst(G.beatBest ? 45 : 100); }
    const msgs = [
      'Not a single slap. Bold strategy.',
      'The mosquito got the last laugh.',
      'So close. Sleep is a luxury.',
      'A respectable amount of violence.',
      'You are the reason mosquitoes fear bedtime.'
    ];
    const mi = G.score === 0 ? 0 : G.score < 3 ? 1 : G.score < 6 ? 2 : G.score < 10 ? 3 : 4;
    $('overMsg').textContent = msgs[mi];
    showScreen('over');
    updateHUDVisibility();
  }

  /* ---------------- audio ---------------- */
  const Sfx = {
    ctx: null,
    master: null,
    buzzGain: null,
    buzzPan: null,
    buzzFilter: null,
    oscs: [],
    noiseBuf: null,
    pools: {},
    poolIdx: {},
    audioErrors: {},
    buzzEl: null,
    buzzFile: false,
    buzzLevel: 0,
    buzzLastAt: 0,
    filesLoaded: false,
    oneShotsUnlocked: false,
    bufs: {},
    fb: null,
    decoding: false,

    init() {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      // Load the files before audio is triggered, then unlock the loop in the
      // user's tap/click. Custom clips play through HTMLAudioElement directly.
      this.loadFiles();
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          try {
            const resume = this.ctx.resume();
            if (resume && resume.catch) resume.catch(() => {});
          } catch (e) {}
        }
        this.unlockOneShots();
        this.unlockBuzz();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        this.unlockOneShots();
        this.unlockBuzz();
        return;
      }
      try {
        this.ctx = new AC();
        const resume = this.ctx.resume();
        if (resume && resume.catch) resume.catch(() => {});
      } catch (e) {
        this.unlockOneShots();
        this.unlockBuzz();
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = G.muted ? 0 : CONFIG.VOLUME;
      this.master.connect(c.destination);
      this.decodeBuffers();

      // buzz graph
      this.buzzPan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (this.buzzPan) this.buzzPan.connect(this.master);
      this.buzzGain = c.createGain();
      this.buzzGain.gain.value = 0;
      this.buzzGain.connect(this.buzzPan || this.master);

      this.buzzFilter = c.createBiquadFilter();
      this.buzzFilter.type = 'bandpass';
      this.buzzFilter.frequency.value = 900;
      this.buzzFilter.Q.value = 1.1;
      this.buzzFilter.connect(this.buzzGain);

      const trem = c.createGain();
      trem.gain.value = 0.72;
      trem.connect(this.buzzFilter);
      const lfo = c.createOscillator();
      lfo.frequency.value = 31;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0.33;
      lfo.connect(lfoGain);
      lfoGain.connect(trem.gain);
      lfo.start();

      this.oscs = [0, 1].map(i => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 430 + i * 6;
        o.connect(trem);
        o.start();
        return o;
      });

      this.unlockOneShots();
      this.unlockBuzz();
    },

    // Prime each sample in the same user gesture as Start. This lets mobile
    // browsers play the loss clip later, after the bite animation delay.
    unlockOneShots() {
      if (this.oneShotsUnlocked) return;
      this.oneShotsUnlocked = true;
      // Loss is automatic, so prime its single media element. Shots come
      // directly from pointer/keyboard actions and do not need priming.
      const audio = this.pools.lose && this.pools.lose[0];
      if (!audio) return;
      const restore = () => {
        try { audio.pause(); } catch (e) {}
        try { if (audio.readyState >= 1) audio.currentTime = 0; } catch (e) {}
        audio.muted = G.muted;
        audio.volume = clamp(CONFIG.VOLUME, 0, 1);
        audio.playbackRate = 1;
      };
      audio.muted = true;
      audio.volume = 0;
      try {
        const p = audio.play();
        if (p && p.then) p.then(restore, restore);
        setTimeout(restore, 240);
      } catch (e) { restore(); }
    },

    // start the loop silently inside a user gesture so custom buzz files
    // are allowed to play later (important on mobile Safari)
    unlockBuzz() {
      if (!this.buzzFile || !this.buzzEl) return;
      try {
        this.buzzEl.volume = 0;
        const p = this.buzzEl.play();
        if (p && p.catch) p.catch(() => this.failBuzz());
      } catch (e) { this.failBuzz(); }
    },

    createFileAudio(kind, src, loop) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.loop = !!loop;
      audio.volume = loop ? 0 : clamp(CONFIG.VOLUME, 0, 1);
      audio.muted = loop ? false : G.muted;
      const resolvedSrc = new URL(src, document.baseURI).href;
      audio.src = resolvedSrc;
      audio.addEventListener('error', () => {
        this.audioErrors[kind] = true;
        if (kind === 'buzz') this.failBuzz();
        if (window.console && console.warn) console.warn(`Audio file failed to load: ${resolvedSrc}`);
      }, { once: true });
      try { audio.load(); } catch (e) {}
      return audio;
    },

    failBuzz() {
      this.buzzFile = false;
      this.buzzEl = null;
    },

    loadFiles() {
      if (this.filesLoaded) return;
      this.filesLoaded = true;
      ['fire', 'lose', 'highscore', 'hit', 'miss', 'bite', 'ui'].forEach(k => {
        const src = CONFIG.SOUNDS[k];
        if (!src) return;
        const count = k === 'fire' ? 3 : 1;
        this.pools[k] = Array.from({ length: count }, () => this.createFileAudio(k, src, false));
        this.poolIdx[k] = 0;
      });
      if (CONFIG.SOUNDS.buzz) {
        this.buzzEl = this.createFileAudio('buzz', CONFIG.SOUNDS.buzz, true);
        this.buzzFile = true;
      }
    },

    // Decode the inlined sound files (window.MS_AUDIO) so they get real volume
    // fades, panning and pitch on every browser, including iPhones and file://.
    decodeBuffers() {
      const data = window.MS_AUDIO, c = this.ctx;
      if (!data || !c || this.decoding) return;
      this.decoding = true;
      Object.keys(data).forEach(kind => {
        try {
          const bin = atob(data[kind].split(',')[1]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const done = (buf) => {
            this.bufs[kind] = buf;
            if (kind === 'buzz' && this.buzzEl) {
              try { this.buzzEl.pause(); } catch (e) {}
              this.buzzEl = null;
              this.buzzFile = false;
            }
          };
          const p = c.decodeAudioData(bytes.buffer, done, () => {});
          if (p && p.catch) p.catch(() => {});
        } catch (e) {}
      });
    },

    // SOUND1: seamless mosquito loop. Volume fades in/out smoothly, it pans
    // with the mosquito, brightens and rises in pitch as it closes in.
    startBuzz() {
      if (this.fb || !this.bufs.buzz) return;
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.bufs.buzz;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1300;
      lp.Q.value = 0.4;
      const g = c.createGain();
      g.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      src.connect(lp);
      lp.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
      src.start();
      this.fb = { src, lp, g, pan };
    },

    setBuzzBuffer(v, pan, pitch) {
      this.startBuzz();
      const b = this.fb, t = this.ctx.currentTime;
      const target = v > 0.005 ? clamp(0.30 + v * 1.45, 0, 0.72) : 0;
      b.g.gain.setTargetAtTime(target, t, target > this.buzzLevel ? 0.10 : 0.18);
      this.buzzLevel = target;
      b.src.playbackRate.setTargetAtTime(clamp(0.94 + pitch * 0.12, 0.8, 1.3), t, 0.08);
      b.lp.frequency.setTargetAtTime(1300 + pitch * 4200, t, 0.1);
      if (b.pan) b.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.08);
    },

    // SOUND2 (fire, 1.12x) and SOUND3 (lose, long fade-out tail).
    playBuffer(kind) {
      const buf = this.bufs[kind], c = this.ctx;
      if (!buf || !c || !this.master) return false;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
      const rate = kind === 'fire' ? 1.12 : 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = c.createGain();
      const t = c.currentTime, dur = buf.duration / rate;
      const tail = kind === 'lose' ? 0.8 : kind === 'highscore' ? 0.12 : 0.05;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + 0.006);
      g.gain.setValueAtTime(1, Math.max(t + 0.006, t + dur - tail));
      g.gain.linearRampToValueAtTime(0, t + dur);
      const duck = c.createGain();
      src.connect(g);
      g.connect(duck);
      duck.connect(this.master);
      if (kind === 'lose') this.loseDuck = duck;
      if (kind === 'highscore' && this.loseDuck) this.loseDuck.gain.setTargetAtTime(0, t, 0.1);
      src.start(t);
      return true;
    },

    setBuzz(vol, pan, pitch) {
      const v = G.muted ? 0 : vol;
      if (this.bufs.buzz && this.ctx) { this.setBuzzBuffer(v, pan, pitch); return; }
      if (this.buzzFile && this.buzzEl) {
        const el = this.buzzEl;
        const target = v > 0.005 ? clamp(0.30 + v * 1.45, 0, 0.72) : 0;
        const now = performance.now();
        const elapsed = this.buzzLastAt ? clamp(now - this.buzzLastAt, 0, 100) : 16;
        this.buzzLastAt = now;
        const fadeMs = target > this.buzzLevel ? 260 : 430;
        const blend = 1 - Math.exp(-elapsed / fadeMs);
        this.buzzLevel += (target - this.buzzLevel) * blend;
        el.volume = clamp(this.buzzLevel, 0, 0.72);
        el.playbackRate = clamp(0.94 + pitch * 0.12, 0.8, 1.3);
        if (target > 0.008 || this.buzzLevel > 0.008) {
          if (el.paused) {
            const p = el.play();
            if (p && p.catch) p.catch(() => this.failBuzz());
          }
        } else if (G.mode !== 'playing' && G.mode !== 'dying' && !el.paused) {
          el.pause();
        }
        return;
      }
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.buzzGain.gain.setTargetAtTime(v * 0.46, t, 0.08);
      if (this.buzzPan) this.buzzPan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.1);
      this.oscs.forEach((o, i) => {
        o.frequency.setTargetAtTime(372 + pitch * 160 + i * 6, t, 0.1);
      });
      this.buzzFilter.frequency.setTargetAtTime(820 + pitch * 700, t, 0.1);
    },

    play(kind) {
      if (G.muted) return;
      if (this.playBuffer(kind)) return;
      const pool = this.pools[kind];
      if (pool && pool.length && !this.audioErrors[kind]) {
        const idx = this.poolIdx[kind] || 0;
        this.poolIdx[kind] = (idx + 1) % pool.length;
        const el = pool[idx];
        if (el) {
          try {
            try { if (el.readyState >= 1) el.currentTime = 0; } catch (e) {}
            el.volume = clamp(CONFIG.VOLUME, 0, 1);
            el.muted = false;
            el.playbackRate = kind === 'fire' ? 1.12 : 1;
            const p = el.play();
            if (p && p.catch) p.catch(() => this.synth(kind));
            return;
          } catch (e) {
            this.synth(kind);
            return;
          }
        }
      }
      this.synth(kind);
    },

    synth(kind) {
      if (G.muted) return;
      const c = this.ctx;
      if (!c) return;
      const t = c.currentTime;
      if (kind === 'ui') {
        this.tone(1250, 960, 0.045, 0.08, 'sine', 0);
        return;
      }
      if (kind === 'fire') {
        this.noise(0.11, 'bandpass', 4200, 850, 0.12, 0);
        this.tone(1050, 240, 0.15, 0.16, 'sawtooth', 0);
        return;
      }
      if (kind === 'lose') {
        this.tone(420, 300, 0.30, 0.16, 'sine', 0);
        this.tone(320, 200, 0.42, 0.16, 'triangle', 0.26);
        this.tone(220, 95, 0.70, 0.18, 'sine', 0.62);
        return;
      }
      if (kind === 'warn') {
        this.tone(880, 880, 0.08, 0.10, 'triangle', 0);
        this.tone(660, 660, 0.11, 0.10, 'triangle', 0.11);
        return;
      }
      if (kind === 'highscore') {
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 0.14, 'triangle', i * 0.11));
        return;
      }
      if (kind === 'miss') {
        this.noise(0.22, 'bandpass', 2900, 500, 0.20, 0);
        this.tone(360, 170, 0.18, 0.07, 'sine', 0);
        return;
      }
      if (kind === 'hit') {
        this.tone(190, 46, 0.2, 0.55, 'sine', 0);
        this.noise(0.16, 'lowpass', 2400, 320, 0.34, 0);
        this.tone(980, 980, 0.22, 0.10, 'triangle', 0.02);
        this.tone(1460, 1460, 0.20, 0.06, 'triangle', 0.03);
        return;
      }
      if (kind === 'bite') {
        this.tone(300, 80, 0.4, 0.3, 'sawtooth', 0);
        this.noise(0.28, 'lowpass', 1600, 200, 0.28, 0.02);
        this.tone(420, 300, 0.3, 0.10, 'triangle', 0.3);
        this.tone(320, 200, 0.45, 0.10, 'triangle', 0.42);
        return;
      }
    },

    tone(f0, f1, dur, vol, type, delay) {
      const c = this.ctx;
      if (!c) return;
      const t = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    noise(dur, type, f0, f1, vol, delay) {
      const c = this.ctx;
      if (!c) return;
      if (!this.noiseBuf) {
        const n = Math.floor(c.sampleRate * 0.6);
        const buf = c.createBuffer(1, n, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      const t = c.currentTime + (delay || 0);
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type || 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.05);
    },

    setMuted(m) {
      if (this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.setTargetAtTime(m ? 0 : CONFIG.VOLUME, t, 0.04);
      }
      Object.values(this.pools).forEach(pool => pool.forEach(el => { el.muted = m; }));
      // The mosquito loop fades via setBuzz; muting it directly would click.
    }
  };

  /* ---------------- confetti ---------------- */
  const Confetti = (() => {
    const cvs = document.createElement('canvas');
    cvs.id = 'confetti';
    stage.appendChild(cvs);
    const c = cvs.getContext('2d');
    const cols = ['#ffb21e', '#ff6f35', '#ff4f7b', '#6c5ce7', '#2ec4b6', '#ffffff'];
    let ps = [], raf = 0, last = 0;
    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const r = stage.getBoundingClientRect();
      c.clearRect(0, 0, r.width, r.height);
      ps.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.vx *= 0.995; p.rot += p.vr * dt; p.life -= dt;
        c.save(); c.globalAlpha = clamp(p.life / 0.6, 0, 1); c.translate(p.x, p.y); c.rotate(p.rot);
        c.fillStyle = p.col; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
      });
      ps = ps.filter(p => p.life > 0 && p.y < r.height + 20);
      raf = ps.length ? requestAnimationFrame(tick) : 0;
      if (!raf) c.clearRect(0, 0, r.width, r.height);
    }
    return {
      burst(n) {
        const r = stage.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
        cvs.width = r.width * d; cvs.height = r.height * d; c.setTransform(d, 0, 0, d, 0, 0);
        for (let i = 0; i < n; i++) ps.push({
          x: r.width * (0.1 + 0.8 * Math.random()), y: -10 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 170, vy: 90 + Math.random() * 240,
          w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12,
          col: cols[(Math.random() * cols.length) | 0], life: 2.4 + Math.random() * 1.2
        });
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      }
    };
  })();

  /* ---------------- buzz driver ---------------- */
  function updateBuzz() {
    let vol = 0, pan = 0, pitch = 0;
    const m = G.mq;
    if ((G.mode === 'playing') && m) {
      const f = rig.face;
      const d = dist(m.x, m.y, f.x, f.y);
      const near = clamp(1 - d / (Math.max(W, H) * 0.82), 0, 1);
      vol = 0.07 + Math.pow(near, 1.6) * 0.22;
      if (m.mode === 'dive') vol += 0.05;
      pan = clamp((m.x - W * 0.5) / (W * 0.55), -1, 1);
      pitch = near + (m.mode === 'dive' ? 0.3 : 0);
    }
    Sfx.setBuzz(vol, pan, pitch);
  }

  /* ---------------- scoring + UI ---------------- */
  function updateScore(pop) {
    scoreEl.textContent = String(G.score);
    if (pop) {
      scoreEl.classList.remove('pop');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('pop');
    }
  }
  function updateBestLabels() {
    bestEl.textContent = String(G.best);
    bestMenuEl.textContent = String(G.best);
    $('overBest').textContent = String(G.best);
  }
  function syncMuteUI() {
    const m = G.muted;
    btnMute.classList.toggle('is-muted', m);
    btnMute.setAttribute('aria-pressed', m ? 'true' : 'false');
    btnMute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
    btnMuteMenu.classList.toggle('is-muted', m);
    btnMuteMenu.setAttribute('aria-pressed', m ? 'true' : 'false');
    const label = btnMuteMenu.querySelector('.sound-label');
    if (label) label.textContent = m ? 'Sound off' : 'Sound on';
    btnMutePause.classList.toggle('is-muted', m);
    btnMutePause.textContent = m ? 'Sound off' : 'Sound on';
  }
  function setMuted(m) {
    G.muted = m;
    store.set('ms2.mute', m ? '1' : '0');
    syncMuteUI();
    Sfx.setMuted(m);
  }
  function updateHUDVisibility() {
    const visible = G.mode === 'playing' || G.mode === 'paused' || G.mode === 'dying';
    const interactive = G.mode === 'playing' || G.mode === 'dying';
    hud.classList.toggle('on', visible);
    hud.setAttribute('aria-hidden', visible ? 'false' : 'true');
    try { hud.inert = !interactive; } catch (e) {}
  }
  function showScreen(name) {
    Object.keys(screens).forEach(k => {
      const el = screens[k];
      const active = k === name;
      el.classList.toggle('show', active);
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
      try { el.inert = !active; } catch (e) {}
    });
  }

  function hideScreens() {
    Object.values(screens).forEach(el => {
      el.classList.remove('show');
      el.setAttribute('aria-hidden', 'true');
      try { el.inert = true; } catch (e) {}
    });
    const active = document.activeElement;
    if (active && active.blur && active !== document.body) active.blur();
  }
  function showHint() {
    if (G.hinted) return;
    G.hinted = true;
    hintEl.classList.add('show');
    clearTimeout(G.hintTimer);
    G.hintTimer = setTimeout(() => hintEl.classList.remove('show'), 3600);
  }
  function hideHint() {
    hintEl.classList.remove('show');
    clearTimeout(G.hintTimer);
  }
  function vibrate(pattern) {
    try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {}
  }

  /* ---------------- game flow ---------------- */
  function startGame() {
    Sfx.init();
    Sfx.play('ui');
    hideScreens();
    hideHint();
    G.mode = 'playing';
    G.score = 0;
    G.streak = 0;
    G.streakTimer = 0;
    streakEl.classList.remove('on');
    G.cool = 0;
    G.respawn = 0.45;
    G.beatBest = false;
    G.aim = null;
    G.aiming = false;
    G.pointerId = null;
    G.rigExt = 0;
    G.kick = 0;
    G.holdT = 0;
    G.holdAim = null;
    G.shake = 0;
    G.flash = 0;
    G.red = 0;
    G.biteT = 0;
    G.trail = [];
    G.particles = [];
    G.pulses = [];
    G.texts = [];
    G.splats = [];
    G.beams = [];
    G.face = pickFace();
    G.bestAtStart = G.best;
    G.mq = null;
    G.kills = 0; G.shots = 0; G.hits = 0; G.bestStreak = 0; G.level = 1; G.slow = 0; G.banner = null;
    lvlEl.textContent = '1';
    updateScore(false);
    updateBestLabels();
    updateHUDVisibility();
    showHint();
  }

  function goMenu() {
    G.mode = 'menu';
    G.mq = null;
    G.aim = null;
    G.aiming = false;
    G.pointerId = null;
    G.holdT = 0;
    G.holdAim = null;
    G.particles = [];
    G.pulses = [];
    G.texts = [];
    G.splats = [];
    G.beams = [];
    G.trail = [];
    G.shake = 0;
    G.flash = 0;
    G.red = 0;
    hideHint();
    updateBestLabels();
    updateHUDVisibility();
    showScreen('menu');
  }

  function pauseGame() {
    if (G.mode !== 'playing') return;
    G.mode = 'paused';
    G.aim = null;
    G.aiming = false;
    G.pointerId = null;
    G.holdT = 0;
    G.holdAim = null;
    hideHint();
    showScreen('pause');
    updateHUDVisibility();
  }

  function resumeGame() {
    if (G.mode !== 'paused') return;
    hideScreens();
    G.mode = 'playing';
    updateHUDVisibility();
    Sfx.init();
    Sfx.play('ui');
  }

  /* ---------------- main update ---------------- */
  function update(dt) {
    if (G.mode === 'paused') {
      updateRig(dt, false);
      updateBuzz();
      return;
    }
    G.t += dt;

    if (G.mode === 'playing') {
      G.cool = Math.max(0, G.cool - dt);
      if (G.streakTimer > 0) {
        G.streakTimer = Math.max(0, G.streakTimer - dt);
        if (G.streakTimer === 0) {
          G.streak = 0;
          streakEl.classList.remove('on');
        }
      }
      G.holdT = Math.max(0, G.holdT - dt);
      if (G.banner && (G.banner.life -= dt) <= 0) G.banner = null;
      updateRig(dt, false);
      if (!G.mq) {
        G.respawn -= dt;
        if (G.respawn <= 0) spawnMosquito();
      } else {
        updateMosquito(dt);
      }
      if (G.mode === 'playing') updateEffects(dt);
    } else if (G.mode === 'dying') {
      updateRig(dt, false);
      G.biteT += dt;
      if (G.mq) {
        const f = rig.face;
        G.mq.age += dt;
        G.mq.wing += dt * 34;
        const an = biteAnchor(G.mq);
        G.mq.x = an.x + Math.sin(G.t * 30) * 2.4;
        G.mq.y = an.y + Math.cos(G.t * 37) * 1.7;
      }
      updateEffects(dt);
      if (G.biteT >= 0.95) gameOver();
    } else if (G.mode === 'menu' || G.mode === 'over') {
      updateRig(dt, false);
      updateEffects(dt);
      if (G.mq && G.mq.mode === 'bitten') {
        G.mq.wing += dt * 18;
      }
    } else {
      updateRig(dt, false);
    }

    updateBuzz();
  }

  /* ---------------- render ---------------- */
  function drawDust() {
    ctx.save();
    dust.forEach(d => {
      const x = d.x + Math.sin(G.t * 0.35 + d.ph) * d.sway;
      let y = d.y - G.t * d.spd;
      y = ((y % H) + H) % H;
      ctx.globalAlpha = d.a;
      ctx.fillStyle = '#8b7560';
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawBanner() {
    const b = G.banner;
    if (!b || G.mode !== 'playing') return;
    const k = 1 - b.life / b.max;
    const pop = k < 0.15 ? lerp(0.5, 1.1, k / 0.15) : lerp(1.1, 1, clamp((k - 0.15) / 0.2, 0, 1));
    const a = b.life < 0.35 ? b.life / 0.35 : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H * 0.3);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(clamp(W * 0.13, 38, 62))}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = '#ffb21e';
    ctx.fillText(b.text, 0, 0);
    ctx.font = `800 ${Math.round(clamp(W * 0.04, 13, 18))}px ${FONT}`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,253,251,.95)';
    ctx.strokeText(b.sub, 0, 42);
    ctx.fillStyle = INK;
    ctx.fillText(b.sub, 0, 42);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f7f2f5';
    ctx.fillRect(0, 0, W, H);
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
    const shake = G.shake;
    const sx = shake > 0.1 ? (Math.random() * 2 - 1) * shake : 0;
    const sy = shake > 0.1 ? (Math.random() * 2 - 1) * shake : 0;

    ctx.save();
    ctx.translate(sx, sy);

    drawScene();
    drawEffectsBack();

    if (G.mode === 'playing') {
      if (G.aiming) drawAim();
      else drawIdleShotGuide();
    }
    if (G.mq) drawMosquito(G.mq);
    drawReticle();
    drawBeams();
    drawEffectsFront();

    ctx.restore();
    drawBanner();

    // menu decorative vignette? handled by CSS
    if (G.flash > 0) {
      ctx.globalAlpha = G.flash;
      ctx.fillStyle = '#fff3e6';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (G.red > 0) {
      const a = G.red;
      const g = ctx.createRadialGradient(W * 0.5, H * 0.55, Math.min(W, H) * 0.22, W * 0.5, H * 0.55, Math.max(W, H) * 0.75);
      g.addColorStop(0, `rgba(190,30,30,0)`);
      g.addColorStop(0.7, `rgba(190,30,30,${0.18 * a})`);
      g.addColorStop(1, `rgba(150,18,18,${0.42 * a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // danger: red edge pulse while the mosquito dives at the face
    if (G.mode === 'playing' && G.mq && G.mq.mode === 'dive') {
      const pu = 0.5 + 0.5 * Math.sin(G.t * 14);
      const dg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.5);
      dg.addColorStop(0, 'rgba(226,60,50,0)');
      dg.addColorStop(1, `rgba(226,60,50,${0.22 + 0.3 * pu})`);
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------- loop ---------------- */
  let lastT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);
    G.animT += dt;
    let sim = dt;
    if (G.slow > 0) { G.slow = Math.max(0, G.slow - dt); sim = dt * 0.4; }
    update(sim);
    draw();
  }

  /* ---------------- input ---------------- */
  function localPt(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'playing' || G.pointerId !== null) return;
    e.preventDefault();
    G.pointerId = e.pointerId;
    G.aiming = true;
    G.aim = localPt(e);
    hideHint();
    Sfx.init();
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  }, { passive: false });

  cv.addEventListener('pointermove', (e) => {
    if (G.pointerId !== e.pointerId || !G.aiming) return;
    e.preventDefault();
    G.aim = localPt(e);
  }, { passive: false });

  cv.addEventListener('pointerup', (e) => {
    if (G.pointerId !== e.pointerId) return;
    e.preventDefault();
    G.aim = localPt(e);
    const shouldFire = G.aiming;
    G.aiming = false;
    G.pointerId = null;
    if (shouldFire) fire();
    G.aim = null;
  }, { passive: false });

  function cancelPointer() {
    G.aiming = false;
    G.pointerId = null;
    G.aim = null;
    G.holdT = 0;
    G.holdAim = null;
    G.rigExt = 0;
  }
  cv.addEventListener('pointercancel', cancelPointer);
  cv.addEventListener('lostpointercapture', () => { if (G.mode !== 'playing') cancelPointer(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------------- buttons ---------------- */
  $('btnPlay').addEventListener('click', startGame);
  $('btnAgain').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', resumeGame);
  $('btnPause').addEventListener('click', pauseGame);
  $('btnHome').addEventListener('click', () => { Sfx.play('ui'); goMenu(); });
  $('btnPauseHome').addEventListener('click', () => { Sfx.play('ui'); goMenu(); });
  $('btnOverHome').addEventListener('click', () => { Sfx.play('ui'); goMenu(); });
  $('btnRestart').addEventListener('click', () => { hideScreens(); startGame(); });
  btnMute.addEventListener('click', () => { Sfx.init(); setMuted(!G.muted); Sfx.play('ui'); });
  btnMuteMenu.addEventListener('click', () => { Sfx.init(); setMuted(!G.muted); Sfx.play('ui'); });
  btnMutePause.addEventListener('click', () => { Sfx.init(); setMuted(!G.muted); Sfx.play('ui'); });

  addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') pauseGame();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (G.mode === 'menu') { e.preventDefault(); startGame(); }
      else if (G.mode === 'over') { e.preventDefault(); startGame(); }
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (G.mode === 'playing') pauseGame();
      else if (G.mode === 'paused') resumeGame();
    }
    if (e.key === 'm' || e.key === 'M') {
      Sfx.init();
      setMuted(!G.muted);
    }
    if (e.key === 'r' || e.key === 'R') {
      if (G.mode === 'playing' || G.mode === 'over' || G.mode === 'paused') startGame();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'playing') pauseGame();
  });
  addEventListener('blur', () => {
    if (G.mode === 'playing') pauseGame();
  });

  /* ---------------- resize ---------------- */
  let resizeRaf = 0;
  function scheduleLayout() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => layout());
  }
  addEventListener('resize', scheduleLayout);
  addEventListener('orientationchange', () => setTimeout(layout, 220));
  if (window.ResizeObserver) {
    new ResizeObserver(() => scheduleLayout()).observe(stage);
  }

  /* ---------------- install as app (PWA) ---------------- */
  (() => {
    const btn = $('btnInstall');
    let deferred = null;
    const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
    const toast = $('toast');
    const say = (msg, ms) => { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), ms || 3200); };
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
      // fires once everything is cached: from then on the game works with no connection
      navigator.serviceWorker.ready.then(() => {
        if (store.get('ms2.offlineReady', '0') !== '1') { store.set('ms2.offlineReady', '1'); say('Ready to play offline \u2713'); }
      }).catch(() => {});
    }
    addEventListener('offline', () => say('You\u2019re offline \u2013 the game still works'));
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone) document.body.classList.add('can-install'); });
    addEventListener('appinstalled', () => { document.body.classList.remove('can-install'); say('Installed \u2713'); });
    if (ios) { btn.textContent = 'Add to Home Screen'; document.body.classList.add('can-install'); }
    btn.addEventListener('click', () => {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(() => { deferred = null; document.body.classList.remove('can-install'); });
      } else if (ios) {
        btn.textContent = 'Tap Share, then Add to Home Screen';
        setTimeout(() => { btn.textContent = 'Add to Home Screen'; }, 4500);
      }
    });
  })();

  /* ---------------- boot ---------------- */
  Sfx.loadFiles();
  updateBestLabels();
  syncMuteUI();
  showScreen('menu');
  updateHUDVisibility();
  layout();
  Sfx.setMuted(G.muted);
  // make sure the initial face is something nice
  G.face = pickFace();
  requestAnimationFrame(frame);
})();
