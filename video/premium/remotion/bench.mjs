import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.js"), publicDir: path.join(here, "public") });
const gls = process.argv[2].split(",");
const frames = process.argv[3].split(",").map(Number);
for (const gl of gls) {
  const opts = { browserExecutable: "/opt/pw-browsers/chromium", chromeMode: "chrome-for-testing", chromiumOptions: gl === "default" ? {} : { gl } };
  const composition = await selectComposition({ serveUrl, id: "film", ...opts });
  for (const s of frames) {
    const t = Date.now();
    await renderStill({ composition, serveUrl, output: `/tmp/bench_${gl}_${s}.png`, frame: Math.round(s * 60), ...opts });
    console.log(gl, s, ((Date.now() - t) / 1000).toFixed(2) + "s");
  }
}
