// 单独重画指定帧：node stills.mjs <输出路径模板，含 {n}> <帧号,帧号,...>
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [pattern, list] = process.argv.slice(2);
const opts = { browserExecutable: process.env.BROWSER || path.join(here, "chromium-full-raster.sh"), chromeMode: "chrome-for-testing" };
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.js"), publicDir: path.join(here, "public") });
const puppeteerInstance = await openBrowser("chrome", { browserExecutable: opts.browserExecutable, chromeMode: opts.chromeMode });
const composition = await selectComposition({ serveUrl, id: "film", puppeteerInstance, ...opts });
for (const n of list.split(",").map(Number)) {
  await renderStill({ composition, serveUrl, output: pattern.replace("{n}", n), frame: n, puppeteerInstance, ...opts });
}
await puppeteerInstance.close({ silent: true });
console.log("stills", list.split(",").length);
