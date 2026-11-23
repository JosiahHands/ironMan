// check-pages: test every page in real browsers, the way visitors see it.
//
//   - starts the site with "wrangler dev" (the same setup as Cloudflare, including the video Worker)
//   - runs every check in Chrome AND WebKit (Safari's engine, which DuckDuckGo on Mac uses)
//   - an extra Chrome run with autoplay blocked, like strict browsers, to prove the
//     backgrounds still move and the browser's play button never shows
//
// Usage:
//   tsc -p web                                   (compile the site first; "npm test" does both)
//   node tests/check-pages.ts                    test locally (starts wrangler dev by itself)
//   node tests/check-pages.ts https://noaharmor.com   test the live site
//
// Screenshots go to tests/screenshots/<browser>/. The run fails (exit code 1) if it finds:
//   JavaScript errors, files that failed to load, broken images/fonts, background videos that
//   don't play (or show no moving fallback), stretched/squished canvases, or videos served
//   without range-request support.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";

const TESTS_DIR = import.meta.dirname;
const PROJECT_DIR = path.dirname(TESTS_DIR);
const SHOTS_DIR = path.join(TESTS_DIR, "screenshots");
const DEV_PORT = 8790;

const DESKTOP = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };

const problems: string[] = [];
let runName = "";
let currentStep = "";
let baseUrl = process.argv[2] ?? "";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message: string) => problems.push(`[${runName}] [${currentStep}] ${message}`);
const pageUrl = (relativePath: string) => new URL(relativePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;

// ---------------------------------------------------------------------------
// Local server: wrangler dev
// ---------------------------------------------------------------------------

async function startServer(): Promise<ChildProcess> {
  const server = spawn("npx", ["wrangler", "dev", "--port", String(DEV_PORT)], { cwd: PROJECT_DIR, stdio: "ignore" });
  for (let i = 0; i < 180; i++) {
    await wait(500);
    const ok = await fetch(`http://localhost:${DEV_PORT}/`).then((r) => r.ok).catch(() => false);
    if (ok) return server;
  }
  server.kill();
  throw new Error("wrangler dev did not start");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function watchForProblems(page: Page) {
  page.on("pageerror", (error) => fail(`JS error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") fail(`console error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    // videos that get paused/stopped part-way are normal, not failures
    if (/ABORTED|cancel/i.test(reason)) return;
    fail(`failed to load ${request.url()} (${reason})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) fail(`HTTP ${response.status()} for ${response.url()}`);
  });
}

async function open(page: Page, relativePath: string, size = DESKTOP) {
  currentStep = `${relativePath} @ ${size.width}px`;
  await page.setViewportSize(size);
  await page.goto(pageUrl(relativePath), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await wait(1500); // entrance animations
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS_DIR, runName, `${name}.png`) });
  console.log(`  📸 ${runName}/${name}.png`);
}

async function scrollTo(page: Page, selector: string) {
  await page.evaluate((sel) => {
    document.documentElement.style.scrollBehavior = "auto"; // jump, don't glide
    document.querySelector(sel)!.scrollIntoView({ block: "start" });
  }, selector);
  await wait(1300); // reveal animations
}

// A real mouse click in the middle of an element (scrolled into view first if needed)
async function clickOn(page: Page, selector: string) {
  // (scrolled by hand: Playwright's own scrolling waits for the element to stop moving,
  // and many buttons on this site never stop pulsing)
  const scrolled = await page.locator(selector).first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return false;
    element.scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  });
  if (scrolled) await wait(200);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`can't click ${selector}: not on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Broken images and fonts that didn't load
async function checkMedia(page: Page) {
  const report = await page.evaluate(async () => {
    const fonts = ["900 20px Orbitron", "500 20px Rajdhani", "700 20px Rajdhani"];
    // wait for each font to finish loading (a busy browser can still be on it); a missing or
    // broken font file still fails the check afterwards
    await Promise.all(fonts.map((font) => document.fonts.load(font).catch(() => [])));
    return {
      brokenImages: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src),
      missingFonts: fonts.filter((font) => !document.fonts.check(font)),
    };
  });
  report.brokenImages.forEach((src) => fail(`broken image: ${src}`));
  report.missingFonts.forEach((font) => fail(`font not loaded: ${font}`));
}

// Every canvas's drawing grid must match its box, or drawings get stretched/squished.
// (A canvas can draw at a lower sharpness on purpose, like the 3D game on slow computers: it says
// so in data-pixel-ratio, and its grid must then match its box at that sharpness.)
async function checkCanvases(page: Page, label: string) {
  const canvases = await page.evaluate(() =>
    [...document.querySelectorAll("canvas")]
      .filter((c) => c.clientWidth > 0 && c.clientHeight > 0)
      .map((c) => ({
        name: c.id || c.className,
        gridRatio: c.width / c.height,
        boxRatio: c.clientWidth / c.clientHeight,
        gridWidth: c.width,
        expectedWidth: Math.round(c.clientWidth * (Number(c.dataset.pixelRatio) || window.devicePixelRatio || 1)),
      }))
  );
  for (const c of canvases) {
    const stretch = Math.abs(c.gridRatio / c.boxRatio - 1);
    if (stretch > 0.02 || Math.abs(c.gridWidth - c.expectedWidth) > 2) {
      fail(`${label}: canvas "${c.name}" is ${(stretch * 100).toFixed(1)}% stretched (grid ${c.gridWidth}px wide, box needs ${c.expectedWidth}px)`);
    }
  }
}

// Background videos on screen must be moving: the real video playing, or (if the browser
// blocks autoplay) the animated copy showing. The browser's play button must never show.
async function checkVideos(page: Page, label: string, mustBeRealVideo: boolean) {
  await wait(2500); // give the video (or the fallback) time to start
  const videos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLVideoElement>("video[data-bg-video]")]
      .filter((v) => {
        const box = v.getBoundingClientRect();
        return box.bottom > 0 && box.top < window.innerHeight;
      })
      .map((v) => {
        const fallback = v.previousElementSibling as HTMLElement | null;
        return {
          src: v.currentSrc.split("/").pop(),
          playing: v.classList.contains("is-playing") && !v.paused && v.currentTime > 0,
          controls: v.controls,
          videoOpacity: getComputedStyle(v).opacity,
          animatedFallback: !!fallback?.classList.contains("is-animated"),
        };
      })
  );
  if (!videos.length) fail(`${label}: expected a background video on screen`);
  for (const v of videos) {
    if (v.controls) fail(`${label}: ${v.src} shows the browser's video controls`);
    if (mustBeRealVideo && !v.playing) fail(`${label}: ${v.src} is not playing`);
    if (!v.playing && !v.animatedFallback) fail(`${label}: ${v.src} is stuck (no video and no animated fallback)`);
    if (!v.playing && v.videoOpacity !== "0") fail(`${label}: ${v.src} is not playing but still visible (would show a frozen frame)`);
  }
  return videos;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function checkRangeRequests() {
  currentStep = "range requests";
  const response = await fetch(pageUrl("media/videos/sparks.mp4"), { headers: { Range: "bytes=0-1" } });
  const body = await response.arrayBuffer();
  if (response.status !== 206 || body.byteLength !== 2 || !response.headers.get("content-range")) {
    fail(`videos must answer range requests with 206 + 2 bytes; got ${response.status}, ${body.byteLength} bytes`);
  } else {
    console.log("  ✓ videos answer range requests (206)");
  }
}

async function checkLanding(page: Page) {
  console.log(`Landing page (${runName})`);
  await open(page, "index.html");
  await checkMedia(page);
  await checkCanvases(page, "landing");
  await shot(page, "landing-desktop");
  await page.mouse.click(1000, 420);
  await wait(150);
  await shot(page, "landing-click-blast");

  await open(page, "index.html", PHONE);
  await checkCanvases(page, "landing phone");
  await shot(page, "landing-phone");
}

async function checkHome(page: Page) {
  console.log(`Home page (${runName})`);
  await open(page, "pages/home/home.html");
  await checkMedia(page);
  await checkVideos(page, "home hero", true);
  await shot(page, "home-1-hero");

  await scrollTo(page, "#suits");
  const card = await page.locator(".suit-card").first().boundingBox();
  await page.mouse.move(card!.x + card!.width / 2 + 60, card!.y + card!.height / 2 - 60);
  await clickOn(page, ".suit-card");
  await wait(900);
  await shot(page, "home-2-suits-scanned");

  await scrollTo(page, "#reactor");
  await checkVideos(page, "home reactor", true);
  for (let i = 0; i < 18; i++) {
    await clickOn(page, "#reactor-button");
    await wait(40);
  }
  await wait(250);
  await shot(page, "home-3-reactor-overload");

  await scrollTo(page, "#powers");
  await clickOn(page, ".flip-card:nth-child(2)");
  await wait(1000);
  await shot(page, "home-4-powers-flipped");

  await scrollTo(page, "#history");
  await shot(page, "home-5-history");

  await scrollTo(page, "#lab");
  await clickOn(page, "#random-suit");
  await wait(700);
  await shot(page, "home-6-lab-random");

  await scrollTo(page, "#launch");
  await checkVideos(page, "home launch", true);
  await shot(page, "home-7-launch");

  await page.evaluate(() => ((document.querySelector(".credits") as HTMLDetailsElement).open = true));
  await scrollTo(page, ".site-footer");
  await shot(page, "home-8-footer");
  await checkMedia(page);

  await open(page, "pages/home/home.html", PHONE);
  await checkVideos(page, "home phone", true);
  await shot(page, "home-phone-hero");
}

async function checkWarp(page: Page) {
  console.log(`Warp jump into the game (${runName})`);
  await open(page, "pages/home/home.html");
  const links = await page.locator("[data-game-link]").count();
  if (links !== 3) fail(`expected 3 game links on home, found ${links}`);

  await clickOn(page, ".nav-play");
  await wait(550);
  await shot(page, "warp-1-leaving");

  currentStep = "warp arriving on game page";
  await page.waitForURL(/game/, { timeout: 15000 });
  await page.waitForLoadState("load");
  await wait(250);
  await shot(page, "warp-2-arriving");
  await wait(2200);
  await shot(page, "warp-3-hud-booted");
  await checkMedia(page);
}

async function checkGamesPage(page: Page) {
  console.log(`All Games page (${runName})`);

  // the nav buttons on landing and home lead here
  await open(page, "index.html");
  await clickOn(page, ".topbar-games");
  await page.waitForURL(/games/, { timeout: 15000 });
  await open(page, "pages/home/home.html");
  await clickOn(page, ".nav-games");
  await page.waitForURL(/games/, { timeout: 15000 });

  await open(page, "pages/games/games.html");
  await wait(2500); // cards fly in, moving preview loads
  await checkMedia(page);
  // GAMES is the page's list of games (shared/games.ts); read as text since it isn't on window
  const listed = (await page.evaluate("GAMES.length")) as number;
  const cards = await page.evaluate(() => ({
    shown: document.querySelectorAll(".game-card").length,
    previews: [...document.querySelectorAll<HTMLImageElement>(".game-card img")].map((img) => img.src.split("/").pop()),
  }));
  if (cards.shown !== listed) fail(`expected ${listed} game card(s), found ${cards.shown}`);
  cards.previews.forEach((src) => {
    if (!src?.endsWith("-preview.webp")) fail(`card is not showing its moving preview (showing ${src})`);
  });
  await shot(page, "games-1-page");

  const card = await page.locator(".game-card").first().boundingBox();
  await page.mouse.move(card!.x + card!.width * 0.7, card!.y + card!.height * 0.3);
  await wait(500);
  await shot(page, "games-2-card-hover");

  // clicking a card warps into the game
  await clickOn(page, ".game-card");
  await wait(550);
  await shot(page, "games-3-warp");
  currentStep = "games page card -> game";
  await page.waitForURL(/pages\/game\/game/, { timeout: 15000 });

  await open(page, "pages/games/games.html", PHONE);
  await wait(1500);
  await shot(page, "games-phone");
}

async function checkGame(page: Page) {
  console.log(`Game page (${runName})`);
  await open(page, "pages/game/game.html");
  await wait(1500); // HUD boot-up after the warp
  await checkMedia(page);
  await checkVideos(page, "game sky", true);
  await checkCanvases(page, "game start screen");
  await shot(page, "game-1-start-screen");

  // the first Start mission gets a countdown
  await clickOn(page, "#start-button");
  await wait(1000);
  if (!(await page.locator("#countdown.is-on").count())) fail("countdown did not show after Start mission");
  await shot(page, "game-2-countdown");
  await wait(2600);

  // fly around
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(250 + Math.sin(i / 6) * 150, 450 + Math.cos(i / 4) * 250);
    await wait(100);
  }
  await shot(page, "game-3-playing");

  // THE SQUISH BUG: the play area changes size without the window resizing
  // (like a browser toolbar sliding away). The canvas must follow it.
  currentStep = "game canvas follows play area";
  await page.evaluate(() => (document.getElementById("stage")!.style.height = "520px"));
  await wait(300);
  await checkCanvases(page, "play area shrunk without a window resize");
  await shot(page, "game-4-play-area-shrunk");
  await page.evaluate(() => (document.getElementById("stage")!.style.height = ""));
  await wait(300);
  await checkCanvases(page, "play area restored");

  // ...and when the window itself changes size mid-game
  await page.setViewportSize({ width: 1100, height: 640 });
  await wait(400);
  await checkCanvases(page, "window resized mid-game");
  await shot(page, "game-5-window-resized");
  await page.setViewportSize(DESKTOP);
  await wait(400);
  await checkCanvases(page, "window restored mid-game");

  // let the drones win, to see the game over screen
  currentStep = "game over";
  await page.mouse.move(700, 450);
  await page.waitForSelector("#screen.is-on", { timeout: 90000 });
  await wait(800);
  await shot(page, "game-6-game-over");

  // Play again starts straight away, with no countdown
  await clickOn(page, "#start-button");
  await wait(300);
  const replay = await page.evaluate(() => ({
    countdown: document.getElementById("countdown")!.classList.contains("is-on"),
    playing: document.body.classList.contains("is-playing"),
  }));
  if (replay.countdown || !replay.playing) fail(`Play again should start right away (countdown: ${replay.countdown}, playing: ${replay.playing})`);

  await open(page, "pages/game/game.html", PHONE);
  await wait(1500);
  await checkCanvases(page, "game phone");
  await shot(page, "game-phone-start");
}

async function checkSuitLab(page: Page) {
  console.log(`Suit Lab (${runName})`);
  await open(page, "pages/suitLab/suitLab.html");
  await wait(1500); // the garage slides in after the warp
  await checkMedia(page);
  await checkCanvases(page, "suit lab garage");
  await shot(page, "lab-1-garage");

  // picking parts changes the stat bars
  const speedBar = () => page.evaluate(() => document.getElementById("stat-speed")!.style.width);
  const speedBefore = await speedBar();
  await clickOn(page, '[data-part="plating"] [data-value="heavy"]');
  await clickOn(page, '[data-part="weapon"] [data-value="missiles"]');
  await clickOn(page, '[data-part="armor"] [data-value="#1f5fd1"]');
  await wait(600);
  if ((await speedBar()) === speedBefore) fail("picking heavy plating did not change the speed bar");
  await scrollTo(page, "#garage");
  await shot(page, "lab-2-garage-picked");

  // suit up, pick Demolition, then fly right while firing
  await clickOn(page, "#suit-up");
  await wait(700);
  await shot(page, "lab-3-modes");
  currentStep = "suit lab demolition";
  await clickOn(page, '[data-mode="demolition"]');
  await wait(800);
  await checkCanvases(page, "suit lab city");
  await page.mouse.move(900, 600);
  await page.mouse.down();
  await page.keyboard.down("d");
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(850 + Math.sin(i / 5) * 200, 600 + Math.cos(i / 4) * 150);
    await wait(70);
  }
  await page.keyboard.up("d");
  await page.mouse.up();
  const score = Number((await page.textContent("#hud-score"))!.replace(/\D/g, ""));
  if (!(score > 0)) fail("flying and firing in Demolition scored nothing");
  await shot(page, "lab-4-demolition");

  // the play area changes size without the window resizing: the city must not stretch
  await page.evaluate(() => (document.getElementById("stage")!.style.height = "520px"));
  await wait(300);
  await checkCanvases(page, "suit lab play area shrunk");
  await page.evaluate(() => (document.getElementById("stage")!.style.height = ""));
  await wait(300);

  // Drone Defense: the first wave arrives by itself
  currentStep = "suit lab drone defense";
  await clickOn(page, "#hud-modes");
  await wait(500);
  await clickOn(page, '[data-mode="defense"]');
  await wait(3500);
  const wave = await page.textContent("#hud-timer");
  if (wave !== "1") fail(`Drone Defense should be on wave 1, but shows "${wave}"`);
  await shot(page, "lab-5-defense");

  // the suit is remembered next time
  currentStep = "suit lab remembers the suit";
  await clickOn(page, "#hud-garage");
  await open(page, "pages/suitLab/suitLab.html");
  const plating = await page.locator('[data-part="plating"] .is-picked').getAttribute("data-value");
  if (plating !== "heavy") fail(`the saved suit was not remembered (plating: ${plating})`);

  await open(page, "pages/suitLab/suitLab.html", PHONE);
  await wait(1500);
  await checkCanvases(page, "suit lab phone garage");
  await shot(page, "lab-phone-garage");
  await clickOn(page, "#suit-up");
  await wait(600);
  await clickOn(page, '[data-mode="free"]');
  await wait(1000);
  await checkCanvases(page, "suit lab phone city");
  await shot(page, "lab-phone-free");
}

async function checkIron3d(page: Page) {
  console.log(`Iron Strike 3D (${runName})`);
  const phase = () => page.evaluate(() => document.body.dataset.phase);
  const inHelmet = () => page.evaluate(() => document.body.classList.contains("in-helmet"));
  await open(page, "pages/iron3d/iron3d.html");
  await wait(1500); // the menu flies in after the warp
  await checkMedia(page);
  if ((await phase()) === "no-3d") {
    fail("Iron Strike 3D: the browser says it can't draw 3D (no WebGL)");
    return;
  }
  await checkCanvases(page, "iron3d start screen");
  await shot(page, "iron3d-1-start");

  // Launch: 3-2-1-GO, then the camera flies into the helmet
  await clickOn(page, "#start-button");
  await wait(1000);
  if (!(await page.locator("#countdown.is-on").count())) fail("countdown did not show after Launch");
  await shot(page, "iron3d-2-countdown");
  await wait(3600);
  if ((await phase()) !== "playing") fail(`expected to be flying after the countdown, but the phase is "${await phase()}"`);
  if (!(await inHelmet())) fail("the camera did not move into the helmet after takeoff");
  await shot(page, "iron3d-3-helmet-view");

  // fly and fire at the first wave (aim assist pulls the shots onto drones near the aim)
  currentStep = "iron3d first wave";
  await page.mouse.move(683, 430);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) {
    await page.mouse.move(683 + Math.sin(i / 8) * 90, 430 + Math.cos(i / 6) * 50);
    await wait(100);
  }
  await page.mouse.up();
  const score = Number((await page.textContent("#hud-score"))!.replace(/\D/g, ""));
  if (!(score > 0)) fail("flying and firing at the first wave scored nothing");
  await shot(page, "iron3d-4-fight");

  // V switches to the chase camera and back
  currentStep = "iron3d camera views";
  await page.keyboard.press("v");
  await wait(500);
  if (await inHelmet()) fail("V did not switch to the chase camera");
  await shot(page, "iron3d-5-chase-view");
  await page.keyboard.press("v");
  await wait(500);
  if (!(await inHelmet())) fail("V did not switch back to the helmet view");

  // the play area changes size without the window resizing: the 3D view must not stretch
  currentStep = "iron3d canvas follows play area";
  await page.evaluate(() => (document.getElementById("stage")!.style.height = "520px"));
  await wait(400);
  await checkCanvases(page, "iron3d play area shrunk without a window resize");
  await page.evaluate(() => (document.getElementById("stage")!.style.height = ""));
  await page.setViewportSize({ width: 1100, height: 640 });
  await wait(400);
  await checkCanvases(page, "iron3d window resized mid-game");
  await page.setViewportSize(DESKTOP);
  await wait(400);

  // pause, then quit back to the menu
  currentStep = "iron3d pause and quit";
  await page.keyboard.press("p");
  await wait(400);
  if ((await phase()) !== "paused") fail("P did not pause the game");
  await shot(page, "iron3d-6-paused");
  await clickOn(page, "#quit-button");
  await wait(800);
  if ((await phase()) !== "start") fail("Quit mission did not go back to the start screen");

  await open(page, "pages/iron3d/iron3d.html", PHONE);
  await wait(1500);
  await checkCanvases(page, "iron3d phone start");
  await shot(page, "iron3d-phone-start");
  await clickOn(page, "#start-button");
  await wait(6000);
  await checkCanvases(page, "iron3d phone flying");
  await shot(page, "iron3d-phone-flying");
}

// Strict-autoplay browser: videos may not start, but something must always move,
// and once you click anywhere the real videos must start.
async function checkBlockedAutoplay(page: Page) {
  console.log(`Autoplay blocked (${runName})`);
  await open(page, "pages/home/home.html");
  const before = await checkVideos(page, "home hero, autoplay blocked", false);
  if (before.some((v) => v.playing)) fail("expected autoplay to be blocked in this run (test setup problem)");
  await shot(page, "blocked-1-hero-before-click");

  await page.mouse.click(40, 600); // any click
  await wait(500);
  await checkVideos(page, "home hero, after a click", true);
  await shot(page, "blocked-2-hero-after-click");

  await open(page, "pages/game/game.html");
  await checkVideos(page, "game sky, autoplay blocked", false);
  await shot(page, "blocked-3-game");
}

// ---------------------------------------------------------------------------

fs.rmSync(SHOTS_DIR, { recursive: true, force: true });

let server: ChildProcess | null = null;
if (!baseUrl) {
  console.log("Starting wrangler dev...");
  server = await startServer();
  baseUrl = `http://localhost:${DEV_PORT}`;
}
console.log(`Testing ${baseUrl}\n`);

// Makes the page behave like DuckDuckGo with autoplay blocked: every video refuses to play
// until the visitor clicks, taps or presses a key (Chrome's own flags still allow muted autoplay).
function blockAutoplayUntilClick() {
  // unlocked only by a real click/tap/key (the test tool's own page checks don't count)
  let unlocked = false;
  const unlock = (event: Event) => {
    if (event.isTrusted) unlocked = true;
  };
  for (const name of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(name, unlock, true);

  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!unlocked) return Promise.reject(new DOMException("play() blocked until the user interacts", "NotAllowedError"));
    return realPlay.call(this);
  };
  // the autoplay attribute would start videos by itself, so remove it as soon as the page is built
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("video").forEach((video) => {
      video.removeAttribute("autoplay");
      video.autoplay = false;
      video.pause();
    });
  });
}

type Run = {
  name: string;
  launch: () => Promise<Browser>;
  checks: ((page: Page) => Promise<void>)[];
  blockAutoplay?: boolean;
};

const runs: Run[] = [
  { name: "chrome", launch: () => chromium.launch({ channel: "chrome" }), checks: [checkLanding, checkHome, checkWarp, checkGamesPage, checkGame, checkSuitLab, checkIron3d] },
  { name: "webkit", launch: () => webkit.launch(), checks: [checkLanding, checkHome, checkWarp, checkGamesPage, checkGame, checkSuitLab, checkIron3d] },
  { name: "autoplay-blocked", launch: () => chromium.launch({ channel: "chrome" }), checks: [checkBlockedAutoplay], blockAutoplay: true },
];

try {
  runName = "server";
  await checkRangeRequests();

  for (const run of runs) {
    runName = run.name;
    const browser = await run.launch();
    const page = await browser.newPage({ viewport: DESKTOP });
    if (run.blockAutoplay) await page.addInitScript(blockAutoplayUntilClick);
    watchForProblems(page);
    for (const check of run.checks) {
      try {
        await check(page);
      } catch (error) {
        fail(`test crashed: ${(error as Error).message.split("\n")[0]}`);
      }
    }
    await browser.close();
  }
} finally {
  server?.kill();
}

console.log(`\nScreenshots: ${SHOTS_DIR}`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):`);
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
console.log("\n✅ No problems found");
