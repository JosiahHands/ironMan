# Noah's Armory

An Iron Man fan site built for Noah. Three pages, with something moving or reacting on every part of every page:

| Page | File | What's there |
| --- | --- | --- |
| Landing | `web/index.html` | Spinning network globe, glowing "Enter the Armory" button, count-up stats |
| Home | `web/pages/home/home.html` | Suit cards, arc reactor to charge, flip cards, history timeline, helmet designer, rocket launch |
| Game | `web/pages/game/game.html` | **Repulsor Rush**: fly above the clouds and blast drones |

Every page also has a targeting cursor, a repulsor blast wherever you click, and an expandable photo/video credits list in the footer.

## Running the site

The site is written in TypeScript, so compile it first:

```sh
tsc -p web
```

Then open `web/index.html` in a browser. You don't need a server: double-clicking the file works. Every image, video and font is stored in the project, so the site doesn't need the internet.

To recompile automatically while you edit, run `tsc -p web --watch`.

## Project layout

```
web/
  index.html, style.css, script.ts   landing page
  pages/home/                        home page (.html, .css, .ts)
  pages/game/                        game page (.html, .css, .ts)
  shared/
    shared.css                       colors, fonts, buttons, cursor, footer
    shared.ts                        cursor, click blasts, scroll effects, credits list
    credits.ts                       auto-generated list of media credits
  media/
    media-raw/                       original downloads (not used by the pages)
    images/                          edited photos (.webp)
    videos/                          edited clips (.mp4) + poster frames (.webp)
    fonts/                           Orbitron + Rajdhani
    credits.json                     who made each photo/video
  dist/                              compiled JavaScript (made by tsc)
tools/                               command-line helpers for media
tests/                               automated page checks
```

Each page loads `shared/credits.js`, then `shared/shared.js`, then its own script, all from `dist/`.

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

# compare options side by side
node tools/edit-media.ts sheet compare.jpg a.webp b.webp c.webp
```

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
tsc -p web
node tests/check-pages.ts
```

This opens every page in a hidden Chrome at desktop and phone sizes. It clicks through the interactive parts (scanning a suit, overloading the reactor, flipping cards, the helmet designer, playing the game until game over) and saves screenshots to `tests/screenshots/`.

It fails if it finds JavaScript errors, files that didn't load, broken images or videos, or fonts that didn't load.

## Credits

Photos and videos come from [Pexels](https://www.pexels.com) and [Unsplash](https://unsplash.com). Each one is credited to its creator in the site footer. The fonts are [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani), both under the SIL Open Font License.

Iron Man is a Marvel character. This is a personal, non-commercial fan site.
