// check-pages: open every page in a hidden Chrome, click through the interactive parts,
// take screenshots and report any problems.
//
// Usage:
//   tsc -p web                      (compile the site first)
//   node tests/check-pages.ts
//
// Screenshots go to tests/screenshots/. The run fails (exit code 1) if it finds:
//   - JavaScript errors
//   - files that failed to load (images, videos, scripts, fonts)
//   - images that are broken, or fonts that didn't load

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openBrowser, wait, type Browser } from "../tools/chrome.ts";

const TESTS_DIR = import.meta.dirname;
const WEB_DIR = path.join(path.dirname(TESTS_DIR), "web");
const SHOTS_DIR = path.join(TESTS_DIR, "screenshots");

const DESKTOP = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };

const problems: string[] = [];
let currentStep = "";

const pageUrl = (relativePath: string) => pathToFileURL(path.join(WEB_DIR, relativePath)).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function watchForProblems(browser: Browser) {
  browser.on("Runtime.exceptionThrown", (p) => {
    const details = p.exceptionDetails;
    problems.push(`[${currentStep}] JS error: ${details.exception?.description ?? details.text}`);
  });
  browser.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") problems.push(`[${currentStep}] console.error: ${p.args.map((a: any) => a.value ?? a.description).join(" ")}`);
  });
  browser.on("Log.entryAdded", (p) => {
    if (p.entry.level === "error") problems.push(`[${currentStep}] ${p.entry.text} ${p.entry.url ?? ""}`);
  });
  browser.on("Network.loadingFailed", (p) => {
    if (p.canceled) return; // e.g. a video the browser chose to stop loading
    problems.push(`[${currentStep}] failed to load (${p.errorText}) request ${p.requestId}`);
  });
}

async function open(browser: Browser, relativePath: string, size: { width: number; height: number }) {
  currentStep = `${relativePath} @ ${size.width}px`;
  await browser.setViewport(size.width, size.height, size.width < 600);
  await browser.goTo(pageUrl(relativePath));
  await browser.waitFor(`document.readyState === "complete"`);
  await browser.evaluate(`document.fonts.ready.then(() => true)`);
  await wait(1500); // let the entrance animations play
}

async function shot(browser: Browser, name: string) {
  await browser.screenshot(path.join(SHOTS_DIR, `${name}.png`));
  console.log(`  📸 ${name}.png`);
}

async function scrollTo(browser: Browser, selector: string) {
  await browser.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ behavior: "instant", block: "start" })`
  );
  await wait(1300); // reveal animations
}

// Middle of an element on screen, for clicking it
async function centerOf(browser: Browser, selector: string): Promise<{ x: number; y: number }> {
  return browser.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
}

async function clickOn(browser: Browser, selector: string) {
  const { x, y } = await centerOf(browser, selector);
  await browser.click(x, y);
}

// Broken images, videos that can't play, fonts that didn't load
async function checkMedia(browser: Browser) {
  const report = await browser.evaluate(`(() => {
    const brokenImages = [...document.images].filter(img => img.complete && img.naturalWidth === 0).map(img => img.src);
    const brokenVideos = [...document.querySelectorAll("video")].filter(v => v.error).map(v => v.src);
    const fonts = ["900 20px Orbitron", "500 20px Rajdhani", "700 20px Rajdhani"].filter(f => !document.fonts.check(f));
    return { brokenImages, brokenVideos, fonts };
  })()`);
  for (const src of report.brokenImages) problems.push(`[${currentStep}] broken image: ${src}`);
  for (const src of report.brokenVideos) problems.push(`[${currentStep}] broken video: ${src}`);
  for (const font of report.fonts) problems.push(`[${currentStep}] font not loaded: ${font}`);
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function checkLanding(browser: Browser) {
  console.log("Landing page");
  await open(browser, "index.html", DESKTOP);
  await checkMedia(browser);
  await shot(browser, "landing-desktop");
  await browser.click(1000, 420);
  await wait(150);
  await shot(browser, "landing-click-blast");

  await open(browser, "index.html", PHONE);
  await shot(browser, "landing-phone");
}

async function checkHome(browser: Browser) {
  console.log("Home page");
  await open(browser, "pages/home/home.html", DESKTOP);
  await checkMedia(browser);
  await shot(browser, "home-1-hero");

  await scrollTo(browser, "#suits");
  const card = await centerOf(browser, ".suit-card");
  await browser.moveMouse(card.x + 60, card.y - 60);
  await clickOn(browser, ".suit-card");
  await wait(900);
  await shot(browser, "home-2-suits-scanned");

  await scrollTo(browser, "#reactor");
  for (let i = 0; i < 10; i++) {
    await clickOn(browser, "#reactor-button");
    await wait(40);
  }
  await shot(browser, "home-3-reactor-charging");
  for (let i = 0; i < 8; i++) {
    await clickOn(browser, "#reactor-button");
    await wait(40);
  }
  await wait(250);
  await shot(browser, "home-4-reactor-overload");

  await scrollTo(browser, "#powers");
  await clickOn(browser, ".flip-card:nth-child(2)");
  await wait(1000);
  await shot(browser, "home-5-powers-flipped");

  await scrollTo(browser, "#history");
  await browser.evaluate(`window.scrollBy(0, 250)`);
  await wait(800);
  await shot(browser, "home-6-history");

  await scrollTo(browser, "#lab");
  await clickOn(browser, "#random-suit");
  await wait(700);
  await shot(browser, "home-7-lab-random");

  await scrollTo(browser, "#launch");
  await shot(browser, "home-8-launch");

  await browser.evaluate(`document.querySelector(".credits").open = true`);
  await scrollTo(browser, ".site-footer");
  await shot(browser, "home-9-credits");
  await checkMedia(browser);

  await open(browser, "pages/home/home.html", PHONE);
  await shot(browser, "home-phone-hero");
  await scrollTo(browser, "#suits");
  await shot(browser, "home-phone-suits");
}

async function checkGame(browser: Browser) {
  console.log("Game page");
  await open(browser, "pages/game/game.html", DESKTOP);
  await checkMedia(browser);
  await shot(browser, "game-1-start-screen");

  await clickOn(browser, "#start-button");
  // fly around for a few seconds
  for (let i = 0; i < 60; i++) {
    await browser.moveMouse(250 + Math.sin(i / 6) * 150, 450 + Math.cos(i / 4) * 250);
    await wait(100);
  }
  await shot(browser, "game-2-playing");

  // stay still and let the drones win, to see the game over screen
  await browser.moveMouse(700, 450);
  await browser.waitFor(`document.getElementById("screen").classList.contains("is-on")`, 90);
  await wait(800);
  await shot(browser, "game-3-game-over");

  await open(browser, "pages/game/game.html", PHONE);
  await shot(browser, "game-phone-start");
}

// ---------------------------------------------------------------------------

fs.rmSync(SHOTS_DIR, { recursive: true, force: true });
const browser = await openBrowser(path.join(TESTS_DIR, ".cache", "chrome-profile"));
await Promise.all(["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"].map((m) => browser.send(m)));
watchForProblems(browser);

try {
  await checkLanding(browser);
  await checkHome(browser);
  await checkGame(browser);
} catch (error) {
  problems.push(`[${currentStep}] test crashed: ${(error as Error).message}`);
} finally {
  browser.close();
}

console.log(`\nScreenshots: ${SHOTS_DIR}`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):`);
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
console.log("\n✅ No problems found");
