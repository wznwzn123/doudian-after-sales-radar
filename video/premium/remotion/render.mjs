// 用法：node render.mjs <输出.mp4> [预览秒数,逗号分隔 → 输出 png]
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [out = "../build/film.mp4", stills, range] = process.argv.slice(2);
const opts = { browserExecutable: process.env.BROWSER || path.join(here, "chromium-full-raster.sh"), chromeMode: "chrome-for-testing" };
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.js"), publicDir: path.join(here, "public") });
const composition = await selectComposition({ serveUrl, id: "film", ...opts });
if (stills) {
  for (const s of stills.split(",")) await renderStill({ composition, serveUrl, output: `${out}_${s}.png`, frame: Math.round(Number(s) * composition.fps), ...opts });
  console.log("stills done");
} else {
  let last = -1;
  const frameRange = range ? range.split("-").map(Number) : null;
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 12, x264Preset: "veryfast", pixelFormat: "yuv420p", muted: true, outputLocation: out, concurrency: Number(process.env.CONC || 4), frameRange, ...opts, timeoutInMilliseconds: 120000,
    onProgress: ({ progress }) => { const p = Math.floor(progress * 20); if (p !== last) { last = p; console.log(`${new Date().toISOString().slice(11, 19)} ${p * 5}%`); } } });
  console.log("wrote", out);
}
