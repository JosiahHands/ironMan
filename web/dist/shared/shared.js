"use strict";
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
//   - background videos that are forced to play       (add data-bg-video)
//   - the real visible screen height as --vh          (use calc(var(--vh) * 100))
//   - keepCanvasSized(): canvases that never stretch or squish
//
// Rule for this project: never trust the browser to do the right thing on its own.
// Anything that matters is set in code, checked, and retried, with a good fallback.
// ---------------------------------------------------------------------------
// Real visible screen height
// "100vh" means different things in different browsers (toolbars, zoom), so we
// measure the visible height ourselves and give it to the CSS as --vh (1% of it).
// ---------------------------------------------------------------------------
function setupViewportHeight() {
    const update = () => {
        const height = window.visualViewport?.height ?? window.innerHeight;
        document.documentElement.style.setProperty("--vh", `${height / 100}px`);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
}
// ---------------------------------------------------------------------------
// Fonts: browsers only load a font weight once something on the page uses it,
// so a weight that shows up later (e.g. bold text added by a script) can flash in
// late. Load every weight up front.
// ---------------------------------------------------------------------------
function loadAllFonts() {
    for (const font of ["900 1em Orbitron", "700 1em Orbitron", "500 1em Rajdhani", "700 1em Rajdhani"]) {
        document.fonts.load(font).catch(() => { });
    }
}
function keepCanvasSized(canvas, onResize) {
    const ctx = canvas.getContext("2d");
    const size = { width: 0, height: 0 };
    let ratio = 0;
    // returns true if the canvas had to be resized
    function sync() {
        // clientWidth/clientHeight = the box's real layout size (not affected by zoom animations)
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const pixelRatio = window.devicePixelRatio || 1;
        if (width === size.width && height === size.height && pixelRatio === ratio)
            return false;
        size.width = width;
        size.height = height;
        ratio = pixelRatio;
        canvas.width = Math.max(1, Math.round(width * pixelRatio));
        canvas.height = Math.max(1, Math.round(height * pixelRatio));
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        onResize?.(size);
        return true;
    }
    new ResizeObserver(() => sync()).observe(canvas);
    window.addEventListener("resize", () => sync());
    sync();
    return { ctx, size, sync };
}
const bgVideos = [];
// Swap the fallback layer from the still poster to the animated copy (only once it has loaded,
// so there's never a blank gap)
function useAnimatedFallback(entry) {
    const animUrl = entry.video.dataset.anim;
    if (entry.usingAnim || !animUrl)
        return;
    entry.usingAnim = true;
    const image = new Image();
    image.onload = () => {
        entry.fallback.style.backgroundImage = `url("${animUrl}")`;
        entry.fallback.classList.add("is-animated");
        powerOnScan(entry.fallback);
    };
    image.onerror = () => (entry.usingAnim = false); // try again next time
    image.src = animUrl;
}
function setupVideos() {
    document.querySelectorAll("video[data-bg-video]").forEach((video) => {
        // Force every setting autoplay depends on, as properties AND attributes
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.controls = false;
        video.disablePictureInPicture = true;
        video.preload = "auto";
        for (const attribute of ["muted", "playsinline", "webkit-playsinline", "disablepictureinpicture", "disableremoteplayback"]) {
            video.setAttribute(attribute, "");
        }
        video.removeAttribute("controls");
        video.tabIndex = -1;
        // The fallback: the poster image, slowly drifting, right underneath the video
        const fallback = document.createElement("div");
        fallback.className = `${video.className} video-fallback`;
        fallback.style.backgroundImage = `url("${video.poster}")`;
        fallback.setAttribute("aria-hidden", "true");
        video.before(fallback);
        video.classList.add("managed-video"); // hidden until it's really playing
        const entry = { video, fallback, onScreen: false, usingAnim: false };
        bgVideos.push(entry);
        // Only show the video once frames are actually moving. Videos with the "power-on" class
        // wait until they've played smoothly for a moment, so any startup stutter stays hidden.
        const smoothAfter = video.classList.contains("power-on") ? 0.35 : 0;
        video.addEventListener("timeupdate", () => {
            if (video.currentTime > smoothAfter && !video.paused && !video.classList.contains("is-playing")) {
                video.classList.add("is-playing");
                powerOnScan(video);
            }
        });
        // If something else pauses it while it's on screen, start it again
        video.addEventListener("pause", () => {
            if (entry.onScreen && !document.hidden)
                setTimeout(() => forcePlay(entry), 300);
        });
        // If it fails to load: show the animated copy, and try loading the video once more
        video.addEventListener("error", () => {
            useAnimatedFallback(entry);
            setTimeout(() => video.load(), 2000);
        }, { once: true });
        // Play when on screen, pause when not. If it isn't truly playing 1.5 seconds after
        // coming on screen, switch the fallback to the animated copy.
        new IntersectionObserver(([change]) => {
            entry.onScreen = !!change?.isIntersecting;
            if (entry.onScreen) {
                forcePlay(entry);
                setTimeout(() => {
                    if (entry.onScreen && !video.classList.contains("is-playing"))
                        useAnimatedFallback(entry);
                }, 1500);
            }
            else {
                video.pause();
            }
        }).observe(video);
    });
    if (!bgVideos.length)
        return;
    // Any tap, click or key press counts as permission to play in strict browsers
    const retryAll = () => bgVideos.forEach((entry) => entry.onScreen && forcePlay(entry));
    for (const eventName of ["pointerdown", "touchstart", "keydown", "click"]) {
        window.addEventListener(eventName, retryAll, { passive: true });
    }
    document.addEventListener("visibilitychange", () => !document.hidden && retryAll());
    window.addEventListener("pageshow", retryAll);
    // Watchdog: catch any video that is on screen but stuck
    setInterval(() => {
        bgVideos.forEach((entry) => {
            if (entry.onScreen && !document.hidden && entry.video.paused)
                forcePlay(entry);
        });
    }, 1500);
}
// "power-on" backgrounds: the first time one appears, a glowing scan line sweeps down
// the section while the background is revealed (the reveal itself is CSS: .power-on)
function powerOnScan(element) {
    const section = element.parentElement;
    if (!element.classList.contains("power-on") || !section || section.dataset.poweredOn)
        return;
    section.dataset.poweredOn = "yes"; // only the first time
    const scan = document.createElement("span");
    scan.className = "power-scan";
    scan.setAttribute("aria-hidden", "true");
    element.after(scan);
    scan.addEventListener("animationend", () => scan.remove());
}
function forcePlay(entry) {
    entry.video.muted = true; // some browsers only allow muted autoplay, so make sure
    const attempt = entry.video.play();
    // Refused (e.g. "wait for a click"): show the animated copy now, and keep retrying the video
    attempt?.catch(() => useAnimatedFallback(entry));
}
// ---------------------------------------------------------------------------
// Targeting cursor
// ---------------------------------------------------------------------------
function setupReticle() {
    // Only for mouse users: touch screens have no cursor to replace
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches)
        return;
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
        const target = event.target;
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
const blastSparks = [];
const blastRings = [];
let blastLayer;
let blastRunning = false;
function setupBlasts() {
    const canvas = document.createElement("canvas");
    canvas.className = "blast-layer";
    document.body.append(canvas);
    blastLayer = keepCanvasSized(canvas);
    window.addEventListener("pointerdown", (event) => {
        // don't blast when typing in a box
        if (event.target.closest("input, textarea"))
            return;
        fireBlast(event.clientX, event.clientY);
    });
}
// Can also be called by page scripts, e.g. fireBlast(x, y, "#ffc94a", 3)
function fireBlast(x, y, color = "#5ee7ff", power = 1) {
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
    blastLayer.sync(); // make sure the layer still matches the screen
    const ctx = blastLayer.ctx;
    ctx.clearRect(0, 0, blastLayer.size.width, blastLayer.size.height);
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
    if (blastRings.length || blastSparks.length)
        requestAnimationFrame(drawBlasts);
    else
        blastRunning = false;
}
function removeDead(list) {
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].life <= 0)
            list.splice(i, 1);
    }
}
// ---------------------------------------------------------------------------
// Scroll effects: reveal, count-up and typewriter all start when visible
// ---------------------------------------------------------------------------
function whenVisible(selector, onVisible) {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting)
                continue;
            observer.unobserve(entry.target);
            onVisible(entry.target);
        }
    }, { threshold: 0.15 });
    document.querySelectorAll(selector).forEach((element) => observer.observe(element));
}
function countUp(element) {
    const target = Number(element.dataset.countTo);
    const duration = 1600;
    const start = performance.now();
    function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // fast start, gentle finish
        element.textContent = Math.round(target * eased).toLocaleString();
        if (progress < 1)
            requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}
function typeText(element) {
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
    if (!list)
        return;
    const summary = document.querySelector(".credits summary");
    if (summary)
        summary.textContent = `Photo & video credits (${CREDITS.length})`;
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
function makeLink(text, url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = text;
    return link;
}
let isWarping = false;
function setupGameLinks() {
    // One listener for the whole page, so game links added later (like the cards on the
    // All Games page) get the warp too
    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-game-link]");
        if (!link)
            return;
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
    // The Back button can bring this page back frozen mid-warp, so undo the warp
    window.addEventListener("pageshow", (event) => {
        if (event.persisted)
            clearWarp();
    });
}
function warpTo(url, x, y) {
    if (isWarping)
        return;
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
    for (const element of Array.from(document.body.children)) {
        if (element === overlay || element.matches(".reticle, .blast-layer"))
            continue;
        const box = element.getBoundingClientRect();
        element.style.transformOrigin = `${x - box.left}px ${y - box.top}px`;
        element.classList.add("warp-zoom");
    }
    playWarpStreaks(overlay.querySelector("canvas"), x, y, "out", 1100);
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
function playWarpStreaks(canvas, originX, originY, mode, duration) {
    const { ctx, size, sync } = keepCanvasSized(canvas);
    const farthest = Math.hypot(size.width, size.height);
    const colors = ["#ffffff", "#5ee7ff", "#5ee7ff", "#ffc94a"];
    const newStreak = (distance) => ({
        angle: Math.random() * Math.PI * 2,
        distance,
        speed: mode === "out" ? 2 + Math.random() * 4 : 40 + Math.random() * 45,
        color: colors[Math.floor(Math.random() * colors.length)],
        width: 1 + Math.random() * 2.5,
    });
    const streaks = [];
    for (let i = 0; i < 260; i++) {
        streaks.push(newStreak(mode === "out" ? Math.random() * farthest * 0.5 : Math.random() * 80));
    }
    const start = performance.now();
    function frame(now) {
        const progress = Math.min((now - start) / duration, 1);
        sync();
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = mode === "out" ? Math.min(1, progress * 3) : 1 - progress;
        for (const streak of streaks) {
            streak.speed *= mode === "out" ? 1.07 : 0.94;
            streak.distance += streak.speed;
            // when leaving, keep the screen full by restarting streaks that fly off
            if (mode === "out" && streak.distance > farthest)
                Object.assign(streak, newStreak(Math.random() * 60));
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
        if (progress < 1)
            requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
// ---------------------------------------------------------------------------
loadAllFonts();
setupViewportHeight();
setupVideos();
setupReticle();
setupBlasts();
whenVisible("[data-reveal]", (element) => element.classList.add("is-visible"));
whenVisible("[data-count-to]", countUp);
whenVisible("[data-type]", typeText);
renderCredits();
setupGameLinks();
//# sourceMappingURL=shared.js.map