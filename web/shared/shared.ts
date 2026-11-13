// Shared behavior for every page.
// Loaded after shared/credits.js and before the page's own script.
//
// Every page gets:
//   - a glowing targeting cursor
//   - repulsor blasts wherever you click
//   - elements that fly in when scrolled into view   (add data-reveal)
//   - numbers that count up when scrolled into view  (add data-count-to="85")
//   - typewriter text                                (add data-type="text to type")
//   - the photo/video credits list in the footer     (add id="credits-list")
//   - a warp-jump transition on links to the game    (add data-game-link)

// ---------------------------------------------------------------------------
// Targeting cursor
// ---------------------------------------------------------------------------

function setupReticle() {
  // Only for mouse users: touch screens have no cursor to replace
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const reticle = document.createElement("div");
  reticle.className = "reticle";
  document.body.append(reticle);
  document.body.classList.add("has-reticle");

  let mouseX = -100;
  let mouseY = -100;
  let x = mouseX;
  let y = mouseY;

  window.addEventListener("pointermove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    // grow the reticle over anything clickable
    const target = event.target as Element;
    reticle.classList.toggle("is-hovering", !!target.closest("a, button, summary, input, [data-clickable]"));
  });

  // Glide toward the mouse each frame for a smooth, floaty feel
  function follow() {
    x += (mouseX - x) * 0.35;
    y += (mouseY - y) * 0.35;
    reticle.style.translate = `${x}px ${y}px`;
    requestAnimationFrame(follow);
  }
  follow();
}

// ---------------------------------------------------------------------------
// Repulsor blasts: a flash ring + sparks wherever you click
// ---------------------------------------------------------------------------

type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Ring = { x: number; y: number; radius: number; life: number; color: string };

const blastSparks: Spark[] = [];
const blastRings: Ring[] = [];
let blastCanvas: HTMLCanvasElement;
let blastContext: CanvasRenderingContext2D;
let blastRunning = false;

function setupBlasts() {
  blastCanvas = document.createElement("canvas");
  blastCanvas.className = "blast-layer";
  document.body.append(blastCanvas);
  blastContext = blastCanvas.getContext("2d")!;

  const resize = () => {
    blastCanvas.width = window.innerWidth;
    blastCanvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);

  window.addEventListener("pointerdown", (event) => {
    // don't blast when typing in a box
    if ((event.target as Element).closest("input, textarea")) return;
    fireBlast(event.clientX, event.clientY);
  });
}

// Can also be called by page scripts, e.g. fireBlast(x, y, "#ffc94a", 3)
function fireBlast(x: number, y: number, color = "#5ee7ff", power = 1) {
  blastRings.push({ x, y, radius: 4, life: 1, color });
  const count = Math.round(26 * power);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 6) * power;
    blastSparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color: Math.random() < 0.3 ? "#ffffff" : color,
      size: 1.5 + Math.random() * 2.5,
    });
  }
  if (!blastRunning) {
    blastRunning = true;
    requestAnimationFrame(drawBlasts);
  }
}

function drawBlasts() {
  const ctx = blastContext;
  ctx.clearRect(0, 0, blastCanvas.width, blastCanvas.height);
  ctx.globalCompositeOperation = "lighter"; // overlapping light adds up and glows

  for (const ring of blastRings) {
    ring.radius += 7;
    ring.life -= 0.045;
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = Math.max(ring.life, 0);
    ctx.lineWidth = 4 * ring.life;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const spark of blastSparks) {
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.vx *= 0.94;
    spark.vy = spark.vy * 0.94 + 0.12; // a little gravity
    spark.life -= 0.025;
    ctx.globalAlpha = Math.max(spark.life, 0);
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, spark.size * spark.life + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // remove finished rings and sparks
  removeDead(blastRings);
  removeDead(blastSparks);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  if (blastRings.length || blastSparks.length) requestAnimationFrame(drawBlasts);
  else blastRunning = false;
}

function removeDead(list: { life: number }[]) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.life <= 0) list.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Scroll effects: reveal, count-up and typewriter all start when visible
// ---------------------------------------------------------------------------

function whenVisible(selector: string, onVisible: (element: HTMLElement) => void) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        onVisible(entry.target as HTMLElement);
      }
    },
    { threshold: 0.15 }
  );
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => observer.observe(element));
}

function countUp(element: HTMLElement) {
  const target = Number(element.dataset.countTo);
  const duration = 1600;
  const start = performance.now();
  function step(now: number) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // fast start, gentle finish
    element.textContent = Math.round(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function typeText(element: HTMLElement) {
  const text = element.dataset.type ?? "";
  element.textContent = "";
  element.classList.add("is-typing");
  let i = 0;
  const timer = setInterval(() => {
    element.textContent = text.slice(0, ++i);
    if (i >= text.length) {
      clearInterval(timer);
      element.classList.remove("is-typing");
    }
  }, 45);
}

// ---------------------------------------------------------------------------
// Credits list in the footer (CREDITS comes from shared/credits.ts)
// ---------------------------------------------------------------------------

function renderCredits() {
  const list = document.getElementById("credits-list");
  if (!list) return;

  const summary = document.querySelector(".credits summary");
  if (summary) summary.textContent = `Photo & video credits (${CREDITS.length})`;

  CREDITS.forEach((credit, i) => {
    const item = document.createElement("li");
    item.style.setProperty("--i", String(i));

    const type = document.createElement("span");
    type.className = "credit-type";
    type.textContent = `${credit.type} · ${credit.site}`;

    item.append(type, makeLink(credit.title, credit.pageUrl), document.createElement("br"), "by ");
    item.append(makeLink(credit.author, credit.authorUrl));
    list.append(item);
  });
}

// A link that opens in a new tab (textContent keeps outside text from being treated as HTML)
function makeLink(text: string, url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = text;
  return link;
}

// ---------------------------------------------------------------------------
// Warp jump into the game
// Every link marked data-game-link plays this instead of a normal page change:
// the page zooms toward the click, light streaks shoot outward, arc reactor rings
// close in, and a white flash fills the screen. The game page then opens out of
// that same white flash (see pages/game), so the two halves feel like one move.
// ---------------------------------------------------------------------------

type WarpStreak = { angle: number; distance: number; speed: number; color: string; width: number };

let isWarping = false;

function setupGameLinks() {
  document.querySelectorAll<HTMLAnchorElement>("[data-game-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      let x = event.clientX;
      let y = event.clientY;
      // a keyboard "click" (Enter key) has no mouse position, so use the middle of the link
      if (event.detail === 0) {
        const box = link.getBoundingClientRect();
        x = box.left + box.width / 2;
        y = box.top + box.height / 2;
      }
      warpTo(link.href, x, y);
    });
  });

  // The Back button can bring this page back frozen mid-warp, so undo the warp
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) clearWarp();
  });
}

function warpTo(url: string, x: number, y: number) {
  if (isWarping) return;
  isWarping = true;

  const overlay = document.createElement("div");
  overlay.className = "warp warp-out";
  overlay.style.setProperty("--wx", `${x}px`);
  overlay.style.setProperty("--wy", `${y}px`);
  overlay.innerHTML = `
    <canvas></canvas>
    <div class="warp-iris">
      <span class="warp-ring ring-a"></span>
      <span class="warp-ring ring-b"></span>
      <span class="warp-ring ring-c"></span>
    </div>
    <div class="warp-flash"></div>`;
  document.body.append(overlay);

  // Every part of the page zooms toward the click point
  for (const element of Array.from(document.body.children) as HTMLElement[]) {
    if (element === overlay || element.matches(".reticle, .blast-layer")) continue;
    const box = element.getBoundingClientRect();
    element.style.transformOrigin = `${x - box.left}px ${y - box.top}px`;
    element.classList.add("warp-zoom");
  }

  playWarpStreaks(overlay.querySelector("canvas")!, x, y, "out", 1100);
  fireBlast(x, y, "#5ee7ff", 2);
  setTimeout(() => (window.location.href = url), 1050);
}

function clearWarp() {
  isWarping = false;
  document.querySelectorAll(".warp-out").forEach((element) => element.remove());
  document.querySelectorAll(".warp-zoom").forEach((element) => element.classList.remove("warp-zoom"));
}

// Hyperspace light streaks on a full-screen canvas.
//   "out": streaks start slow near the origin and speed up (leaving a page)
//   "in":  streaks start fast and slow down as they fade (arriving on a page)
function playWarpStreaks(canvas: HTMLCanvasElement, originX: number, originY: number, mode: "out" | "in", duration: number) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const farthest = Math.hypot(canvas.width, canvas.height);
  const colors = ["#ffffff", "#5ee7ff", "#5ee7ff", "#ffc94a"];

  const newStreak = (distance: number): WarpStreak => ({
    angle: Math.random() * Math.PI * 2,
    distance,
    speed: mode === "out" ? 2 + Math.random() * 4 : 40 + Math.random() * 45,
    color: colors[Math.floor(Math.random() * colors.length)]!,
    width: 1 + Math.random() * 2.5,
  });

  const streaks: WarpStreak[] = [];
  for (let i = 0; i < 260; i++) {
    streaks.push(newStreak(mode === "out" ? Math.random() * farthest * 0.5 : Math.random() * 80));
  }

  const start = performance.now();
  function frame(now: number) {
    const progress = Math.min((now - start) / duration, 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = mode === "out" ? Math.min(1, progress * 3) : 1 - progress;

    for (const streak of streaks) {
      streak.speed *= mode === "out" ? 1.07 : 0.94;
      streak.distance += streak.speed;
      // when leaving, keep the screen full by restarting streaks that fly off
      if (mode === "out" && streak.distance > farthest) Object.assign(streak, newStreak(Math.random() * 60));

      const tail = Math.max(0, streak.distance - streak.speed * 6);
      const cos = Math.cos(streak.angle);
      const sin = Math.sin(streak.angle);
      ctx.strokeStyle = streak.color;
      ctx.lineWidth = streak.width;
      ctx.beginPath();
      ctx.moveTo(originX + cos * tail, originY + sin * tail);
      ctx.lineTo(originX + cos * streak.distance, originY + sin * streak.distance);
      ctx.stroke();
    }
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------

setupReticle();
setupBlasts();
whenVisible("[data-reveal]", (element) => element.classList.add("is-visible"));
whenVisible("[data-count-to]", countUp);
whenVisible("[data-type]", typeText);
renderCredits();
setupGameLinks();
