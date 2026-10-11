// 用法：node render.mjs <long|short> <subs:1|0> <输出.mp4> [单帧秒数，用于预览截图]
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [version = "long", subs = "1", out = `../build/${version}.mp4`, still] = process.argv.slice(2);
const browserExecutable = "/opt/pw-browsers/chromium";
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.js"), publicDir: path.join(here, "public") });
const inputProps = { version, subs: subs === "1" };
const composition = await selectComposition({ serveUrl, id: version, inputProps, browserExecutable, chromeMode: "chrome-for-testing" });
if (still !== undefined) {
  for (const s of still.split(",")) {
    const file = out.replace(/\.png$/, "") + "_" + s + ".png";
    await renderStill({ composition, serveUrl, output: file, frame: Math.round(Number(s) * composition.fps), inputProps, browserExecutable, chromeMode: "chrome-for-testing" });
  }
  console.log("stills done");
} else {
  let last = -1;
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 16, x264Preset: "slow", pixelFormat: "yuv420p", muted: true, outputLocation: out, inputProps, browserExecutable, chromeMode: "chrome-for-testing", concurrency: 4,
    onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`${version}: ${p * 10}%`); } } });
  console.log("wrote", out);
}
