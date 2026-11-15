// All Games page: builds one card per game from the list in shared/games.ts.
// Each card shows a moving preview of real gameplay, the title, a tagline and your
// best score. Clicking it warp-jumps into the game (data-game-link, see shared.ts).

function startGamesPage() {
  const grid = document.getElementById("game-grid")!;
  const toWeb = "../../"; // this page is two folders inside web/

  GAMES.forEach((game, i) => {
    const card = document.createElement("a");
    card.className = "game-card";
    card.href = toWeb + game.page;
    card.dataset.gameLink = ""; // warp jump on click
    card.style.setProperty("--i", String(i)); // cards fly in one after another

    // preview: the still shows straight away, then swaps to the moving preview once it has loaded
    const preview = document.createElement("div");
    preview.className = "game-preview";
    const image = document.createElement("img");
    image.src = toWeb + game.still;
    image.alt = `${game.title} gameplay`;
    preview.append(image);
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const bracket = document.createElement("span");
      bracket.className = `hud-corner ${corner}`;
      preview.append(bracket);
    }
    const scan = document.createElement("span");
    scan.className = "game-scan";
    preview.append(scan);

    const moving = new Image();
    moving.onload = () => (image.src = moving.src);
    moving.src = toWeb + game.preview;

    // text: title, tagline, best score and the play button
    const info = document.createElement("div");
    info.className = "game-info";
    const title = document.createElement("h2");
    title.textContent = game.title;
    const tagline = document.createElement("p");
    tagline.textContent = game.tagline;
    const meta = document.createElement("div");
    meta.className = "game-meta";
    const best = document.createElement("span");
    best.className = "game-best";
    best.textContent = bestScoreText(game.bestScoreKey);
    const play = document.createElement("span");
    play.className = "game-play";
    play.textContent = "▶ Play";
    meta.append(best, play);
    info.append(title, tagline, meta);

    card.append(preview, info);
    grid.append(card);
    addTilt(card);
  });
}

// "BEST: 2,050", or a nudge to play if there's no score yet
function bestScoreText(key?: string) {
  if (!key) return "";
  let best = 0;
  try {
    best = Number(localStorage.getItem(key)) || 0;
  } catch {
    // storage blocked (private window): just show no score
  }
  return best > 0 ? `BEST: ${best.toLocaleString()}` : "NEW MISSION!";
}

// The card leans toward the mouse, with a glare that follows it
function addTilt(card: HTMLElement) {
  card.addEventListener("pointermove", (event) => {
    const box = card.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    card.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
    card.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
    card.style.setProperty("--mx", `${x * 100}%`);
    card.style.setProperty("--my", `${y * 100}%`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--rx", "0deg");
  });
}

startGamesPage();
