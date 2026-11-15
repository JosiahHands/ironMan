// Suit Lab: build your own suit in the garage, then take it flying (flight.ts).
// Loaded after suit.ts (the suit itself) and flight.ts (the flying game).
//
// The page has phases (body data-phase): garage -> modes -> flying -> report.
// suitLab.css shows and hides parts of the page for each one.

function startSuitLab() {
  const garage = document.getElementById("garage")!;
  const previewCanvas = document.getElementById("suit-preview") as HTMLCanvasElement;
  const nameInput = document.getElementById("suit-name") as HTMLInputElement;
  const bayName = document.getElementById("bay-name")!;
  const partGroups = document.querySelectorAll<HTMLElement>("[data-part]");

  let suit = loadSuit();
  let celebrateTime = 0; // seconds left of the "part changed" flash in the preview

  const flight = setupFlight(openGarage);
  const preview = keepCanvasSized(previewCanvas);

  function openGarage() {
    setLabPhase("garage");
    garage.scrollIntoView({ block: "start" });
  }

  // ----- picking parts -----

  // Mark the picked button in every group, update the name, the stat bars, and save
  function showSuit() {
    partGroups.forEach((group) => {
      const part = group.dataset.part as keyof SuitDesign;
      group.querySelectorAll<HTMLElement>("button").forEach((button) => {
        button.classList.toggle("is-picked", button.dataset.value === suit[part]);
      });
    });
    nameInput.value = suit.name;
    bayName.textContent = suit.name;
    const bars = statBars(suit);
    for (const [stat, amount] of Object.entries(bars)) {
      document.getElementById(`stat-${stat}`)!.style.width = `${Math.round(amount * 100)}%`;
    }
    saveSuit(suit);
  }

  // A burst on the preview whenever something changes
  function celebrate() {
    celebrateTime = 0.6;
    const box = previewCanvas.getBoundingClientRect();
    fireBlast(box.left + box.width / 2, box.top + box.height * 0.45, suit.eyes, 2);
  }

  partGroups.forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLElement>("button[data-value]");
      if (!button) return;
      suit = { ...suit, [group.dataset.part!]: button.dataset.value };
      showSuit();
      celebrate();
    });
  });

  nameInput.addEventListener("input", () => {
    suit.name = nameInput.value.toUpperCase().trim() || "MARK ???";
    bayName.textContent = suit.name;
    saveSuit(suit);
  });

  document.getElementById("random-suit")!.addEventListener("click", () => {
    const random: Record<string, string> = {};
    partGroups.forEach((group) => {
      random[group.dataset.part!] = pickOne([...group.querySelectorAll<HTMLElement>("button")]).dataset.value!;
    });
    suit = { ...suit, ...random, name: `MARK NOAH-${Math.floor(Math.random() * 99) + 1}` };
    showSuit();
    celebrate();
  });

  document.getElementById("suit-up")!.addEventListener("click", () => flight.showModes(suit));

  // ----- the live preview in the bay -----

  function drawPreview(time: number) {
    preview.sync();
    const { width, height } = preview.size;
    const ctx = preview.ctx;
    ctx.clearRect(0, 0, width, height);
    if (width > 0) {
      const scale = Math.min(height / 140, width / 100);
      const x = width / 2;
      const y = height * 0.45 + Math.sin(time * 1.6) * 6; // gentle hover
      const groundY = height * 0.45 + 62 * scale;

      // glowing landing pad under the suit
      ctx.globalCompositeOperation = "lighter";
      const pad = ctx.createRadialGradient(x, groundY, 0, x, groundY, 60 * scale);
      pad.addColorStop(0, suit.eyes);
      pad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = pad;
      ctx.beginPath();
      ctx.ellipse(x, groundY, 60 * scale, 12 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      drawSuit(ctx, suit, {
        x,
        y,
        scale,
        tilt: Math.sin(time * 1.3) * 0.06,
        facing: 1,
        aim: -0.2 + Math.sin(time * 0.9) * 0.35,
        thrust: 0.45 + Math.sin(time * 3) * 0.15,
        firing: Math.sin(time * 2) > 0.6,
        time,
      });

      // scanner line sweeping up and down over the suit
      const scanY = height * 0.5 + Math.sin(time * 1.1) * height * 0.42;
      const scan = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 2);
      scan.addColorStop(0, "rgba(94, 231, 255, 0)");
      scan.addColorStop(1, "rgba(94, 231, 255, 0.45)");
      ctx.fillStyle = scan;
      ctx.fillRect(0, scanY - 14, width, 16);

      // flash ring when a part changes
      if (celebrateTime > 0) {
        const grow = 1 - celebrateTime / 0.6;
        ctx.globalAlpha = celebrateTime / 0.6;
        ctx.strokeStyle = suit.trim;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(x, height * 0.45, (30 + grow * 70) * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  let lastTime = performance.now();
  function frame(now: number) {
    celebrateTime = Math.max(0, celebrateTime - (now - lastTime) / 1000);
    lastTime = now;
    if (document.body.dataset.phase === "garage") drawPreview(now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ----- arriving: the second half of the warp jump from the other pages -----

  function playIntro() {
    const warpIn = document.getElementById("warp-in")!;
    const warpCanvas = document.getElementById("warp-canvas") as HTMLCanvasElement;
    playWarpStreaks(warpCanvas, window.innerWidth / 2, window.innerHeight / 2, "in", 1500);
    setTimeout(() => warpIn.remove(), 1800);
    setTimeout(() => document.body.classList.remove("intro"), 3000);
  }

  setLabPhase("garage");
  showSuit();
  playIntro();
}

startSuitLab();
