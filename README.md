# Noah's Armory

An Iron Man fan site built for Noah, with something moving or reacting on every part of every page:

| Page | File | What's there |
| --- | --- | --- |
| Landing | `web/index.html` | Spinning network globe, glowing "Enter the Armory" button, count-up stats |
| Home | `web/pages/home/home.html` | Suit cards, arc reactor to charge, flip cards, history timeline, helmet designer, rocket launch |
| All Games | `web/pages/games/games.html` | A card for every game, with a moving gameplay preview and your best score |
| Game | `web/pages/game/game.html` | **Repulsor Rush**: fly above the clouds and blast drones |
| Game | `web/pages/suitLab/suitLab.html` | **Suit Lab**: build your own suit, then fly it through a city and smash it (Free Fly, Demolition, Drone Defense) |

Every page also has a targeting cursor, a repulsor blast wherever you click, and an expandable photo/video credits list in the footer.

## Running the site

Install the build tools once (TypeScript and Cloudflare's Wrangler):

```sh
npm install
```

The site is written in TypeScript, so compile it before opening it:

```sh
npm run build        # same as: tsc -p web
```

Then open `web/index.html` in a browser. You don't need a server: double-clicking the file works. Every image, video and font is stored in the project, so the site doesn't need the internet.

To recompile automatically while you edit, run `npx tsc -p web --watch`. To preview the site exactly as Cloudflare will serve it, run `npm run dev` and open the address it prints.

## Deploying to Cloudflare

```sh
npx wrangler login   # first time only
npx wrangler deploy  # or: npm run deploy
```

Wrangler reads `wrangler.jsonc`, which does three things:
- Runs `npm run build` first, so the compiled JavaScript is always up to date.
- Uploads everything in `web/` as a static site, except what `web/.assetsignore` lists: the raw downloads in `media/media-raw/` (one is over Cloudflare's 25 MiB per-file limit), the TypeScript source and the config files.
- Runs a tiny Worker (`worker/index.ts`) for `/media/videos/*` only. Safari's engine (Safari, and DuckDuckGo on Mac) asks for videos in pieces ("range requests") and won't play them otherwise. Cloudflare's static file serving doesn't answer those, so the Worker does.

Cloudflare serves pages without `.html` (for example `/pages/home/home`). Links ending in `.html` still work because they redirect.

## Project layout

```
web/
  index.html, style.css, script.ts   landing page
  pages/home/                        home page (.html, .css, .ts)
  pages/game/                        game page: Repulsor Rush (.html, .css, .ts)
  pages/suitLab/                     game page: Suit Lab (suit.ts = the suit, flight.ts = the
                                     flying game, suitLab.ts = the garage)
  pages/games/                       All Games page: one card per game
  shared/
    games.ts                         the list of games shown on the All Games page
    shared.css                       colors, fonts, buttons, cursor, footer
    shared.ts                        cursor, click blasts, scroll effects, credits list,
                                     forced video playback, canvas sizing, real screen height
    credits.ts                       auto-generated list of media credits
  media/
    media-raw/                       original downloads (not used by the pages)
    images/                          edited photos (.webp)
    images/games/                    game previews for the All Games page (from capture-game.ts)
    videos/                          edited clips (.mp4), poster frames (.webp),
                                     animated copies (-anim.webp) for browsers that block video
    fonts/                           Orbitron + Rajdhani
    credits.json                     who made each photo/video
  dist/                              compiled JavaScript (made by tsc)
  .assetsignore                      files in web/ that are NOT uploaded to Cloudflare
worker/                              Cloudflare Worker that serves videos in pieces (range requests)
tools/                               command-line helpers for media
tests/                               automated page checks (Chrome + WebKit)
wrangler.jsonc                       Cloudflare deploy settings
package.json                         build / dev / deploy / test commands
```

Each page loads `shared/credits.js`, then `shared/shared.js`, then its own script, all from `dist/`.

### Rule: never trust the browser
Browsers differ, and many quietly refuse things (autoplay, resize events, newer CSS). So the site forces what matters and checks it:
- **Background videos** (`<video data-bg-video data-anim="...">`): they're started in code, retried on any click, tap or key and when you return to the tab, and paused when off screen. The browser's play button is never shown. If a browser refuses to play, an animated-image copy shows instead, because browsers always animate images.
- **Canvases** use `keepCanvasSized()`, which watches the canvas's own box (not just the window) and re-checks every frame, so drawings never stretch or squish.
- **Screen height** comes from `--vh`, measured in JavaScript, instead of `100vh`, which varies between browsers.
- **Fonts** are preloaded and never shown in a fallback font. Safari prefixes are included, and the code avoids drawing features older Safari lacks.

## Adding a new game

The original game (Repulsor Rush, `pages/game/`) stays as it is. Each new game gets its own folder, and a card on the All Games page. The warp-in overlay and its styles are shared (see `suitLab.html` for the markup to copy):

1. Build it in `web/pages/<game-name>/` (`<game-name>.html`, `.css`, `.ts`), using the same head, scripts and footer as the other pages.
2. Compile (`npm run build`), then record its preview from real gameplay:
   ```sh
   node tools/capture-game.ts pages/<game-name>/<game-name>.html <game-name> --start "#start-button" --hide ".game-nav"
   ```
   This plays the game in a hidden Chrome and saves an animated preview and a still image to `web/media/images/games/`. Options: `--start` (what to click; several clicks in order with `"#a | #b"`), `--wait` (seconds before recording, e.g. for a countdown), `--seconds` (how much to record), `--hide` (page parts to keep out of the preview), `--mouse-x` (where the mouse circles), `--fire` (hold the mouse button) and `--keys` (keys to hold in turn). Suit Lab's preview was made with:
   ```sh
   node tools/capture-game.ts pages/suitLab/suitLab.html suit-lab --start '[data-part=weapon] [data-value=missiles] | #suit-up | [data-mode=demolition]' --wait 2.5 --seconds 6 --mouse-x 0.66 --fire --keys "d" --hide ".controls-hint"
   ```
3. Add an entry to `web/shared/games.ts` with its title, tagline, page, preview, still, and (optionally) where it saves its best score.

The card appears automatically. Its moving preview, the hover effects and the warp jump into the game are built in.

## Media tools

The tools are TypeScript files that Node runs directly (Node 24+, no compile step). They need Google Chrome, ImageMagick (`brew install imagemagick`) and ffmpeg. Run `npm install` once inside `tools/` to get the editor type hints.

### 1. Find and download media: `tools/fetch-media.ts`

Searches Pexels and Unsplash without API keys. It uses a hidden Chrome window to search, and skips paid Unsplash+ photos.

```sh
# search, then look at the previews it saves in tools/.cache/previews/
node tools/fetch-media.ts search unsplash photos "iron man" 12
node tools/fetch-media.ts search pexels videos "sparks" 8

# download one result by its id
node tools/fetch-media.ts get unsplash photos Wl8YymD2qSc helmet-profile
```

`get` saves the file to `web/media/media-raw/` and records the photographer in `credits.json` and `shared/credits.ts`, so the footer credits update the next time you compile.

Unsplash has no free videos, so use Pexels for video.

### 2. Edit media: `tools/edit-media.ts`

```sh
# photos: resize, apply a style, save as .webp
node tools/edit-media.ts photo web/media/media-raw/helmet-profile.jpg web/media/images/helmet-profile.webp --style hero

# videos: trim, grade, drop the sound, make a poster frame
node tools/edit-media.ts video web/media/media-raw/sparks.mp4 web/media/videos/sparks --style hero --length 8

# animated copy of a finished clip, shown when a browser blocks the video
node tools/edit-media.ts anim web/media/videos/sparks.mp4 web/media/videos/sparks-anim.webp

# compare options side by side
node tools/edit-media.ts sheet compare.jpg a.webp b.webp c.webp
```

When you add a background video, give it `data-bg-video` and a `data-anim` path to its animated copy.

| Style | Look |
| --- | --- |
| `hero` | punchy contrast, warm red tint, dark edges |
| `duotone` | black → armor red → gold |
| `hud` | cyan heads-up-display look with scanlines (photo and video) |
| `comic` | bold flat colors with ink outlines |
| `glow` | bright parts bloom |
| `none` | just resize/compress |

Video options: `--start`, `--length`, `--width` and `--boomerang` (plays forward then backward so it loops smoothly).

**Note:** the keyless downloader works the way Pexels and Unsplash's websites work today. If either site changes, `fetch-media.ts` may need updating.

## Testing

```sh
npm test                                     # compile everything, start wrangler dev, run all checks
node tests/check-pages.ts https://noaharmor.com   # check the live site
```

Tests use Playwright (installed by `npm install`; WebKit once with `npx playwright install webkit`). Each run covers:
- **Chrome** and **WebKit** (Safari's engine, which DuckDuckGo on Mac uses) at desktop and phone sizes. They click through everything: scanning a suit, overloading the reactor, flipping cards, the helmet designer, the warp into the game, the countdown, playing until game over, and Play again. In Suit Lab they build a suit, fly and fire in Demolition (it must score), start Drone Defense (wave 1 must arrive), and reload to check the suit was remembered.
- **Autoplay blocked**, set up to behave like DuckDuckGo. Something must still move, the browser's play button must never show, and one click must start the real videos.
- **Squish checks:** the game's play area is resized mid-game, with and without a window resize, and every canvas must stay in proportion.
- **Range requests:** videos must be served in pieces (`206`).

Screenshots go to `tests/screenshots/<browser>/`. The run fails on JavaScript errors, files that didn't load, broken images or fonts, videos that don't play (or show no moving fallback), stretched canvases, or missing range support.

## Credits

Photos and videos come from [Pexels](https://www.pexels.com) and [Unsplash](https://unsplash.com). Each one is credited to its creator in the site footer. The fonts are [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani), both under the SIL Open Font License.

Iron Man is a Marvel character. This is a personal, non-commercial fan site.
