// ai-excited-01 entry: "Koi Leap" — a colossal golden-crimson koi leaping out of a
// dark indigo sea toward a huge glowing full moon, its body arcing diagonally
// across the frame, water spray bursting into stars, a tiny lantern boat below.
// The whole image is drawn procedurally by this program (Node 22, standard
// library only, no network, no external files). It is fully deterministic:
// a fixed seed drives every random choice, so two runs write identical bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32, fixed seed) — no wall clock, no Math.random.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// PNG encoder (stdlib only): RGB8, one Sub filter per row, zlib deflate.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgb, w, h) {
  // Filtered scanlines: Sub filter (type 1) — good compression for gradients.
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 3);
    raw[rowStart] = 1;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 3;
      const dst = rowStart + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        const left = x === 0 ? 0 : rgb[src - 3 + c];
        raw[dst + c] = (rgb[src + c] - left) & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: a flat RGB buffer with source-over blending and shape helpers.
// ---------------------------------------------------------------------------
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }
  blend(x, y, r, g, b, a) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h || a <= 0) return;
    const i = (iy * this.w + ix) * 3;
    const inv = 1 - a;
    this.px[i] = r * a + this.px[i] * inv;
    this.px[i + 1] = g * a + this.px[i + 1] * inv;
    this.px[i + 2] = b * a + this.px[i + 2] * inv;
  }
  // Vertical gradient between colour stops [[t, r, g, b], ...] over y range.
  vgrad(y0, y1, stops) {
    for (let y = 0; y < this.h; y++) {
      const t = clamp((y - y0) / (y1 - y0), 0, 1);
      let s0 = stops[0];
      let s1 = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) {
          s0 = stops[i];
          s1 = stops[i + 1];
          break;
        }
      }
      const lt = s1[0] === s0[0] ? 0 : (t - s0[0]) / (s1[0] - s0[0]);
      const r = lerp(s0[1], s1[1], lt);
      const g = lerp(s0[2], s1[2], lt);
      const b = lerp(s0[3], s1[3], lt);
      const row = y * this.w * 3;
      for (let x = 0; x < this.w; x++) {
        this.px[row + x * 3] = r;
        this.px[row + x * 3 + 1] = g;
        this.px[row + x * 3 + 2] = b;
      }
    }
  }
  // Solid disc, optionally soft-edged (feather px of falloff).
  disc(cx, cy, rad, r, g, b, a, feather = 0) {
    const x0 = Math.max(0, Math.floor(cx - rad - feather));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rad + feather));
    const y0 = Math.max(0, Math.floor(cy - rad - feather));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rad + feather));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        let alpha = 0;
        if (d <= rad) alpha = 1;
        else if (feather > 0 && d <= rad + feather) alpha = 1 - (d - rad) / feather;
        if (alpha > 0) this.blend(x, y, r, g, b, a * alpha);
      }
    }
  }
  // Radial glow: alpha falls off as (1 - d/rad)^2.
  glow(cx, cy, rad, r, g, b, a) {
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d < 1) {
          const f = (1 - d) * (1 - d);
          this.blend(x, y, r, g, b, a * f);
        }
      }
    }
  }
  // Filled polygon (scanline fill).
  poly(points, r, g, b, a) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(this.h - 1, Math.floor(maxY)); y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.max(0, Math.ceil(xs[i])); x <= Math.min(this.w - 1, Math.floor(xs[i + 1])); x++) {
          this.blend(x, y, r, g, b, a);
        }
      }
    }
  }
  // Thick line as a chain of discs (round caps).
  thickLine(x1, y1, x2, y2, width, r, g, b, a) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, width / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(lerp(x1, x2, t), lerp(y1, y2, t), width / 2, r, g, b, a);
    }
  }
  // Four-point star sparkle.
  sparkle(cx, cy, rad, r, g, b, a) {
    this.glow(cx, cy, rad, r, g, b, a * 0.8);
    this.thickLine(cx - rad, cy, cx + rad, cy, Math.max(1, rad * 0.12), r, g, b, a);
    this.thickLine(cx, cy - rad, cx, cy + rad, Math.max(1, rad * 0.12), r, g, b, a);
  }
}

// ---------------------------------------------------------------------------
// Scene: sky, nebula, stars, moon.
// ---------------------------------------------------------------------------
function drawSky(cv) {
  // Deep indigo at the top, warming to violet and rose-gold at the horizon.
  cv.vgrad(0, H, [
    [0.0, 8, 10, 38],
    [0.35, 22, 20, 66],
    [0.62, 52, 32, 92],
    [0.8, 96, 44, 96],
    [1.0, 150, 66, 78],
  ]);

  // Slow nebula clouds: big soft blobs of magenta, cyan and gold.
  const clouds = [
    [180, 180, 260, 150, 60, 140, 0.16],
    [760, 420, 300, 90, 120, 190, 0.13],
    [520, 120, 220, 60, 140, 200, 0.12],
    [880, 140, 200, 255, 190, 110, 0.10],
    [120, 560, 240, 200, 80, 130, 0.10],
    [640, 620, 260, 120, 60, 160, 0.09],
  ];
  for (const [x, y, rad, r, g, b, a] of clouds) cv.glow(x, y, rad, r, g, b, a);

  // Stars: dense above, sparse near the horizon; a few cross sparkles.
  for (let i = 0; i < 520; i++) {
    const x = rand() * W;
    const y = Math.pow(rand(), 1.6) * 760;
    const s = rand();
    const bright = 0.35 + 0.65 * rand();
    const rad = s < 0.85 ? 0.8 + rand() * 0.9 : 1.6 + rand() * 1.4;
    const warm = rand() < 0.25;
    cv.disc(x, y, rad, warm ? 255 : 225, warm ? 220 : 235, warm ? 180 : 255, bright * 0.9, 1.2);
    if (s > 0.96) cv.sparkle(x, y, 7 + rand() * 6, 255, 244, 200, 0.85);
  }
}

function drawMoon(cv) {
  const mx = 768;
  const my = 218;
  // Halo, then the disc with a warm rim.
  cv.glow(mx, my, 300, 255, 214, 150, 0.35);
  cv.glow(mx, my, 170, 255, 236, 190, 0.5);
  cv.disc(mx, my, 108, 255, 244, 214, 1, 3);
  // Craters: soft darker maria, kept subtle so the disc stays clean.
  const craters = [
    [736, 190, 26, 0.10],
    [796, 244, 18, 0.08],
    [772, 168, 12, 0.09],
    [726, 246, 14, 0.07],
    [800, 200, 9, 0.08],
  ];
  for (const [x, y, rad, a] of craters) cv.disc(x, y, rad, 214, 196, 160, a, rad * 0.6);
  // Bright limb on the side facing the koi.
  cv.glow(mx - 40, my + 52, 90, 255, 250, 225, 0.35);
}

// ---------------------------------------------------------------------------
// Scene: sea, moon reflection, foam, lantern boat.
// ---------------------------------------------------------------------------
function drawSea(cv) {
  // Sea surface from y=800 down, dark teal fading into the sky's rose glow.
  for (let y = 800; y < H; y++) {
    const t = (y - 800) / (H - 800);
    const r = lerp(16, 42, t);
    const g = lerp(38, 52, t);
    const b = lerp(74, 78, t);
    const row = y * W * 3;
    for (let x = 0; x < W; x++) {
      cv.px[row + x * 3] = r;
      cv.px[row + x * 3 + 1] = g;
      cv.px[row + x * 3 + 2] = b;
    }
  }
  // Horizon glow where the sea meets the sky.
  cv.glow(512, 800, 420, 255, 170, 110, 0.14);

  // Rolling wave crests: long pale strokes, brighter near the moon's column.
  for (let k = 0; k < 4; k++) {
    const yBase = 838 + k * 46;
    const amp = 10 + k * 4;
    let prevX = 0;
    let prevY = yBase + Math.sin(0) * amp;
    for (let x = 24; x <= W; x += 24) {
      const y = yBase + Math.sin(x / 170 + k * 1.7) * amp + (rand() - 0.5) * 4;
      const nearMoon = 1 - Math.min(1, Math.abs(x - 768) / 500);
      cv.thickLine(prevX, prevY, x, y, 2.5, 190, 220, 235, 0.16 + 0.22 * nearMoon);
      prevX = x;
      prevY = y;
    }
  }

  // Moon reflection: a shimmering golden column under the moon.
  for (let i = 0; i < 90; i++) {
    const y = 812 + rand() * 200;
    const spread = 26 + (y - 812) * 0.55;
    const x = 768 + (rand() - 0.5) * spread * 2;
    const len = 6 + rand() * 22;
    cv.thickLine(x, y, x + len, y, 2.2, 255, 205, 120, 0.28 + rand() * 0.3);
  }

  // Foam flecks near the koi's splash zone (lower left).
  for (let i = 0; i < 70; i++) {
    const x = 60 + rand() * 420;
    const y = 806 + rand() * 90;
    cv.disc(x, y, 0.8 + rand() * 2.2, 220, 235, 245, 0.25 + rand() * 0.4, 1);
  }
}

function drawBoat(cv) {
  // A tiny lantern boat, the small human detail: hull, sail, warm lantern.
  const bx = 296;
  const by = 902;
  cv.poly(
    [
      [bx - 34, by],
      [bx + 34, by],
      [bx + 22, by + 13],
      [bx - 22, by + 13],
    ],
    28,
    16,
    26,
    1,
  );
  cv.thickLine(bx, by, bx, by - 34, 2.5, 40, 26, 30, 1);
  cv.poly(
    [
      [bx, by - 34],
      [bx, by - 2],
      [bx + 26, by - 2],
    ],
    250,
    236,
    200,
    0.95,
  );
  cv.glow(bx, by - 8, 16, 255, 190, 90, 0.9);
  cv.disc(bx, by - 8, 3.5, 255, 210, 110, 1, 1.5);
  // Its reflection shimmering on the water.
  for (let i = 0; i < 8; i++) {
    const y = by + 18 + i * 6;
    cv.thickLine(bx - 12 + rand() * 8, y, bx + 12 - rand() * 8, y, 1.6, 255, 190, 100, 0.3);
  }
  // Birds high above the boat.
  const birds = [
    [180, 640],
    [240, 610],
    [150, 690],
    [330, 660],
  ];
  for (const [x, y] of birds) {
    cv.thickLine(x - 9, y, x, y - 6, 2, 20, 18, 34, 0.9);
    cv.thickLine(x, y - 6, x + 9, y, 2, 20, 18, 34, 0.9);
  }
}

// ---------------------------------------------------------------------------
// Scene: the koi. A quadratic-bezier spine arcs from the water (lower left)
// up to the moon (upper right); the head points at the moon.
// ---------------------------------------------------------------------------
function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function bezTan(p0, p1, p2, t) {
  const u = 1 - t;
  return [2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
}

function koiColor(t) {
  // Tail crimson -> orange -> gold -> cream head.
  const stops = [
    [0.0, 168, 28, 38],
    [0.35, 224, 84, 32],
    [0.65, 245, 158, 32],
    [0.85, 255, 205, 90],
    [1.0, 255, 240, 205],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const lt = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [lerp(stops[i][1], stops[i + 1][1], lt), lerp(stops[i][2], stops[i + 1][2], lt), lerp(stops[i][3], stops[i + 1][3], lt)];
    }
  }
  return [255, 240, 205];
}

function drawKoi(cv) {
  const p0 = [128, 836];
  const p1 = [470, 250];
  const p2 = [812, 300];
  const N = 90;

  // 1) Glow behind the body so it burns against the night.
  for (let i = 0; i <= N; i += 4) {
    const t = i / N;
    const [x, y] = bez(p0, p1, p2, t);
    const rad = 62 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.8) + 14;
    cv.glow(x, y, rad + 46, 255, 150, 60, 0.10);
  }

  // 2) Body: overlapping discs along the spine, radius swelling mid-body.
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = bez(p0, p1, p2, t);
    const rad = 60 * Math.pow(Math.sin(Math.PI * (0.10 + 0.90 * t)), 0.75) + 10;
    spine.push([x, y, rad, t]);
    const [r, g, b] = koiColor(t);
    cv.disc(x, y, rad, r, g, b, 1, 2);
  }

  // 3) Cream belly: a smooth lighter band along the lower edge of the body,
  // drawn as large overlapping soft discs so it blends instead of dotting.
  for (let i = 6; i <= N - 4; i += 1) {
    const [x, y, rad, t] = spine[i];
    const [, ty] = bezTan(p0, p1, p2, t);
    const [tx] = bezTan(p0, p1, p2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const [r, g, b] = koiColor(t);
    cv.disc(x + nx * rad * 0.38, y + ny * rad * 0.38, rad * 0.62, Math.min(255, r + 38), Math.min(255, g + 34), Math.min(255, b + 50), 0.16, 6);
  }
  // A darker spine stripe along the top edge gives the body a defined back.
  for (let i = 4; i <= N - 2; i += 1) {
    const [x, y, rad, t] = spine[i];
    const [tx, ty] = bezTan(p0, p1, p2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    cv.disc(x - nx * rad * 0.55, y - ny * rad * 0.55, rad * 0.30, 120, 26, 26, 0.16, 5);
  }

  // 4) Scales: rows of small dark-gold arcs following the spine, subtle.
  for (let row = 0; row < 5; row++) {
    const off = -0.6 + row * 0.3; // across the body, -1..1
    for (let i = 4; i < N - 2; i += 4) {
      const [x, y, rad, t] = spine[i];
      const [tx, ty] = bezTan(p0, p1, p2, t);
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      const sx = x + nx * rad * off;
      const sy = y + ny * rad * off;
      const sr = rad * 0.20;
      // A scale reads as a small arc: stamp dots along its lower half.
      for (let a = 0.15 * Math.PI; a <= 0.85 * Math.PI; a += 0.35) {
        cv.disc(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr * 0.8, 1.0, 120, 40, 20, 0.18);
      }
    }
  }

  // 5) Dorsal fin: a low, darker ridge along the top of the mid-body, subtle.
  const dorsal = [];
  for (let i = 18; i <= 62; i += 2) {
    const [x, y, rad, t] = spine[i];
    const [tx, ty] = bezTan(p0, p1, p2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const wave = Math.sin(i * 0.9) * 5;
    dorsal.push([x - nx * (rad + 3 + wave), y - ny * (rad + 3 + wave)]);
  }
  const dorsalBase = [];
  for (let i = 62; i >= 18; i -= 2) {
    const [x, y, rad] = spine[i];
    const [tx, ty] = bezTan(p0, p1, p2, i / N);
    const len = Math.hypot(tx, ty) || 1;
    dorsalBase.push([x - (-ty / len) * rad * 0.55, y - (tx / len) * rad * 0.55]);
  }
  cv.poly([...dorsal, ...dorsalBase], 150, 30, 44, 0.5);

  // 6) Tail: two long flowing ribbons fanning from the tail base, kept
  // inside the frame, translucent. The tail base sits in the water.
  const [tx0, ty0] = bez(p0, p1, p2, 0.02);
  const tailA = [];
  const tailB = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const sway = Math.sin(t * 3.2) * 22;
    tailA.push([tx0 - 8 - t * 118, ty0 - 16 - t * 66 + sway]);
    tailB.push([tx0 - 2 - t * 132, ty0 + 22 + t * 34 + sway * 0.7]);
  }
  cv.poly(
    [
      [tx0 - 10, ty0 - 34],
      ...tailA,
      [tx0 - 138, ty0 + 18],
      [tx0 - 10, ty0 + 40],
    ],
    232,
    90,
    40,
    0.85,
  );
  cv.poly(
    [
      [tx0 - 6, ty0 + 30],
      ...tailB,
      [tx0 - 146, ty0 + 78],
      [tx0 - 6, ty0 + 44],
    ],
    255,
    170,
    60,
    0.7,
  );
  // Tail veins.
  cv.thickLine(tx0 - 20, ty0, tx0 - 120, ty0 - 44, 2, 255, 220, 140, 0.5);
  cv.thickLine(tx0 - 20, ty0 + 20, tx0 - 130, ty0 + 56, 2, 255, 220, 140, 0.45);

  // 7) Pectoral fin near the head: small, tucked against the belly,
  // gold and translucent so it reads as part of the fish.
  const [hx, hy] = bez(p0, p1, p2, 0.93);
  cv.poly(
    [
      [hx - 8, hy + 30],
      [hx - 44, hy + 66],
      [hx - 18, hy + 74],
      [hx + 8, hy + 44],
    ],
    240,
    170,
    70,
    0.6,
  );

  // 8) Head: eye, gill arc, whiskers reaching toward the moon.
  const [ex, ey] = bez(p0, p1, p2, 0.97);
  cv.disc(ex + 6, ey - 12, 11, 255, 252, 240, 1, 1.5);
  cv.disc(ex + 8, ey - 12, 5.5, 12, 10, 18, 1);
  cv.disc(ex + 10, ey - 14, 2, 255, 255, 255, 1);
  // Gill arc.
  for (let a = -0.6; a <= 1.1; a += 0.12) {
    cv.disc(ex - 26 + Math.cos(a) * 22, ey + 6 + Math.sin(a) * 22, 1.6, 150, 40, 30, 0.6);
  }
  // Whiskers: two thin curves from the snout toward the moon.
  for (const [dx, dy, bend] of [
    [0, 0, -26],
    [0, 6, -14],
  ]) {
    let px = ex + 34 + dx;
    let py = ey - 4 + dy;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const nx = ex + 34 + t * 74;
      const ny = ey - 4 + dy + bend * Math.sin(t * Math.PI * 0.8) - t * 10;
      cv.thickLine(px, py, nx, ny, 1.8, 255, 230, 170, 0.85);
      px = nx;
      py = ny;
    }
  }
}

// ---------------------------------------------------------------------------
// Spray: water bursting off the leap, droplets turning into stars.
// ---------------------------------------------------------------------------
function drawSpray(cv) {
  const p0 = [128, 836];
  const p1 = [470, 250];
  const p2 = [812, 300];
  // Droplets trailing the body and bursting at the splash point, kept
  // close to the body so the sky stays clean.
  for (let i = 0; i < 170; i++) {
    const t = rand();
    const [x, y] = bez(p0, p1, p2, t);
    const [tx, ty] = bezTan(p0, p1, p2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const side = rand() < 0.5 ? -1 : 1;
    const off = (24 + rand() * 82) * side;
    const dx = x + nx * off + (rand() - 0.5) * 40;
    const dy = y + ny * off - rand() * 40;
    const r = 0.8 + rand() * 3.2;
    const gold = rand() < 0.3;
    cv.disc(dx, dy, r, gold ? 255 : 215, gold ? 205 : 235, gold ? 130 : 255, 0.5 + rand() * 0.45, 1.2);
  }
  // Star-bursts: some droplets have already become stars.
  for (let i = 0; i < 34; i++) {
    const t = rand();
    const [x, y] = bez(p0, p1, p2, t);
    const dx = x + (rand() - 0.5) * 300;
    const dy = y + (rand() - 0.5) * 220 - 30;
    cv.sparkle(dx, dy, 5 + rand() * 9, 255, 220, 140, 0.9);
  }
  // The splash crown where the tail leaves the water.
  for (let i = 0; i < 60; i++) {
    const a = Math.PI * (0.9 + rand() * 1.2);
    const d = 20 + rand() * 130;
    const x = 128 + Math.cos(a) * d;
    const y = 836 - Math.abs(Math.sin(a)) * d * 0.7;
    cv.disc(x, y, 1 + rand() * 3, 225, 240, 250, 0.55 + rand() * 0.4, 1.2);
  }
}

// ---------------------------------------------------------------------------
// Finish: vignette, then write the PNG.
// ---------------------------------------------------------------------------
function drawScene() {
  const cv = new Canvas(W, H);
  drawSky(cv);
  drawMoon(cv);
  drawSea(cv);
  drawBoat(cv);
  drawKoi(cv);
  drawSpray(cv);
  // Vignette: gently darken the corners so the eye stays on the koi.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - W / 2, y - H / 2) / (W * 0.72);
      if (d > 0.82) {
        const a = (d - 0.82) * 0.55;
        cv.blend(x, y, 4, 4, 16, Math.min(0.35, a));
      }
    }
  }
  return cv;
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG(drawScene().px, W, H);
writeFileSync(join(outDir, 'entry.png'), png);
