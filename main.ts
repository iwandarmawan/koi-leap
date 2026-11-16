// ai-excited-01 entry v2: "The Dragon That Escaped Its Book" — a great golden
// dragon bursting out of an open pop-up book on a desk at night. Paper shards
// and pages explode outward, the dragon's body arcs diagonally across the
// frame, wings spread, embers rising; a small desk lamp and scattered pencils
// below give the scale. The whole image is drawn procedurally by this program
// (Node 22, standard library only, no network, no external files). It is fully
// deterministic: a fixed seed drives every random choice, so two runs write
// identical bytes.
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
const rand = mulberry32(20261117);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
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
  ihdr[8] = 8;
  ihdr[9] = 2;
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
  thickLine(x1, y1, x2, y2, width, r, g, b, a) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, width / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(lerp(x1, x2, t), lerp(y1, y2, t), width / 2, r, g, b, a);
    }
  }
  sparkle(cx, cy, rad, r, g, b, a) {
    this.glow(cx, cy, rad, r, g, b, a * 0.8);
    this.thickLine(cx - rad, cy, cx + rad, cy, Math.max(1, rad * 0.12), r, g, b, a);
    this.thickLine(cx, cy - rad, cx, cy + rad, Math.max(1, rad * 0.12), r, g, b, a);
  }
  // Rotated rectangle centred at (cx, cy), half-sizes hw/hh, angle radians.
  rrect(cx, cy, hw, hh, ang, r, g, b, a) {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const pts = [];
    for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      pts.push([cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]);
    }
    this.poly(pts, r, g, b, a);
  }
}

// ---------------------------------------------------------------------------
// Scene: night room, desk, lamp.
// ---------------------------------------------------------------------------
function drawRoom(cv) {
  // Deep indigo night at the top, warming toward the lamp-lit desk.
  cv.vgrad(0, H, [
    [0.0, 6, 8, 30],
    [0.4, 14, 14, 48],
    [0.68, 34, 22, 62],
    [0.85, 58, 30, 52],
    [1.0, 74, 40, 34],
  ]);
  // Faint stars / dust high up.
  for (let i = 0; i < 160; i++) {
    const x = rand() * W;
    const y = Math.pow(rand(), 1.8) * 420;
    cv.disc(x, y, 0.7 + rand() * 1.1, 220, 225, 255, 0.25 + rand() * 0.5, 1);
  }
  // Bookshelf silhouette, far wall, upper left.
  cv.poly([[0, 0], [300, 0], [300, 210], [0, 240]], 10, 10, 26, 0.85);
  for (let s = 0; s < 3; s++) {
    const y = 62 + s * 58;
    cv.thickLine(14, y, 286, y, 5, 22, 18, 34, 1);
    for (let b = 0; b < 9; b++) {
      const bx = 24 + b * 28 + rand() * 6;
      const bh = 26 + rand() * 18;
      const warm = rand() < 0.5;
      cv.rrect(bx, y - bh / 2 - 3, 9, bh / 2, (rand() - 0.5) * 0.06, warm ? 74 : 46, warm ? 40 : 44, warm ? 52 : 66, 0.9);
    }
  }
  // Window glow, upper right: a cold moonlit rectangle behind the dragon.
  cv.poly([[700, 60], [980, 40], [990, 300], [710, 320]], 40, 52, 96, 0.55);
  cv.thickLine(845, 50, 850, 310, 6, 18, 20, 44, 0.9);
  cv.thickLine(705, 180, 985, 170, 6, 18, 20, 44, 0.9);
  cv.glow(850, 180, 130, 150, 170, 230, 0.18);
}

function drawDesk(cv) {
  // Wooden desk surface from y=800 down, warm brown with a sheen.
  for (let y = 800; y < H; y++) {
    const t = (y - 800) / (H - 800);
    const r = lerp(52, 88, t);
    const g = lerp(32, 52, t);
    const b = lerp(18, 26, t);
    const row = y * W * 3;
    for (let x = 0; x < W; x++) {
      cv.px[row + x * 3] = r;
      cv.px[row + x * 3 + 1] = g;
      cv.px[row + x * 3 + 2] = b;
    }
  }
  // Wood grain streaks.
  for (let i = 0; i < 26; i++) {
    const y = 812 + rand() * 200;
    const x0 = rand() * 300;
    const len = 200 + rand() * 500;
    cv.thickLine(x0, y, x0 + len, y + (rand() - 0.5) * 6, 1.6, 40, 24, 14, 0.35);
  }
  // Desk edge highlight.
  cv.thickLine(0, 800, W, 800, 3, 150, 96, 52, 0.5);
  // Warm pool of lamplight on the desk, lower right.
  cv.glow(830, 900, 320, 255, 176, 92, 0.22);
}

function drawLamp(cv) {
  // Brass desk lamp, lower right — the small human anchor for scale.
  const bx = 852;
  const by = 1000;
  // Base.
  cv.poly([[bx - 52, by], [bx + 52, by], [bx + 34, by - 18], [bx - 34, by - 18]], 96, 70, 30, 1);
  cv.disc(bx, by - 18, 34, 120, 88, 38, 1, 2);
  // Stem, leaning left toward the book.
  cv.thickLine(bx, by - 18, bx - 78, 836, 9, 110, 80, 34, 1);
  cv.disc(bx - 78, 836, 10, 130, 96, 42, 1);
  // Shade: a wide cone, glowing from inside.
  cv.poly(
    [
      [bx - 78, 836],
      [bx - 178, 876],
      [bx - 52, 904],
      [bx - 118, 852],
    ],
    46, 88, 40, 1,
  );
  cv.poly(
    [
      [bx - 178, 876],
      [bx - 52, 904],
      [bx - 58, 874],
      [bx - 168, 850],
    ],
    255, 214, 130, 0.95,
  );
  // Bulb glow spilling onto the book.
  cv.glow(bx - 115, 884, 200, 255, 196, 110, 0.85);
  cv.disc(bx - 115, 884, 18, 255, 236, 180, 1, 4);
  // Light cone down to the desk.
  cv.poly([[bx - 150, 880], [bx - 70, 884], [bx - 20, 1000], [bx - 210, 1000]], 255, 190, 100, 0.10);
  // Two pencils, scattered left of the lamp, one rolling.
  cv.thickLine(700, 962, 806, 940, 7, 220, 60, 40, 1);
  cv.poly([[806, 940], [824, 944], [806, 948]], 250, 220, 170, 1);
  cv.thickLine(660, 996, 762, 1008, 7, 40, 90, 200, 1);
  cv.poly([[762, 1008], [780, 1000], [762, 1000]], 250, 220, 170, 1);
  // Ink bottle near the book.
  cv.disc(268, 946, 22, 16, 14, 26, 1, 2);
  cv.disc(268, 946, 15, 30, 26, 48, 1, 2);
  cv.disc(268, 922, 8, 60, 52, 70, 1, 1);
  cv.glow(268, 946, 40, 80, 60, 120, 0.25);
}

function drawDeskProps(cv) {
  // A stack of three books, bottom left, balancing the lamp.
  const stack = [
    [70, 1002, 190, 22, 40, 70, 110],
    [84, 980, 162, 22, 120, 30, 34],
    [98, 958, 134, 22, 30, 90, 50],
  ];
  for (const [x, y, w, h, r, g, b] of stack) {
    cv.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, g, b, 1);
    cv.poly([[x + w - 14, y + 3], [x + w, y + 3], [x + w, y + h - 3], [x + w - 14, y + h - 3]], 240, 228, 196, 1);
  }
  // Coffee mug near the lamp, steam curling up.
  cv.poly([[918, 946], [978, 946], [972, 1006], [924, 1006]], 30, 90, 130, 1);
  cv.poly([[978, 956], [996, 956], [996, 990], [978, 990]], 30, 90, 130, 1);
  cv.disc(948, 946, 26, 60, 40, 26, 1, 2);
  for (let i = 0; i < 3; i++) {
    const y = 940 - i * 16;
    cv.thickLine(940 + Math.sin(i * 2.2) * 8, y, 948 + Math.sin(i * 2.2 + 1) * 8, y - 12, 3, 255, 230, 200, 0.35);
  }
}

// ---------------------------------------------------------------------------
// Scene: the open pop-up book, bursting.
// ---------------------------------------------------------------------------
function drawBook(cv) {
  const cx = 470;
  const cy = 812;
  // Shadow under the book.
  cv.poly([[cx - 260, cy + 40], [cx + 270, cy + 40], [cx + 300, cy + 96], [cx - 290, cy + 96]], 0, 0, 0, 0.35);
  // Red hard cover, slightly wider than the pages.
  cv.poly(
    [
      [cx - 268, cy - 8],
      [cx + 278, cy - 8],
      [cx + 296, cy + 88],
      [cx - 286, cy + 88],
    ],
    128, 22, 26, 1,
  );
  // Left page: cream, curling up at the far edge.
  cv.poly(
    [
      [cx - 252, cy],
      [cx - 6, cy - 14],
      [cx - 6, cy + 74],
      [cx - 258, cy + 76],
    ],
    248, 232, 196, 1,
  );
  // Right page: cream, its outer corner torn upward by the dragon.
  cv.poly(
    [
      [cx + 6, cy - 14],
      [cx + 262, cy],
      [cx + 268, cy + 76],
      [cx + 6, cy + 74],
    ],
    240, 222, 182, 1,
  );
  // Page lines: faint printed text rows, some torn across the burst.
  for (let p = 0; p < 2; p++) {
    const x0 = p === 0 ? cx - 232 : cx + 26;
    for (let r = 0; r < 4; r++) {
      const y = cy + 12 + r * 14;
      const len = 150 - r * 22;
      cv.thickLine(x0, y, x0 + len, y, 2.5, 120, 100, 70, 0.5);
    }
  }
  // Spine shadow down the middle.
  cv.thickLine(cx, cy - 14, cx, cy + 76, 5, 90, 60, 40, 0.5);
  // The burst crater: the pages rip open where the dragon tore out.
  cv.poly(
    [
      [cx - 70, cy + 6],
      [cx - 30, cy - 26],
      [cx + 18, cy - 34],
      [cx + 66, cy - 6],
      [cx + 44, cy + 34],
      [cx - 8, cy + 44],
      [cx - 56, cy + 30],
    ],
    30, 16, 14, 1,
  );
  cv.poly(
    [
      [cx - 58, cy + 8],
      [cx - 24, cy - 18],
      [cx + 16, cy - 26],
      [cx + 54, cy - 4],
      [cx + 36, cy + 26],
      [cx - 6, cy + 34],
      [cx - 46, cy + 24],
    ],
    255, 150, 60, 0.35,
  );
  // Torn page flaps curling up around the crater.
  cv.poly([[cx - 70, cy + 6], [cx - 128, cy - 46], [cx - 96, cy - 66], [cx - 44, cy - 22]], 252, 238, 205, 1);
  cv.poly([[cx + 66, cy - 6], [cx + 132, cy - 52], [cx + 104, cy - 76], [cx + 44, cy - 28]], 250, 234, 198, 1);
  cv.poly([[cx - 8, cy + 44], [cx - 30, cy + 96], [cx + 6, cy + 104], [cx + 30, cy + 52]], 244, 226, 188, 1);
}

// ---------------------------------------------------------------------------
// Scene: the dragon. A bezier spine arcs from the burst book (lower centre)
// up to the roaring head (upper right); wings spread wide on both sides.
// ---------------------------------------------------------------------------
function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function bezTan(p0, p1, p2, t) {
  const u = 1 - t;
  return [2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
}

const SPINE0 = [462, 806];
const SPINE1 = [560, 380];
const SPINE2 = [812, 218];

function dragonColor(t) {
  // Tail crimson -> orange -> gold -> bright cream-gold head.
  const stops = [
    [0.0, 170, 30, 28],
    [0.3, 226, 82, 26],
    [0.6, 246, 158, 30],
    [0.85, 255, 206, 88],
    [1.0, 255, 240, 200],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const lt = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [lerp(stops[i][1], stops[i + 1][1], lt), lerp(stops[i][2], stops[i + 1][2], lt), lerp(stops[i][3], stops[i + 1][3], lt)];
    }
  }
  return [255, 240, 200];
}

function drawDragonBody(cv) {
  const N = 96;
  // 1) Fire glow behind the whole body so it burns against the night.
  for (let i = 0; i <= N; i += 4) {
    const t = i / N;
    const [x, y] = bez(SPINE0, SPINE1, SPINE2, t);
    const rad = 58 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.8) + 12;
    cv.glow(x, y, rad + 52, 255, 140, 50, 0.11);
  }
  // 2) Body: overlapping discs along the spine, swelling mid-body.
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = bez(SPINE0, SPINE1, SPINE2, t);
    const rad = 56 * Math.pow(Math.sin(Math.PI * (0.10 + 0.90 * t)), 0.75) + 9;
    spine.push([x, y, rad, t]);
    const [r, g, b] = dragonColor(t);
    cv.disc(x, y, rad, r, g, b, 1, 2);
  }
  // 3) Cream belly: soft lighter band along the lower edge of the body.
  for (let i = 6; i <= N - 4; i += 1) {
    const [x, y, rad, t] = spine[i];
    const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const [r, g, b] = dragonColor(t);
    cv.disc(x + nx * rad * 0.36, y + ny * rad * 0.36, rad * 0.6, Math.min(255, r + 40), Math.min(255, g + 36), Math.min(255, b + 52), 0.16, 6);
  }
  // Dark spine ridge along the top edge.
  for (let i = 4; i <= N - 2; i += 1) {
    const [x, y, rad, t] = spine[i];
    const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    cv.disc(x - nx * rad * 0.55, y - ny * rad * 0.55, rad * 0.28, 118, 24, 24, 0.16, 5);
  }
  // 4) Back spines: a row of sharp gold-red fins along the ridge.
  for (let i = 8; i <= N - 6; i += 5) {
    const [x, y, rad, t] = spine[i];
    const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const tip = [x - nx * (rad + 26), y - ny * (rad + 26)];
    cv.poly(
      [
        [x - nx * rad * 0.5 - tx / len * 10, y - ny * rad * 0.5 - ty / len * 10],
        tip,
        [x - nx * rad * 0.5 + tx / len * 10, y - ny * rad * 0.5 + ty / len * 10],
      ],
      255, 190, 60, 0.95,
    );
  }
  // 5) Scales: rows of small dark-gold arcs following the spine.
  for (let row = 0; row < 5; row++) {
    const off = -0.6 + row * 0.3;
    for (let i = 4; i < N - 2; i += 4) {
      const [x, y, rad, t] = spine[i];
      const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, t);
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      const sx = x + nx * rad * off;
      const sy = y + ny * rad * off;
      const sr = rad * 0.2;
      for (let a = 0.15 * Math.PI; a <= 0.85 * Math.PI; a += 0.35) {
        cv.disc(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr * 0.8, 1.0, 118, 38, 18, 0.18);
      }
    }
  }
  // 6) Tail: the body narrows into the book, with two long fin ribbons
  // whipping out of the burst crater.
  const [tx0, ty0] = bez(SPINE0, SPINE1, SPINE2, 0.02);
  const tailA = [];
  const tailB = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const sway = Math.sin(t * 3.4) * 20;
    tailA.push([tx0 - 6 - t * 128, ty0 - 10 - t * 40 + sway]);
    tailB.push([tx0 - 2 - t * 140, ty0 + 26 + t * 44 + sway * 0.7]);
  }
  cv.poly([[tx0 - 8, ty0 - 30], ...tailA, [tx0 - 142, ty0 + 8], [tx0 - 8, ty0 + 36]], 232, 88, 38, 0.9);
  cv.poly([[tx0 - 4, ty0 + 28], ...tailB, [tx0 - 148, ty0 + 82], [tx0 - 4, ty0 + 42]], 255, 168, 58, 0.72);
  cv.thickLine(tx0 - 16, ty0, tx0 - 126, ty0 - 26, 2, 255, 220, 140, 0.5);
  cv.thickLine(tx0 - 16, ty0 + 18, tx0 - 134, ty0 + 62, 2, 255, 220, 140, 0.45);
  return spine;
}

function drawWing(cv, shoulder, dir, len, lift) {
  // One big membrane wing: bone struts fanning from the shoulder, membrane
  // stretched between them, trailing edge scalloped. Strut lengths vary so
  // the wing is not a perfect fan.
  const [sx, sy] = shoulder;
  const tips = [];
  const nStruts = 4;
  for (let k = 0; k <= nStruts; k++) {
    const f = k / nStruts;
    const ang = dir - 0.55 + f * 1.15;
    const L = len * (0.62 + 0.38 * Math.sin(Math.PI * Math.pow(f, 0.85)) * (0.9 + rand() * 0.2));
    const tx = sx + Math.cos(ang) * L;
    const ty = sy + Math.sin(ang) * L + lift * f;
    tips.push([tx, ty]);
    // Bone strut.
    cv.thickLine(sx, sy, tx, ty, 6 - f, 200, 140, 60, 0.95);
  }
  // Membrane: fan from shoulder through the tips, translucent fire.
  const membrane = [[sx, sy], ...tips];
  cv.poly(membrane, 238, 110, 40, 0.58);
  // Darker inner shading near the shoulder so the membrane has depth.
  for (let k = 0; k < nStruts; k++) {
    cv.poly([membrane[0], membrane[k + 1], membrane[k + 2]], 190, 55, 28, 0.22);
  }
  // Bright rim light along the leading edge.
  cv.thickLine(sx, sy, tips[0][0], tips[0][1], 5, 255, 210, 110, 0.85);
  // Claw at the wing's leading tip.
  const [tx, ty] = tips[0];
  cv.poly([[tx, ty], [tx + 22, ty - 8], [tx + 8, ty + 10]], 255, 220, 140, 0.95);
  // Scalloped trailing edge: dark rim along the tips.
  for (let k = 0; k < nStruts; k++) {
    cv.thickLine(tips[k][0], tips[k][1], tips[k + 1][0], tips[k + 1][1], 4, 150, 40, 26, 0.7);
  }
}

function drawDragonHead(cv, spine) {
  // Head at the end of the spine, roaring up-right, jaws wide open.
  const [hx, hy] = bez(SPINE0, SPINE1, SPINE2, 0.96);
  const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, 0.96);
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  const nx = -uy;
  const ny = ux;
  // Snout: a long wedge pointing up-right.
  const snoutTip = [hx + ux * 78, hy + uy * 78];
  cv.poly(
    [
      [hx - nx * 34, hy - ny * 34],
      snoutTip,
      [hx + nx * 30, hy + ny * 30],
    ],
    255, 214, 96, 1,
  );
  // Lower jaw, dropped open.
  const jawTip = [hx + ux * 66 - nx * 26, hy + uy * 66 - ny * 26];
  cv.poly(
    [
      [hx - nx * 26, hy - ny * 26],
      jawTip,
      [hx + nx * 10, hy + ny * 10],
    ],
    226, 120, 44, 1,
  );
  // Fire glowing in the open mouth.
  cv.glow(hx + ux * 44, hy + uy * 44, 34, 255, 150, 40, 0.85);
  cv.disc(hx + ux * 44, hy + uy * 44, 16, 255, 200, 90, 1, 4);
  // Fangs: white spikes, upper and lower.
  cv.poly(
    [
      [hx + ux * 52 + nx * 12, hy + uy * 52 + ny * 12],
      [hx + ux * 44 + nx * 4, hy + uy * 44 + ny * 4],
      [hx + ux * 58 + nx * 2, hy + uy * 58 + ny * 2],
    ],
    255, 250, 235, 1,
  );
  cv.poly(
    [
      [hx + ux * 40 - nx * 14, hy + uy * 40 - ny * 14],
      [hx + ux * 46 - nx * 4, hy + uy * 46 - ny * 4],
      [hx + ux * 34 - nx * 6, hy + uy * 34 - ny * 6],
    ],
    255, 250, 235, 1,
  );
  // Eye: fierce, glowing amber with a slit pupil — big and unmistakable.
  const ex = hx + ux * 8 + nx * 14;
  const ey = hy + uy * 8 + ny * 14;
  cv.glow(ex, ey, 26, 255, 160, 40, 0.6);
  cv.disc(ex, ey, 16, 255, 252, 240, 1, 2);
  cv.disc(ex + 2, ey, 9, 255, 150, 20, 1);
  cv.disc(ex + 2, ey, 4, 10, 8, 14, 1);
  cv.disc(ex + 5, ey - 3, 2.2, 255, 255, 255, 1);
  // Brow ridge over the eye.
  cv.thickLine(ex - 18, ey - 16, ex + 16, ey - 20, 7, 180, 60, 30, 0.9);
  // Horns: two long swept-back gold horns, thick at the base.
  for (const [off, bend] of [
    [0, -30],
    [10, -18],
  ]) {
    let px = hx - ux * 20 + nx * 16 + off * nx;
    let py = hy - uy * 20 + ny * 16 + off * ny;
    for (let i = 1; i <= 14; i++) {
      const t = i / 14;
      const nxx = hx - ux * 20 - t * 84 + nx * (16 + t * 26);
      const nyy = hy - uy * 20 - t * 30 + ny * (16 + t * 26) + bend * Math.sin(t * Math.PI);
      cv.thickLine(px, py, nxx, nyy, 9 - t * 6, 255, 205, 90, 0.95);
      px = nxx;
      py = nyy;
    }
  }
  // Whiskers: two long curves streaming back from the snout.
  for (const [dy, bend] of [
    [0, -34],
    [8, -20],
  ]) {
    let px = snoutTip[0] - ux * 6;
    let py = snoutTip[1] - uy * 6 + dy;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const nxx = snoutTip[0] - ux * 6 - t * 96;
      const nyy = snoutTip[1] - uy * 6 + dy + bend * Math.sin(t * Math.PI * 0.8) + t * 22;
      cv.thickLine(px, py, nxx, nyy, 2, 255, 230, 170, 0.85);
      px = nxx;
      py = nyy;
    }
  }
  // Nostril smoke.
  cv.glow(snoutTip[0] + 6, snoutTip[1] - 8, 26, 255, 140, 50, 0.4);
}

function drawDragonLegs(cv) {
  // Two forelegs gripping the torn pages at the crater: bent at the knee,
  // thick at the thigh, tapering to a clawed foot on the book.
  const leg1 = [
    [560, 560],
    [522, 640],
    [492, 716],
    [476, 782],
  ];
  for (let i = 0; i < leg1.length - 1; i++) {
    cv.thickLine(leg1[i][0], leg1[i][1], leg1[i + 1][0], leg1[i + 1][1], 36 - i * 7, 240, 150, 40, 1);
  }
  // Knee joint.
  cv.disc(522, 640, 20, 238, 148, 42, 1, 3);
  for (const [dx, dy] of [[-18, 6], [0, 12], [18, 6]]) {
    cv.poly([[476 + dx, 782 + dy], [460 + dx, 816 + dy], [492 + dx, 816 + dy]], 255, 225, 150, 1);
  }
  const leg2 = [
    [648, 470],
    [676, 556],
    [706, 640],
    [720, 730],
  ];
  for (let i = 0; i < leg2.length - 1; i++) {
    cv.thickLine(leg2[i][0], leg2[i][1], leg2[i + 1][0], leg2[i + 1][1], 32 - i * 6, 232, 130, 34, 1);
  }
  // Knee joint.
  cv.disc(676, 556, 18, 230, 128, 36, 1, 3);
  for (const [dx, dy] of [[-16, 6], [0, 12], [16, 6]]) {
    cv.poly([[720 + dx, 730 + dy], [706 + dx, 762 + dy], [736 + dx, 762 + dy]], 255, 225, 150, 1);
  }
}

// ---------------------------------------------------------------------------
// Explosion: paper shards, embers, fire.
// ---------------------------------------------------------------------------
function drawShards(cv) {
  const cx = 470;
  const cy = 800;
  // Paper shards flying out of the burst book — kept clear of the dragon's
  // head and of the lamp, so the focal points stay clean.
  for (let i = 0; i < 58; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 60 + Math.pow(rand(), 1.4) * 420;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.75 - dist * 0.12;
    if (Math.hypot(x - 800, y - 220) < 140) continue;
    if (Math.hypot(x - 850, y - 880) < 100) continue;
    const size = 5 + rand() * 15;
    const rot = rand() * Math.PI;
    const shade = 200 + rand() * 55;
    cv.rrect(x, y, size, size * (0.4 + rand() * 0.5), rot, shade, shade - 12, shade - 48, 0.92);
  }
  // Motion streaks: thin bright lines trailing the shards.
  for (let i = 0; i < 34; i++) {
    const ang = rand() * Math.PI * 2;
    const d0 = 50 + rand() * 200;
    const d1 = d0 + 40 + rand() * 90;
    const x0 = cx + Math.cos(ang) * d0;
    const y0 = cy + Math.sin(ang) * d0 * 0.75 - d0 * 0.12;
    const x1 = cx + Math.cos(ang) * d1;
    const y1 = cy + Math.sin(ang) * d1 * 0.75 - d1 * 0.12;
    cv.thickLine(x0, y0, x1, y1, 1.8, 255, 220, 170, 0.35 + rand() * 0.3);
  }
  // Loose pages tumbling through the air — kept off the right wing and head.
  for (let i = 0; i < 4; i++) {
    const x = 140 + rand() * 560;
    const y = 140 + rand() * 460;
    const rot = rand() * Math.PI;
    cv.rrect(x, y, 34 + rand() * 20, 24 + rand() * 14, rot, 246, 230, 192, 0.95);
    for (let l = 0; l < 3; l++) {
      cv.thickLine(x - 20, y - 10 + l * 10, x + 16, y - 10 + l * 10, 1.5, 130, 110, 80, 0.5);
    }
  }
}

function drawEmbers(cv) {
  // Glowing embers rising along the dragon's arc and out of the book.
  for (let i = 0; i < 150; i++) {
    const t = rand();
    const [x, y] = bez(SPINE0, SPINE1, SPINE2, t);
    const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const off = (rand() - 0.5) * 260;
    const dx = x + nx * off + (rand() - 0.5) * 60;
    const dy = y + ny * off - rand() * 120;
    const r = 0.8 + rand() * 3.4;
    const gold = rand() < 0.55;
    cv.disc(dx, dy, r, gold ? 255 : 255, gold ? 190 : 120, gold ? 80 : 40, 0.5 + rand() * 0.45, 1.4);
    if (rand() < 0.12) cv.sparkle(dx, dy, 5 + rand() * 7, 255, 210, 110, 0.85);
  }
  // A dense ember burst right out of the crater.
  for (let i = 0; i < 60; i++) {
    const a = Math.PI * (0.85 + rand() * 1.3);
    const d = 10 + rand() * 150;
    const x = 470 + Math.cos(a) * d;
    const y = 800 - Math.abs(Math.sin(a)) * d * 0.8;
    cv.disc(x, y, 1 + rand() * 3, 255, 170 + rand() * 60, 60, 0.6 + rand() * 0.4, 1.2);
  }
}

function drawFireBreath(cv) {
  // A jet of flame from the dragon's mouth, up toward the top-right corner:
  // a bright core cone with a soft outer glow, not a cloud of dots.
  const [hx, hy] = bez(SPINE0, SPINE1, SPINE2, 0.96);
  const [tx, ty] = bezTan(SPINE0, SPINE1, SPINE2, 0.96);
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  const mx = hx + ux * 78;
  const my = hy + uy * 78;
  // Outer glow along the jet.
  cv.glow(mx + ux * 45, my + uy * 45, 80, 255, 140, 40, 0.5);
  // Core: overlapping soft discs shrinking fast along the jet, tight cone.
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const wob = Math.sin(t * 7.0) * 7 * t;
    const x = mx + ux * t * 105 - uy * wob;
    const y = my + uy * t * 105 + ux * wob - t * 18;
    const r = 20 * (1 - t * 0.7);
    const hot = t < 0.4;
    cv.disc(x, y, r, 255, hot ? 220 : 150, hot ? 120 : 40, 0.55, r * 0.7);
  }
  // Bright tongue of fire at the mouth.
  cv.disc(mx + ux * 18, my + uy * 18, 16, 255, 230, 150, 0.95, 7);
  // A few sharp ember streaks inside the jet.
  for (let i = 0; i < 12; i++) {
    const t = rand();
    const x = mx + ux * t * 105 + (rand() - 0.5) * 16;
    const y = my + uy * t * 105 + (rand() - 0.5) * 16 - t * 18;
    cv.disc(x, y, 1.5 + rand() * 2.5, 255, 210, 110, 0.9, 1.5);
  }
}

// ---------------------------------------------------------------------------
// Finish: assemble, vignette, write the PNG.
// ---------------------------------------------------------------------------
function drawScene() {
  const cv = new Canvas(W, H);
  drawRoom(cv);
  drawDesk(cv);
  drawLamp(cv);
  drawDeskProps(cv);
  drawBook(cv);
  // Wings behind the body: one huge wing up-left, one sweeping right-down.
  drawWing(cv, [585, 480], -2.35, 390, -50);
  drawWing(cv, [668, 420], 0.55, 310, 30);
  const spine = drawDragonBody(cv);
  drawDragonLegs(cv);
  drawDragonHead(cv, spine);
  drawFireBreath(cv);
  drawShards(cv);
  drawEmbers(cv);
  // Vignette: darken the corners so the eye stays on the dragon.
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
