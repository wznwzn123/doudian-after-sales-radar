// 逐帧渲染 scenes.html 里的动画场景（暂停动画→跳到时间点→截图），保证 30fps 不掉帧。
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const { spawn } = require("child_process");
const path = require("path"), fs = require("fs");
const FPS = 30;
const SCENES = { intro: 4, speed: 7, features: 7, outro: 4 };
const only = process.argv.slice(2);
(async () => {
  fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  for (const [name, dur] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue;
    await page.goto("file://" + path.join(__dirname, "scenes.html") + "?scene=" + name);
    await page.waitForLoadState("load"); await page.evaluate(() => document.fonts.ready);
    const out = path.join(__dirname, "build", "scene_" + name + ".mp4");
    const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "medium", out], { stdio: ["pipe", "inherit", "inherit"] });
    for (let i = 0; i < dur * FPS; i++) {
      await page.evaluate((t) => window.seek(t), i / FPS);
      const buf = await page.screenshot({ type: "png" });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end(); await new Promise((r) => ff.on("close", r));
    console.log("rendered", name);
  }
  await browser.close();
})();
