// fetch-media: search and download free media from Pexels and Unsplash, no API keys needed.
//
// How it works:
//   Both sites block plain command-line requests, so searching is done with a hidden
//   (headless) Google Chrome. The actual image/video files come from the sites' file
//   servers, which allow normal downloads.
//
// Usage:
//   node tools/fetch-media.ts search <pexels|unsplash> <photos|videos> "<query>" [count]
//       Prints numbered results and saves small preview images to tools/.cache/previews/
//
//   node tools/fetch-media.ts get <pexels|unsplash> <photos|videos> <id> <name>
//       Downloads one result (from an earlier search) to web/media/media-raw/<name>.jpg|.mp4
//       and records who made it in web/media/credits.json + web/shared/credits.ts
//
// Notes:
//   - Unsplash has no free videos, so videos are Pexels only.
//   - Paid "Unsplash+" photos are skipped automatically.

import fs from "node:fs";
import path from "node:path";
import { openBrowser, USER_AGENT, type Browser } from "./chrome.ts";

const TOOLS_DIR = import.meta.dirname;
const PROJECT_DIR = path.dirname(TOOLS_DIR);
const CACHE_DIR = path.join(TOOLS_DIR, ".cache");
const RESULTS_FILE = path.join(CACHE_DIR, "search-results.json");
const RAW_DIR = path.join(PROJECT_DIR, "web", "media", "media-raw");
const CREDITS_JSON = path.join(PROJECT_DIR, "web", "media", "credits.json");
const CREDITS_TS = path.join(PROJECT_DIR, "web", "shared", "credits.ts");

type Site = "pexels" | "unsplash";
type MediaType = "photos" | "videos";

// Every search result is turned into this one simple shape
type Result = {
  site: Site;
  type: MediaType;
  id: string;
  title: string;
  author: string;
  authorUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  duration?: number;
  previewUrl: string;
  fileUrl: string;
};

type Credit = {
  name: string;
  site: string;
  type: string;
  title: string;
  author: string;
  authorUrl: string;
  pageUrl: string;
};

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

async function searchPexels(browser: Browser, type: MediaType, query: string): Promise<Result[]> {
  const kind = type === "videos" ? "videos/" : "";
  await browser.goTo(`https://www.pexels.com/search/${kind}${encodeURIComponent(query)}/`);
  await browser.waitFor(`!!document.getElementById("__NEXT_DATA__")`);
  const json = await browser.evaluate(`document.getElementById("__NEXT_DATA__").textContent`);
  const items: any[] = JSON.parse(json).props.pageProps.initialData.data;

  return items.map(({ attributes: a }) => {
    const base = {
      site: "pexels" as const,
      type,
      id: String(a.id),
      title: a.title || a.alt || a.slug,
      author: `${a.user.first_name ?? ""} ${a.user.last_name ?? ""}`.trim(),
      authorUrl: `https://www.pexels.com/@${a.user.username}`,
      width: a.width,
      height: a.height,
    };
    if (type === "videos") {
      return {
        ...base,
        pageUrl: `https://www.pexels.com/video/${a.id}/`,
        previewUrl: a.video.thumbnail.medium,
        fileUrl: pickVideoFile(a.video.video_files),
        duration: a.duration,
      };
    }
    return {
      ...base,
      pageUrl: `https://www.pexels.com/photo/${a.id}/`,
      previewUrl: a.image.medium,
      fileUrl: `https://images.pexels.com/photos/${a.id}/pexels-photo-${a.id}.jpeg?auto=compress&cs=tinysrgb&w=2400`,
    };
  });
}

// Pick the biggest mp4 that is at most 1920px on its long side (big enough, not huge)
function pickVideoFile(files: { file_type: string; width: number; height: number; link: string }[]): string {
  const mp4s = files.filter((f) => f.file_type === "video/mp4");
  const fits = mp4s.filter((f) => Math.max(f.width, f.height) <= 1920);
  const pool = fits.length ? fits : mp4s;
  pool.sort((a, b) => b.width * b.height - a.width * a.height);
  return pool[0]?.link ?? "";
}

async function searchUnsplash(browser: Browser, type: MediaType, query: string): Promise<Result[]> {
  if (type === "videos") throw new Error("Unsplash has no free videos. Use pexels for videos.");
  // Unsplash shows a "Checking your browser" page for a few seconds first.
  // Sometimes it gets stuck, so try a second time before giving up.
  const pageReady = `document.readyState === "complete" && !document.title.startsWith("Checking")`;
  try {
    await browser.goTo("https://unsplash.com/");
    await browser.waitFor(pageReady, 20);
  } catch {
    console.log("Unsplash check got stuck, trying again...");
    await browser.goTo("https://unsplash.com/");
    await browser.waitFor(pageReady, 30);
  }
  const json = await browser.evaluate(
    `fetch("/napi/search/photos?per_page=30&query=${encodeURIComponent(query)}").then(r => r.text())`
  );
  const items: any[] = JSON.parse(json).results;

  return items
    .filter((p) => !p.premium && !p.plus) // skip paid Unsplash+ photos
    .map((p) => ({
      site: "unsplash" as const,
      type,
      id: p.id,
      title: p.alt_description || p.description || p.slug || p.id,
      author: p.user.name,
      authorUrl: `https://unsplash.com/@${p.user.username}`,
      pageUrl: `https://unsplash.com/photos/${p.id}`,
      width: p.width,
      height: p.height,
      previewUrl: `${p.urls.raw}&w=600&q=70&fm=jpg`,
      fileUrl: `${p.urls.raw}&w=2400&q=85&fm=jpg`,
    }));
}

// ---------------------------------------------------------------------------
// Files: downloading, the search cache and the credits list
// ---------------------------------------------------------------------------

async function download(url: string, filePath: string) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
}

function readJson<T>(filePath: string, fallback: T): T {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Save the credit, then rebuild web/credits.ts so the website can show it
function addCredit(item: Result, name: string) {
  const credits = readJson<Credit[]>(CREDITS_JSON, []).filter((c) => c.name !== name);
  credits.push({
    name,
    site: item.site === "pexels" ? "Pexels" : "Unsplash",
    type: item.type === "videos" ? "video" : "photo",
    title: item.title,
    author: item.author,
    authorUrl: item.authorUrl,
    pageUrl: item.pageUrl,
  });
  credits.sort((a, b) => a.name.localeCompare(b.name));
  writeJson(CREDITS_JSON, credits);

  const ts =
    "// AUTO-GENERATED by tools/fetch-media.ts - do not edit by hand.\n" +
    "// Every photo and video used on the site, and who made it.\n\n" +
    "type Credit = {\n  name: string;\n  site: string;\n  type: string;\n  title: string;\n" +
    "  author: string;\n  authorUrl: string;\n  pageUrl: string;\n};\n\n" +
    `const CREDITS: Credit[] = ${JSON.stringify(credits, null, 2)};\n`;
  fs.writeFileSync(CREDITS_TS, ts);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function runSearch(site: Site, type: MediaType, query: string, count: number) {
  const browser = await openBrowser(path.join(CACHE_DIR, "chrome-profile"));
  let results: Result[];
  try {
    results = site === "pexels" ? await searchPexels(browser, type, query) : await searchUnsplash(browser, type, query);
  } finally {
    browser.close();
  }
  results = results.slice(0, count);

  // Remember results so "get" can download them later
  const cache = readJson<Record<string, Result>>(RESULTS_FILE, {});
  for (const r of results) cache[`${r.site}-${r.type}-${r.id}`] = r;
  writeJson(RESULTS_FILE, cache);

  // Download small previews so they can be looked at before choosing
  const previewDir = path.join(CACHE_DIR, "previews", slugify(`${site}-${type}-${query}`));
  fs.rmSync(previewDir, { recursive: true, force: true });
  await Promise.all(
    results.map((r, i) =>
      download(r.previewUrl, path.join(previewDir, `${String(i + 1).padStart(2, "0")}_${r.id}.jpg`)).catch(() => {})
    )
  );

  results.forEach((r, i) => {
    const length = r.duration ? ` ${r.duration}s` : "";
    console.log(`${String(i + 1).padStart(2)}. ${r.id}  ${r.width}x${r.height}${length}  ${r.author}  - ${r.title}`);
  });
  console.log(`\nPreviews: ${previewDir}`);
}

async function runGet(site: Site, type: MediaType, id: string, name: string) {
  const item = readJson<Record<string, Result>>(RESULTS_FILE, {})[`${site}-${type}-${id}`];
  if (!item) throw new Error(`No search result ${site} ${type} ${id}. Run a search first.`);

  const ext = type === "videos" ? "mp4" : "jpg";
  const filePath = path.join(RAW_DIR, `${name}.${ext}`);
  await download(item.fileUrl, filePath);
  addCredit(item, name);

  const sizeMb = (fs.statSync(filePath).size / 1e6).toFixed(1);
  console.log(`Saved ${path.relative(PROJECT_DIR, filePath)} (${sizeMb} MB) - by ${item.author} on ${item.site}`);
}

function usage(): never {
  console.log(`Usage:
  node tools/fetch-media.ts search <pexels|unsplash> <photos|videos> "<query>" [count]
  node tools/fetch-media.ts get    <pexels|unsplash> <photos|videos> <id> <name>`);
  process.exit(1);
}

const [command, site, type, ...rest] = process.argv.slice(2);
if ((site !== "pexels" && site !== "unsplash") || (type !== "photos" && type !== "videos")) usage();

try {
  if (command === "search" && rest[0]) await runSearch(site, type, rest[0], Number(rest[1] ?? 12));
  else if (command === "get" && rest[0] && rest[1]) await runGet(site, type, rest[0], slugify(rest[1]));
  else usage();
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
}
