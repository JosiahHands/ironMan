// edit-media: turn raw stock photos and videos into styled, web-ready Iron Man media.
// Uses ImageMagick ("magick") for photos and ffmpeg for videos.
//
// Media folders (inside web/media/):
//   media-raw/  original downloads from fetch-media.ts (input)
//   images/     edited photos (.webp)
//   videos/     edited clips (.mp4) + poster frames (.webp) + animated copies (-anim.webp)
//   fonts/      local web fonts
//
// Example:
//   node tools/edit-media.ts photo web/media/media-raw/helmet.jpg web/media/images/helmet.webp --style hero
//
// Usage:
//   node tools/edit-media.ts photo <in> <out.webp> [--style none|hero|duotone|hud|comic|glow] [--width 1600]
//       Resize, apply a style, save as a small .webp
//
//   node tools/edit-media.ts video <in.mp4> <out-name> [--style none|hero|hud] [--start 0] [--length 6]
//                                                      [--width 1280] [--boomerang]
//       Trim, resize, color grade, remove sound -> out-name.mp4 + out-name.webp (poster frame)
//       --boomerang plays the clip forward then backward, so it loops with no jump
//
//   node tools/edit-media.ts anim <in.mp4> <out.webp> [--width 960] [--fps 15] [--quality 55]
//       Animated image copy of a finished clip. Shown when a browser refuses to autoplay the video.
//
//   node tools/edit-media.ts sheet <out.jpg> <images...>
//       Contact sheet of numbered thumbnails, for choosing between options
//
// Styles:
//   hero    - punchy cinematic grade: deep contrast, red/gold warmth, dark vignette
//   duotone - black -> armor red -> gold
//   hud     - cool cyan "heads-up display" look with scanlines
//   comic   - bold posterized colors with ink outlines
//   glow    - bright parts bloom and glow

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Site colors, shared with web/style.css
const BLACK = "#05070f";
const RED = "#d7261e";
const GOLD = "#ffc94a";
const CYAN = "#5ee7ff";

// Run a command line program and stop with a clear message if it fails
function run(program: string, args: string[]) {
  try {
    execFileSync(program, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    throw new Error(`${program} failed:\n${stderr.split("\n").slice(-8).join("\n")}`);
  }
}

// Split arguments into plain values and --options
function parseArgs(args: string[]) {
  const values: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) values.push(arg);
    else if (arg === "--boomerang") options.boomerang = "yes";
    else options[arg.slice(2)] = args[++i] ?? "";
  }
  return { values, options };
}

function sizeOf(file: string) {
  return `${(fs.statSync(file).size / 1e6).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

// ImageMagick steps for each style (applied after resizing to `width`)
function photoStyle(style: string, width: number): string[] {
  // Darken the edges: multiply by a soft white-center, black-edge oval (softness scales with size)
  const blur = Math.round(width * 0.15);
  const inset = Math.round(width * 0.05);
  const VIGNETTE = [
    "(", "+clone", "-compose", "over", "-fill", "white", "-colorize", "100",
    "-background", "black", "-vignette", `0x${blur}+-${inset}+-${inset}`, ")",
    "-compose", "multiply", "-composite",
  ];

  // A color map: dark parts become BLACK, middle tones RED, bright parts GOLD
  const redGoldMap = ["(", "-size", "128x1", `gradient:${BLACK}-${RED}`, `gradient:${RED}-${GOLD}`, "+append", ")"];
  const cyanMap = ["(", "-size", "128x1", `gradient:${BLACK}-#0b4f6c`, `gradient:#0b4f6c-${CYAN}`, "+append", ")"];

  switch (style) {
    case "none":
      return [];
    case "hero":
      return [
        "-modulate", "95,130", // a bit darker, more saturated
        "-sigmoidal-contrast", "4x55%", // more contrast without blowing out the brights
        "(", "+clone", "-fill", RED, "-colorize", "60", ")", "-compose", "soft-light", "-composite", // warm red tint
        ...VIGNETTE,
      ];
    case "duotone":
      return ["-colorspace", "gray", "-sigmoidal-contrast", "3x50%", ...redGoldMap, "-clut"];
    case "hud":
      return [
        "-colorspace", "gray", "-sigmoidal-contrast", "4x50%", ...cyanMap, "-clut",
        // thin dark scanlines every 4 pixels
        "(", "-size", "1x4", "xc:white", "-fill", "#9aa", "-draw", "point 0,3", "-write", "mpr:lines", "+delete", ")",
        "(", "+clone", "-fill", "mpr:lines", "-draw", "color 0,0 reset", ")",
        "-compose", "multiply", "-composite",
      ];
    case "comic":
      return [
        "-kuwahara", "3", // smooth out noise into flat, painted-looking areas
        "-modulate", "105,170",
        "-posterize", "5",
        // black ink outlines from the strongest edges in the picture
        "(", "+clone", "-colorspace", "gray", "-canny", "0x2+12%+35%", "-negate", "-morphology", "Erode", "Disk:1", ")",
        "-compose", "multiply", "-composite",
      ];
    case "glow":
      return [
        "-sigmoidal-contrast", "4x50%",
        // copy the brightest parts (keeping their color), blur them, and add them back on top twice
        "(", "+clone", "-level", "45%,100%", "-blur", "0x14", "-write", "mpr:glow", ")",
        "-compose", "screen", "-composite",
        "mpr:glow", "-compose", "screen", "-composite",
        ...VIGNETTE,
      ];
    default:
      throw new Error(`Unknown photo style "${style}"`);
  }
}

function editPhoto(input: string, output: string, options: Record<string, string>) {
  const width = options.width ?? "1600";
  const style = options.style ?? "none";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  run("magick", [
    input,
    "-auto-orient",
    "-resize", `${width}x${width}>`, // shrink only, never enlarge
    ...photoStyle(style, Number(width)),
    "-strip", // remove camera info
    "-quality", "82",
    output,
  ]);
  console.log(`Saved ${output} (${style}, ${sizeOf(output)})`);
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

function videoStyle(style: string): string {
  switch (style) {
    case "none":
      return "";
    case "hero":
      return ",eq=contrast=1.18:saturation=1.35:gamma=0.95,colorbalance=rs=0.12:bs=-0.12:rm=0.10:gm=0.02:bm=-0.12:rh=0.05:gh=0.03:bh=-0.10,vignette=PI/4.5";
    case "hud":
      // gray, then mixed into cyan
      return ",hue=s=0,eq=contrast=1.25,colorchannelmixer=rr=0.30:gg=0.85:bb=1.10,vignette=PI/4.5";
    default:
      throw new Error(`Unknown video style "${style}"`);
  }
}

function editVideo(input: string, outName: string, options: Record<string, string>) {
  const width = options.width ?? "1280";
  const start = options.start ?? "0";
  const length = options.length ?? "6";
  const style = options.style ?? "none";
  const mp4 = `${outName}.mp4`;
  const poster = `${outName}.webp`;
  fs.mkdirSync(path.dirname(mp4), { recursive: true });

  // even width/height are required by the h264 video format
  let filter = `[0:v]scale=${width}:-2,fps=30${videoStyle(style)}`;
  if (options.boomerang) filter += `,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1`;
  filter += "[out]";

  run("ffmpeg", [
    "-y", "-ss", start, "-t", length, "-i", input,
    "-filter_complex", filter, "-map", "[out]",
    "-an", // no sound
    "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", // lets the browser start playing before the download finishes
    mp4,
  ]);
  // Poster frame: this ffmpeg can't write .webp, so grab a .jpg and let ImageMagick convert it
  const tempJpg = `${outName}.poster.jpg`;
  run("ffmpeg", ["-y", "-i", mp4, "-frames:v", "1", "-q:v", "2", tempJpg]);
  run("magick", [tempJpg, "-quality", "80", poster]);
  fs.rmSync(tempJpg);
  console.log(`Saved ${mp4} (${style}, ${sizeOf(mp4)}) + poster ${poster}`);
}

// ---------------------------------------------------------------------------
// Contact sheet
// ---------------------------------------------------------------------------

function contactSheet(output: string, inputs: string[]) {
  const labeled = inputs.flatMap((file, i) => ["-label", `${i + 1}: ${path.basename(file)}`, file]);
  run("magick", [
    "montage", ...labeled,
    "-tile", "4x", "-geometry", "320x220+6+6",
    "-background", "#111", "-fill", "white", "-pointsize", "13",
    "-font", "/System/Library/Fonts/Supplemental/Arial.ttf", // ImageMagick has no default font on macOS
    output,
  ]);
  console.log(`Saved ${output}`);
}

// ---------------------------------------------------------------------------
// Animated image copy of a video
// Browsers can refuse to autoplay a video, but they always animate an image.
// The site shows this when a background video won't start on its own.
// ---------------------------------------------------------------------------

function animatedCopy(input: string, output: string, options: Record<string, string>) {
  const width = options.width ?? "960";
  const fps = options.fps ?? "15";
  const quality = options.quality ?? "55";
  const frameDir = fs.mkdtempSync(path.join(path.dirname(output), ".frames-"));

  try {
    // pull out the frames (smaller and fewer than the video), then join them into one looping .webp
    run("ffmpeg", ["-y", "-i", input, "-vf", `fps=${fps},scale=${width}:-2`, path.join(frameDir, "f%04d.png")]);
    const frames = fs.readdirSync(frameDir).sort().map((name) => path.join(frameDir, name));
    run("magick", ["-delay", `1x${fps}`, "-loop", "0", ...frames, "-quality", quality, "-define", "webp:method=4", output]);
  } finally {
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
  console.log(`Saved ${output} (animated, ${sizeOf(output)})`);
}

// ---------------------------------------------------------------------------

function usage(): never {
  console.log(`Usage:
  node tools/edit-media.ts photo <in> <out.webp> [--style none|hero|duotone|hud|comic|glow] [--width 1600]
  node tools/edit-media.ts video <in.mp4> <out-name> [--style none|hero|hud] [--start 0] [--length 6] [--width 1280] [--boomerang]
  node tools/edit-media.ts anim  <in.mp4> <out.webp> [--width 960] [--fps 15] [--quality 55]
  node tools/edit-media.ts sheet <out.jpg> <images...>`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const { values, options } = parseArgs(rest);

try {
  if (command === "photo" && values[0] && values[1]) editPhoto(values[0], values[1], options);
  else if (command === "video" && values[0] && values[1]) editVideo(values[0], values[1], options);
  else if (command === "anim" && values[0] && values[1]) animatedCopy(values[0], values[1], options);
  else if (command === "sheet" && values[0] && values.length > 1) contactSheet(values[0], values.slice(1));
  else usage();
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
}
