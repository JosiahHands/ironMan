// capture-game: record a game being played and turn it into preview images for the
// All Games page (an animated loop + a still), so every game's card shows real gameplay.
//
// Usage:
//   tsc -p web                                         (compile the site first)
//   node tools/capture-game.ts <game page> <name> [--start "#start-button"] [--wait 3.5] [--seconds 5] [--hide ".game-nav"]
//
// Example:
//   node tools/capture-game.ts pages/game/game.html repulsor-rush --hide ".game-nav"
//
//   -> web/media/images/games/repulsor-rush-preview.webp  (animated loop)
//      web/media/images/games/repulsor-rush.webp          (still)
//
// How it works: opens the game page from web/ in a hidden Chrome, clicks the start button,
// waits --wait seconds (e.g. for a countdown), then flies the mouse around while recording
// --seconds of play. The recording is turned into images with ImageMagick and ffmpeg.

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
    if (arg.startsWith("--")) options[arg.slice(2)] = args[++i] ?? "";
    else values.push(arg);
  }
  return { values, options };
}

async function capture(gamePage: string, name: string, options: Record<string, string>) {
  const startSelector = options.start ?? "#start-button";
  const waitSeconds = Number(options.wait ?? "3.5");
  const seconds = Number(options.seconds ?? "5");
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
    const button = await page.locator(startSelector).first().boundingBox();
    if (!button) throw new Error(`start button "${startSelector}" not found`);
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    await wait(waitSeconds * 1000);
    // where the gameplay starts in the recording (plus a moment for things to get going)
    const offset = (Date.now() - recordStart) / 1000 + 1;

    // fly around in a figure-eight so the hero dodges and blasts
    const steps = Math.round(seconds * 20) + 10;
    for (let i = 0; i < steps; i++) {
      const t = i / 20;
      await page.mouse.move(VIEW.width * (0.22 + Math.sin(t * 1.3) * 0.1), VIEW.height * (0.5 + Math.sin(t * 2.6) * 0.3));
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
