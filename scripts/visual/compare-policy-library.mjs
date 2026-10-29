// Compares a Policy Library screenshot with the approved reference (docs/design/policy-library-reference.png).
// Usage: node scripts/visual/compare-policy-library.mjs <screenshot.png> <out-dir>
// Writes side-by-side.png, overlay.png (50% blend) and diff.png (heat map), and prints a per-region difference report.
// Uses the Playwright browser already installed for the e2e tests, so it needs no image library.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [shot, out = "visual-compare"] = process.argv.slice(2);
if (!shot) throw new Error("Usage: node scripts/visual/compare-policy-library.mjs <screenshot.png> <out-dir>");
mkdirSync(out, { recursive: true });
const data = (p) => `data:image/png;base64,${readFileSync(resolve(p)).toString("base64")}`;
const REGIONS = { sidebar: [0, 0, 212, 1024], topbar: [212, 0, 1324, 56], hero: [212, 56, 1324, 132], tabsAndFilters: [230, 188, 1290, 110], explorer: [244, 298, 232, 690], register: [486, 298, 514, 690], inspector: [1010, 298, 512, 710] };

const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(async ({ ref, cur, regions }) => {
  const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  const [a, b] = await Promise.all([load(ref), load(cur)]);
  const W = 1536, H = 1024;
  const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const pixels = (img) => { const c = canvas(W, H); const x = c.getContext("2d"); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H); };
  const pa = pixels(a), pb = pixels(b);
  const side = canvas(W * 2 + 16, H); const s = side.getContext("2d"); s.fillStyle = "#fff"; s.fillRect(0, 0, side.width, H); s.drawImage(a, 0, 0, W, H); s.drawImage(b, W + 16, 0, W, H);
  const over = canvas(W, H); const o = over.getContext("2d"); o.drawImage(a, 0, 0, W, H); o.globalAlpha = 0.5; o.drawImage(b, 0, 0, W, H);
  const heat = canvas(W, H); const hx = heat.getContext("2d"); const hd = hx.createImageData(W, H);
  const diff = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = (Math.abs(pa.data[i * 4] - pb.data[i * 4]) + Math.abs(pa.data[i * 4 + 1] - pb.data[i * 4 + 1]) + Math.abs(pa.data[i * 4 + 2] - pb.data[i * 4 + 2])) / 765;
    diff[i] = d;
    const g = (pa.data[i * 4] + pa.data[i * 4 + 1] + pa.data[i * 4 + 2]) / 3;
    hd.data[i * 4] = Math.min(255, g * 0.4 + d * 600); hd.data[i * 4 + 1] = g * 0.4; hd.data[i * 4 + 2] = g * 0.4; hd.data[i * 4 + 3] = 255;
  }
  hx.putImageData(hd, 0, 0);
  const report = {};
  for (const [name, [x, y, w, h]] of Object.entries(regions)) {
    let sum = 0, n = 0;
    for (let j = y; j < Math.min(H, y + h); j++) for (let i = x; i < Math.min(W, x + w); i++) { sum += diff[j * W + i]; n++; }
    report[name] = `${((sum / n) * 100).toFixed(1)}% mean pixel difference`;
  }
  return { side: side.toDataURL(), over: over.toDataURL(), heat: heat.toDataURL(), report };
}, { ref: data("docs/design/policy-library-reference.png"), cur: data(shot), regions: REGIONS });
await browser.close();
for (const [k, f] of [["side", "side-by-side.png"], ["over", "overlay.png"], ["heat", "diff.png"]]) writeFileSync(`${out}/${f}`, Buffer.from(result[k].split(",")[1], "base64"));
console.log(JSON.stringify(result.report, null, 2));
