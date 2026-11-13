/**
 * Renders the profile banner with the portfolio's original WebGL material.
 * Usage: node scripts/build-banner.mjs <portfolio> <playwright-module> <chromium>
 * Requires FFmpeg on PATH and the portfolio's npm dependencies installed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const [portfolio, playwright, executablePath] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(playwright);
const read = (path) => readFileSync(resolve(portfolio, path), "utf8");
const assets = resolve(import.meta.dirname, "../assets");

const tokens = read("src/styles/tokens.css");
const font = readFileSync(resolve(portfolio, "public/assets/fonts/Mona-Sans.woff2")).toString("base64");
const geometry = read("src/components/hero/stackGeometry.js")
  .replace("w: 400, h: 460, cx: 150, cy: 230", "w: 350, h: 350, cx: 175, cy: 208")
  .replace("export const PX = 60", "export const PX = 53");
const material = read("src/components/hero/stackScene.js")
  .replace('from "ogl"', 'from "/ogl/src/index.js"')
  .replace('from "./stackGeometry"', 'from "/geometry.js"')
  .replace('from "@/lib/breakpoints"', 'from "/breakpoints.js"')
  // Expose deterministic poses for capture, using the existing scene and shading.
  .replace("function place(time) {", "function place(time, pose) {")
  .replace("stack.rotation.y = coreStack.rotation.y = now.ry;", "stack.rotation.y = coreStack.rotation.y = pose?.turn ?? now.ry;")
  .replace("const y = slabY(i, count, now.gap) + lift[i] + rise;",
    "const y = slabY(i, count, pose?.gap ?? now.gap) + lift[i] + rise + (pose?.height[i] ?? 0);\n" +
    "      s.core.position.x = s.back.position.x = s.front.position.x = pose?.offset[i] ?? 0;")
  .replace("glow[i] + wave * 0.9", "glow[i] + wave * 0.9 + (pose?.pulse[i] ?? 0)")
  .replace("return { pick, setHover, playDrop, dispose };", "return { pose: (value) => place(performance.now(), value), dispose };");

const html = [
  '<!doctype html><html lang="es"><meta charset="utf-8"><style>',
  tokens,
  '@font-face { font-family: Mona; src: url(data:font/woff2;base64,' + font + '); font-weight: 200 900; font-stretch: 75% 125%; }',
  'body { margin: 0; font-family: Mona, sans-serif; }',
  '#banner { position: relative; width: 1120px; height: 352px; overflow: hidden; isolation: isolate;',
  '  background: var(--background); border-radius: 18px; color: var(--foreground); }',
  '#banner::before { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none;',
  '  border-radius: inherit; box-shadow: inset 0 0 0 1px var(--border-strong), inset 0 1px 0 var(--edge-light); }',
  '#light { position: absolute; inset: 0; background:',
  '  radial-gradient(ellipse 390px 265px at 78% 34%, var(--stage-glow), transparent 76%),',
  '  var(--surface-grad); }',
  '#light::after { content: ""; position: absolute; inset: 0 0 0 58%;',
  '  background: radial-gradient(ellipse 164px 127px at var(--light-x, 55%) 56%, var(--stage-warm), transparent 79%); }',
  '[data-theme="dark"] { --stage-glow: #3b4e65; --stage-warm: #74513956; --shadow: #070a12b0; }',
  '[data-theme="light"] { --stage-glow: #d4dfe9; --stage-warm: #d2a26560; --shadow: #52677740; }',
  '#shadow { position: absolute; left: 710px; top: 296px; width: 318px; height: 46px;',
  '  background: radial-gradient(ellipse, var(--shadow) 0%, transparent 69%); }',
  '#glass { position: absolute; left: 690px; top: 0; width: 350px; height: 350px; transform: scaleX(1.14); }',
  '#copy { position: absolute; inset: 55px auto auto 56px; }',
  '#copy::before { content: ""; display: block; width: 36px; height: 2px; background: var(--accent); margin-bottom: 25px; }',
  'h1 { margin: 0; font-size: 65px; font-weight: 760; font-stretch: 113%; letter-spacing: -0.052em; line-height: 0.98; }',
  'p { margin: 25px 0 0; font-size: 29px; font-weight: 530; color: var(--muted); letter-spacing: -0.025em; }',
  '</style><body><main id="banner"><div id="light"></div><div id="shadow"></div>',
  '<div id="copy"><h1>Daylé García<br>Fernández</h1><p>Backend Developer · Java &amp; Spring Boot</p></div>',
  '<div id="glass"><canvas></canvas></div></main><script type="module">',
  'import { mountStack } from "/scene.js";',
  'const wrap = document.querySelector("#glass");',
  'const scene = mountStack({ wrap, canvas: wrap.querySelector("canvas"), labels: [], accentIndex: 1, count: 4, drop: {mode:"skip"} });',
  'if (!scene?.pose) throw new Error("The original WebGL renderer could not start");',
  'window.paint = async (theme, pose) => {',
  '  document.documentElement.dataset.theme = theme;',
  '  document.documentElement.style.setProperty("--light-x", pose.light + "%");',
  '  await document.fonts.ready;',
  '  await new Promise(requestAnimationFrame);',
  '  scene.pose(pose);',
  '};',
  '</script>',
].join("\n");

const ease = (t) => t * t * (3 - 2 * t);
const unit = (v) => Math.max(0, Math.min(1, v));

function pose(time) {
  const spread = ease(unit(time / 0.85));
  const flight = [1.15, 1.42, 1.69, 1.96].reverse();
  const height = flight.map((start, i) => {
    const fall = ease(unit((time - start) / 0.65));
    return (1 - fall) * spread * (1.72 - 0.42 * i);
  });
  const arrival = (time - 2.65) / 0.86 * 4;
  return {
    height,
    offset: height.map((y, i) => y * (i % 2 ? -0.23 : 0.20)),
    pulse: height.map((_, i) => time >= 2.65 ? 0.9 * Math.exp(-((arrival - i) ** 2) / 0.36) : 0),
    gap: 0.94,
    turn: -0.12 + Math.sin(time / 4.25 * Math.PI * 2) * 0.22,
    light: 55 + 15 * Math.sin(time / 4.25 * Math.PI * 2),
  };
}

const launch = { executablePath, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] };
const preview = process.env.BANNER_PREVIEW;
const frames = mkdtempSync(join(tmpdir(), "dageus-banner-"));
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 352 } });
  await page.route("http://banner.test/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const data = {
      "/": [html, "text/html; charset=utf-8"],
      "/geometry.js": [geometry, "text/javascript"],
      "/scene.js": [material, "text/javascript"],
      "/breakpoints.js": [read("src/lib/breakpoints.js"), "text/javascript"],
    };
    const [body, contentType] = data[pathname] ?? [read("node_modules" + pathname), "text/javascript"];
    return route.fulfill({ body, contentType });
  });
  page.on("pageerror", console.error);
  await page.goto("http://banner.test/");
  await page.waitForFunction(() => typeof window.paint === "function");
  const clip = { x: 0, y: 0, width: 1120, height: 352 };
  for (const theme of ["dark", "light"]) {
    await page.evaluate(([theme, pose]) => window.paint(theme, pose), [theme, pose(0)]);
    await page.screenshot({ path: resolve(preview || assets, "glass-" + theme + ".png"), clip });
    if (preview) {
      await page.evaluate(([theme, pose]) => window.paint(theme, pose), [theme, pose(1.33)]);
      await page.screenshot({ path: resolve(preview, "glass-raised-" + theme + ".png"), clip });
      continue;
    }
    for (let i = 0; i < 68; i++) {
      await page.evaluate(([theme, pose]) => window.paint(theme, pose), [theme, pose(i / 16)]);
      await page.screenshot({ path: join(frames, String(i).padStart(3, "0") + ".png"), clip });
    }
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-framerate", "16", "-i", join(frames, "%03d.png"),
      "-filter_complex", "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
      "-loop", "0", resolve(assets, "glass-" + theme + ".gif"),
    ]);
  }
} finally {
  await browser.close();
  rmSync(frames, { recursive: true, force: true });
}
