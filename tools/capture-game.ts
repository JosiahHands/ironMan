// capture-game: record a game being played and turn it into preview images for the
// All Games page (an animated loop + a still), so every game's card shows real gameplay.
//
// Usage:
//   tsc -p web                                         (compile the site first)
//   node tools/capture-game.ts <game page> <name> [options]
//
// Options:
//   --start "#start-button"   what to click to start; several clicks in order: "#a | #b | #c"
//   --wait 3.5                seconds to wait after starting (e.g. for a countdown)
//   --seconds 5               how much gameplay to record
//   --hide ".game-nav"        page parts to keep out of the preview
//   --mouse-x 0.22            where the mouse circles, across the screen (0 = left, 1 = right)
//   --fire                    hold the mouse button down while recording
//   --keys "d,w,a,s"          keys to hold, one after another, about 0.8 seconds each
//
// Examples:
//   node tools/capture-game.ts pages/game/game.html repulsor-rush --hide ".game-nav"
//   node tools/capture-game.ts pages/suitLab/suitLab.html suit-lab --start "#suit-up | [data-mode=demolition]" --wait 2 --mouse-x 0.6 --fire --keys "d,d,w,d,s"
//
//   -> web/media/images/games/<name>-preview.webp  (animated loop)
//      web/media/images/games/<name>.webp          (still)
//
// How it works: opens the game page from web/ in a hidden Chrome, clicks the start button(s),
// waits --wait seconds, then moves the mouse (and keys) around while recording --seconds of
// play. The recording is turned into images with ImageMagick and ffmpeg.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const PROJECT_DIR = path.dirname(import.meta.dirname);
const WEB_DIR = path.join(PROJECT_DIR, "web");
const OUT_DIR = path.join(WEB_DIR, "media", "images", "games");
const VIEW = { width: 1280, height: 720 };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function run(program: string, args: string[]) {
  execFileSync(program, args, { stdio: ["ignore", "ignore", "inherit"] });
}

// Split arguments into plain values and --options
function parseArgs(args: string[]) {
  const values: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) values.push(arg);
    // an option takes the next argument as its value, unless it's a flag on its own (like --fire)
    else if (args[i + 1] === undefined || args[i + 1]!.startsWith("--")) options[arg.slice(2)] = "";
    else options[arg.slice(2)] = args[++i]!;
  }
  return { values, options };
}

async function capture(gamePage: string, name: string, options: Record<string, string>) {
  const startSelectors = (options.start ?? "#start-button").split("|").map((s) => s.trim());
  const waitSeconds = Number(options.wait ?? "3.5");
  const seconds = Number(options.seconds ?? "5");
  const mouseX = Number(options["mouse-x"] ?? "0.22");
  const keys = options.keys ? options.keys.split(",").map((k) => k.trim()) : [];
  const workDir = fs.mkdtempSync(path.join(OUT_DIR, ".capture-"));

  try {
    // 1. play the game while recording the screen
    const browser = await chromium.launch({ channel: "chrome" });
    const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: workDir, size: VIEW } });
    const page = await context.newPage();
    const recordStart = Date.now(); // the recording starts with the page
    await page.goto(pathToFileURL(path.join(WEB_DIR, gamePage)).href);
    await wait(3500); // let the page's intro finish
    // hide page parts that shouldn't be in the preview (e.g. the top bar)
    if (options.hide) {
      await page.addStyleTag({ content: `${options.hide} { visibility: hidden !important; }` });
    }
    for (const selector of startSelectors) {
      await page.locator(selector).first().scrollIntoViewIfNeeded();
      const button = await page.locator(selector).first().boundingBox();
      if (!button) throw new Error(`start button "${selector}" not found`);
      await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
      await wait(800);
    }
    await wait(waitSeconds * 1000);
    // where the gameplay starts in the recording (plus a moment for things to get going)
    const offset = (Date.now() - recordStart) / 1000 + 1;

    // move the mouse in a figure-eight so the hero dodges and blasts
    if (options.fire !== undefined) await page.mouse.down();
    let heldKey = "";
    const steps = Math.round(seconds * 20) + 10;
    for (let i = 0; i < steps; i++) {
      const t = i / 20;
      await page.mouse.move(VIEW.width * (mouseX + Math.sin(t * 1.3) * 0.1), VIEW.height * (0.5 + Math.sin(t * 2.6) * 0.3));
      // hold each key in --keys for 16 steps (about 0.8 seconds), then the next one
      const key = keys.length ? keys[Math.floor(i / 16) % keys.length]! : "";
      if (key !== heldKey) {
        if (heldKey) await page.keyboard.up(heldKey);
        if (key) await page.keyboard.down(key);
        heldKey = key;
      }
      await wait(50);
    }
    const recording = await page.video()!.path();
    await context.close(); // finishes writing the recording
    await browser.close();

    // 2. animated preview: frames from the gameplay part, joined into a looping .webp
    const frames = path.join(workDir, "frames");
    fs.mkdirSync(frames);
    run("ffmpeg", ["-v", "error", "-ss", String(offset), "-t", String(seconds), "-i", recording, "-vf", "fps=12,scale=640:-2", path.join(frames, "f%04d.png")]);
    const frameFiles = fs.readdirSync(frames).sort().map((f) => path.join(frames, f));
    if (frameFiles.length < 10) throw new Error("recording too short");
    const preview = path.join(OUT_DIR, `${name}-preview.webp`);
    run("magick", ["-delay", "1x12", "-loop", "0", ...frameFiles, "-quality", "60", "-define", "webp:method=4", preview]);

    // 3. still image: a frame from the middle of the action, sharper and bigger
    const stillPng = path.join(workDir, "still.png");
    run("ffmpeg", ["-v", "error", "-ss", String(offset + seconds / 2), "-i", recording, "-frames:v", "1", stillPng]);
    const still = path.join(OUT_DIR, `${name}.webp`);
    run("magick", [stillPng, "-resize", "960x", "-quality", "80", still]);

    for (const file of [preview, still]) {
      console.log(`Saved ${path.relative(PROJECT_DIR, file)} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

const { values, options } = parseArgs(process.argv.slice(2));
if (!values[0] || !values[1]) {
  console.log(`Usage: node tools/capture-game.ts <game page> <name> [--start "#start-button"] [--wait 3.5] [--seconds 5] [--hide ".game-nav"]`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
try {
  await capture(values[0], values[1], options);
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
}
