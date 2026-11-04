// Renders the HTML sources in this folder to PNGs in docs/assets/ with a local headless Chrome.
// Usage: node docs/assets/src/render.mjs [name ...]      (no names = render all)
// Set CHROME_PATH if Chrome is not in the default location.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.dirname(here);

const CHROME =
  process.env.CHROME_PATH ||
  {
    win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }[process.platform] ||
  "google-chrome";

const SCALE = 2; // render at 2x for crisp text; CSS widths below are half the PNG width

// w/h in CSS px. No h = fit to content (measured from the page's body height).
const SHOTS = [
  { name: "social-preview", w: 640, h: 320, opaque: true, keepColors: true }, // gradients band if quantized
  { name: "demo-search-screens", w: 680 },
  { name: "demo-app-flows", w: 680 },
  { name: "demo-flow-detail", w: 680 },
  { name: "demo-auth", w: 680 },
  { name: "demo-smoke-test", w: 680 },
];

const only = process.argv.slice(2);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mobbin-mcp-shots-"));
const base = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  `--user-data-dir=${profile}`,
];
const run = (args) => execFileSync(CHROME, [...base, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 << 20 });

try {
  for (const s of SHOTS) {
    if (only.length && !only.includes(s.name)) continue;
    const url = pathToFileURL(path.join(here, `${s.name}.html`)).href;
    let h = s.h;
    if (!h) {
      const dom = run([`--window-size=${s.w},3000`, "--dump-dom", url]);
      const m = dom.match(/data-h="(\d+)"/);
      if (!m) throw new Error(`${s.name}: page did not report its height`);
      h = Number(m[1]);
    }
    const out = path.join(outDir, `${s.name}.png`);
    run([
      `--force-device-scale-factor=${SCALE}`,
      `--window-size=${s.w},${h}`,
      ...(s.opaque ? [] : ["--default-background-color=00000000"]),
      `--screenshot=${out}`,
      url,
    ]);
    if (!s.keepColors) fs.writeFileSync(out, quantize(fs.readFileSync(out)));
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`${s.name}.png  ${s.w * SCALE}x${h * SCALE}  ${kb} KB`);
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Dependency-free PNG shrinker: RGBA PNG -> 256-colour palette PNG (median cut,
// no dithering). Terminal shots are flat colours + anti-aliased text, so this
// cuts file size by ~3x with no visible change.

function quantize(buf, maxColors = 256) {
  const { w, h, px } = decodePng(buf);
  const hist = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const k = ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const colors = [...hist].map(([k, n]) => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255, n]);
  let boxes = [colors];
  while (boxes.length < maxColors) {
    // split the box with the largest channel range, weighted by pixel count for the
    // first half of the palette only, so small accents (dots, badges) keep their colour
    let best = -1, bestScore = 0, bestCh = 0;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      let n = 0;
      for (const c of b) n += c[4];
      for (let ch = 0; ch < 4; ch++) {
        let lo = 255, hi = 0;
        for (const c of b) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch]; }
        const score = (hi - lo) * (boxes.length < maxColors / 2 ? Math.sqrt(n) : 1);
        if (score > bestScore) { bestScore = score; best = bi; bestCh = ch; }
      }
    });
    if (best < 0) break;
    const b = boxes[best].sort((x, y) => x[bestCh] - y[bestCh]);
    let total = 0, acc = 0, cut = 1;
    for (const c of b) total += c[4];
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][4]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  const pal = boxes.map((b) => {
    const s = [0, 0, 0, 0]; let n = 0;
    for (const c of b) { for (let ch = 0; ch < 4; ch++) s[ch] += c[ch] * c[4]; n += c[4]; }
    return s.map((v) => Math.round(v / n));
  });
  const index = new Map();
  for (const [k] of hist) {
    const c = [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
    let bi = 0, bd = Infinity;
    pal.forEach((p, i) => {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 + 2 * (p[3] - c[3]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    });
    index.set(k, bi);
  }
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const k = ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0;
      raw[y * (w + 1) + 1 + x] = index.get(k);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const chunks = [chunk("IHDR", ihdr), chunk("PLTE", Buffer.from(pal.flatMap((p) => p.slice(0, 3))))];
  if (pal.some((p) => p[3] < 255)) chunks.push(chunk("tRNS", Buffer.from(pal.map((p) => p[3]))));
  chunks.push(chunk("IDAT", zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk("IEND", Buffer.alloc(0)));
  const outBuf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
  return outBuf.length < buf.length ? outBuf : buf;
}

function decodePng(buf) {
  let off = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), t = buf.toString("latin1", off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (t === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9];
      if (d[8] !== 8 || (type !== 6 && type !== 2) || d[12] !== 0) throw new Error("unsupported PNG layout");
    } else if (t === "IDAT") idat.push(d);
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const data = zlib.inflateSync(Buffer.concat(idat));
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride), px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)], row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = cur[x * bpp]; px[o + 1] = cur[x * bpp + 1]; px[o + 2] = cur[x * bpp + 2]; px[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, px };
}

function crcTable() {
  return (crcTable.t ||= new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; }));
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
  const CRC = crcTable();
  let c = -1;
  for (const b of Buffer.concat([head.subarray(4), data])) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((c ^ -1) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}
