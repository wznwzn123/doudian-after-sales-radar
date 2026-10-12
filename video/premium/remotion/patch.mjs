// 重画指定的帧范围（共用一次打包和一个浏览器）：node patch.mjs <ranges.json> <输出目录>
// ranges.json：[[起始帧, 结束帧], ...]；每段输出 <输出目录>/r_<起>_<止>.mp4
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [rangesFile, outDir] = process.argv.slice(2);
const ranges = JSON.parse(fs.readFileSync(rangesFile, "utf8"));
const browserExecutable = process.env.BROWSER || path.join(here, "chromium-cpu.sh");
const opts = { browserExecutable, chromeMode: "chrome-for-testing" };
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.js"), publicDir: path.join(here, "public") });
const puppeteerInstance = await openBrowser("chrome", opts);
const composition = await selectComposition({ serveUrl, id: "film", puppeteerInstance, ...opts });
for (const [a, b] of ranges) {
  const out = path.join(outDir, `r_${a}_${b}.mp4`);
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 12, x264Preset: "veryfast", pixelFormat: "yuv420p", muted: true, outputLocation: out, concurrency: 2, frameRange: [a, b], puppeteerInstance, ...opts, timeoutInMilliseconds: 120000 });
  console.log("done", a, b);
}
await puppeteerInstance.close({ silent: true });
