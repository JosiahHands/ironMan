// Suit Lab, part 2: fly the suit you built around a city and smash it.
//
// Modes:
//   free       Free Fly: no timer, no danger. Smash anything, rebuild the city any time.
//   demolition Demolition: 90 seconds to wreck as much as you can. Quick hits build a combo.
//   defense    Drone Defense: waves of drones that shoot back. How many waves can you survive?
//
// Controls: WASD / arrow keys fly, the mouse aims, hold the mouse button to fire, SPACE = special.
// Touch screens: hold your finger where you want to fly; the suit aims and fires by itself.
//
// The city:
//   - buildings are stacks of blocks; break a block and the ones above it fall down
//   - cars drive along the street, fuel tanks explode and set off chain reactions
//   - drones float around (in Drone Defense they hunt you and shoot)
//
// The world is 800 units tall and is scaled to fit the play area's height, so it looks the
// same on every screen. The camera follows the suit sideways.

type FlightMode = "free" | "demolition" | "defense";
type CityBlock = { y: number; vy: number; hp: number; windows: boolean[] };
type CityColumn = { x: number; color: string; blocks: CityBlock[] }; // blocks[0] sits on the ground
type Car = { x: number; dir: number; speed: number; color: string; wreckTimer: number }; // wreckTimer > 0: wrecked
type FuelTank = { x: number; hp: number; alive: boolean };
type Drone = { x: number; y: number; vx: number; vy: number; homeX: number; homeY: number; hp: number; age: number; fireTimer: number; hitFlash: number; hunter: boolean };
type SuitShot = { kind: "bolt" | "missile"; x: number; y: number; vx: number; vy: number; targetX: number; targetY: number; life: number };
type DroneShot = { x: number; y: number; vx: number; vy: number; life: number };
type Debris = { x: number; y: number; vx: number; vy: number; angle: number; spin: number; size: number; color: string; life: number };
type FlightParticle = { x: number; y: number; vx: number; vy: number; life: number; fade: number; size: number; color: string; glow: boolean };
type BlastRing = { x: number; y: number; radius: number; maxRadius: number; life: number };
type Popup = { x: number; y: number; text: string; life: number };
type PendingBlast = { x: number; y: number; radius: number; damage: number; delay: number };
type WorldPoint = { x: number; y: number };

const WORLD_WIDTH = 6400;
const WORLD_HEIGHT = 800;
const GROUND_Y = 700; // the street; buildings, cars and fuel tanks stand on it
const BLOCK = 40; // size of one building block
const SUIT_SIZE = 1.25; // how big the suit is drawn
const DEMOLITION_SECONDS = 90;
const POINTS = { block: 10, car: 50, tank: 100, drone: 75 };
const BUILDING_COLORS = ["#2b3a67", "#3d2c5e", "#1f4e5f", "#4a3b52", "#2e4a3f", "#5a3a2e", "#38405a"];
const CAR_COLORS = ["#ff3b30", "#ffc94a", "#5ee7ff", "#6dff8a", "#ffffff", "#ff8a3d", "#c08bff"];
const MOVE_KEYS = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"];
const MODE_NAMES: Record<FlightMode, string> = { free: "FREE FLY", demolition: "DEMOLITION", defense: "DRONE DEFENSE" };
const SPECIAL_NAMES = { unibeam: "UNIBEAM", shockwave: "SHOCKWAVE", swarm: "MISSILE SWARM" };

// Which part of Suit Lab is showing: the garage, the mode menu, flying, or the mission report
function setLabPhase(phase: "garage" | "modes" | "flying" | "report") {
  document.body.dataset.phase = phase;
}

function readNumber(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // storage blocked (private window): the record just won't be remembered
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

function setupFlight(goToGarage: () => void) {
  const stage = document.getElementById("stage")!;
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  const modeTitle = document.getElementById("modes-suit-name")!;
  const bestDemolition = document.getElementById("best-demolition")!;
  const bestDefense = document.getElementById("best-defense")!;
  const scoreLabel = document.getElementById("score-label")!;
  const scoreValue = document.getElementById("hud-score")!;
  const timerBox = document.getElementById("timer-box")!;
  const timerLabel = document.getElementById("timer-label")!;
  const timerValue = document.getElementById("hud-timer")!;
  const shieldsBox = document.getElementById("shields-box")!;
  const shieldsValue = document.getElementById("hud-shields")!;
  const comboBox = document.getElementById("combo")!;
  const specialButton = document.getElementById("special-button")!;
  const specialFill = document.getElementById("special-fill")!;
  const specialText = document.getElementById("special-text")!;
  const rebuildButton = document.getElementById("rebuild-button")!;
  const controlsHint = document.getElementById("controls-hint")!;
  const banner = document.getElementById("flight-banner")!;
  const reportTitle = document.getElementById("report-title")!;
  const reportText = document.getElementById("report-text")!;
  const reportBest = document.getElementById("report-best")!;

  // ----- state -----
  let suit: SuitDesign = { ...DEFAULT_SUIT };
  let stats = suitStats(suit);
  let state: "idle" | "flying" = "idle"; // idle = the city carries on behind the menus
  let mode: FlightMode = "free";
  let clock = 0; // seconds since the page opened
  let score = 0;
  let destroyedCount = 0;
  let chain = 0; // things destroyed in quick succession
  let chainTimer = 0; // frames left to keep the chain going
  let timeLeft = 0; // Demolition, in frames
  let wave = 0; // Drone Defense
  let betweenWaves = false;
  let waveBreak = 0;
  let specialCharge = 0; // 0 to 100
  let unibeamTime = 0; // frames left of an active unibeam
  let shake = 0;
  let camX = 0;
  let idleDirection = 1;
  let laserBeam: { from: WorldPoint; to: WorldPoint } | null = null;

  const view = { scale: 1, width: 0, offsetY: 0 }; // offsetY: extra sky above the world on tall screens
  const player = { x: 300, y: 400, vx: 0, vy: 0, tilt: 0, facing: 1, aim: 0, shields: 5, invincible: 0, fireTimer: 0, firing: false };
  const keys = new Set<string>();
  const pointer = { x: 0, y: 0, down: false, touch: false, moved: false };

  let columns: CityColumn[] = [];
  let tanks: FuelTank[] = [];
  let cars: Car[] = [];
  let drones: Drone[] = [];
  let shots: SuitShot[] = [];
  let droneShots: DroneShot[] = [];
  let debris: Debris[] = [];
  let particles: FlightParticle[] = [];
  let rings: BlastRing[] = [];
  let popups: Popup[] = [];
  let pendingBlasts: PendingBlast[] = [];

  // far-away skyline and star positions, made once
  const farSkyline = Array.from({ length: 70 }, () => 90 + Math.random() * 260);
  const midSkyline = Array.from({ length: 70 }, () => 60 + Math.random() * 200);
  const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.6, phase: Math.random() * 6, size: 0.6 + Math.random() * 1.4 }));

  // ----- setup -----

  // Keep the drawing grid matched to the play area's real size (shared/shared.ts),
  // and scale the 800-unit-tall world to fit. Very narrow screens zoom out a little.
  const world = keepCanvasSized(canvas, (size) => {
    view.scale = Math.min(size.height / WORLD_HEIGHT, size.width / 640);
    view.width = size.width / view.scale;
    view.offsetY = size.height / view.scale - WORLD_HEIGHT;
  });
  const ctx = world.ctx;

  buildCity(false);
  placeCars();
  for (let i = 0; i < 6; i++) drones.push(makeDrone(false));

  // ----- input -----

  function setPointer(event: PointerEvent) {
    const box = canvas.getBoundingClientRect();
    pointer.x = event.clientX - box.left;
    pointer.y = event.clientY - box.top;
    pointer.touch = event.pointerType === "touch";
    pointer.moved = true;
  }

  stage.addEventListener("pointermove", setPointer);
  stage.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("button")) return; // HUD buttons don't fire the weapon
    setPointer(event);
    pointer.down = true;
  });
  window.addEventListener("pointerup", () => (pointer.down = false));
  window.addEventListener("pointercancel", () => (pointer.down = false));
  window.addEventListener("blur", () => {
    keys.clear();
    pointer.down = false;
  });

  window.addEventListener("keydown", (event) => {
    if (state !== "flying") return;
    const key = event.key.toLowerCase();
    if (key === " ") {
      event.preventDefault(); // stop the page from scrolling
      if (!event.repeat) fireSpecial();
    } else if (MOVE_KEYS.includes(key)) {
      event.preventDefault();
      keys.add(key);
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

  // ----- buttons -----

  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => startMission(button.dataset.mode as FlightMode));
  });
  document.getElementById("again-button")!.addEventListener("click", () => startMission(mode));
  for (const id of ["hud-modes", "report-modes"]) {
    document.getElementById(id)!.addEventListener("click", () => showModes(suit));
  }
  for (const id of ["hud-garage", "report-garage", "modes-garage"]) {
    document.getElementById(id)!.addEventListener("click", () => {
      state = "idle";
      goToGarage();
    });
  }
  specialButton.addEventListener("click", fireSpecial);
  rebuildButton.addEventListener("click", () => {
    buildCity(true);
    showBanner("CITY REBUILT!");
  });

  // ----- menus and missions -----

  function showModes(newSuit: SuitDesign) {
    suit = newSuit;
    state = "idle";
    modeTitle.textContent = suit.name;
    bestDemolition.textContent = readNumber("suit-lab-best").toLocaleString();
    bestDefense.textContent = String(readNumber("suit-lab-best-wave"));
    setLabPhase("modes");
    stage.scrollIntoView({ block: "start" });
  }

  function startMission(newMode: FlightMode) {
    mode = newMode;
    stats = suitStats(suit);
    buildCity(true);
    placeCars();
    drones = [];
    shots = [];
    droneShots = [];
    pendingBlasts = [];
    if (mode !== "defense") for (let i = 0; i < 6; i++) drones.push(makeDrone(false));

    Object.assign(player, { x: 300, y: 380, vx: 0, vy: 0, tilt: 0, shields: stats.shields, invincible: 60, fireTimer: 0 });
    camX = 0;
    score = 0;
    destroyedCount = 0;
    chain = 0;
    chainTimer = 0;
    specialCharge = 0;
    unibeamTime = 0;
    timeLeft = DEMOLITION_SECONDS * 60;
    wave = 0;
    betweenWaves = false;

    // the HUD shows different things in each mode
    scoreLabel.textContent = mode === "free" ? "DESTROYED" : "SCORE";
    timerBox.hidden = mode === "free";
    timerLabel.textContent = mode === "demolition" ? "TIME" : "WAVE";
    timerBox.classList.remove("is-urgent");
    shieldsBox.hidden = mode !== "defense";
    rebuildButton.hidden = mode !== "free";
    specialText.textContent = SPECIAL_NAMES[suit.special];

    state = "flying";
    setLabPhase("flying");
    stage.scrollIntoView({ block: "start" });
    showBanner(mode === "defense" ? "GET READY!" : "GO, NOAH!");
    controlsHint.classList.remove("show");
    void controlsHint.offsetWidth; // restart the fade
    controlsHint.classList.add("show");
    updateHud();
  }

  function endMission() {
    state = "idle";
    keys.clear();
    let best = 0;
    let isRecord = false;
    if (mode === "demolition") {
      best = readNumber("suit-lab-best");
      isRecord = score > best;
      if (isRecord) saveNumber("suit-lab-best", (best = score));
      reportTitle.innerHTML = isRecord ? 'NEW <span class="gold">RECORD!</span>' : 'TIME\'S <span class="gold">UP!</span>';
      reportText.textContent = `You smashed ${destroyedCount.toLocaleString()} things and scored ${score.toLocaleString()} points!`;
      reportBest.textContent = `BEST SCORE: ${best.toLocaleString()}`;
    } else {
      best = readNumber("suit-lab-best-wave");
      isRecord = wave > best;
      if (isRecord) saveNumber("suit-lab-best-wave", (best = wave));
      reportTitle.innerHTML = isRecord ? 'NEW <span class="gold">RECORD!</span>' : 'SUIT <span class="gold">DOWN!</span>';
      reportText.textContent = `You reached wave ${wave} and scored ${score.toLocaleString()} points. Tune your suit and try again!`;
      reportBest.textContent = `BEST WAVE: ${best}`;
    }
    setLabPhase("report");
  }

  // ----- the city -----

  function restY(index: number) {
    return GROUND_Y - (index + 1) * BLOCK; // top edge of the block at this height in the stack
  }

  // dropIn: blocks start up in the sky and rain down into place
  function buildCity(dropIn: boolean) {
    columns = [];
    tanks = [];
    let x = 520;
    while (x < WORLD_WIDTH - 300) {
      const widthInBlocks = 2 + Math.floor(Math.random() * 4);
      const heightInBlocks = 3 + Math.floor(Math.random() * 11);
      const color = pickOne(BUILDING_COLORS);
      for (let c = 0; c < widthInBlocks; c++) {
        const blocks: CityBlock[] = [];
        for (let i = 0; i < heightInBlocks; i++) {
          const y = dropIn ? restY(i) - 500 - Math.random() * 400 - i * 40 : restY(i);
          blocks.push({ y, vy: 0, hp: 3, windows: [0, 1, 2, 3].map(() => Math.random() < 0.45) });
        }
        columns.push({ x: x + c * BLOCK, color, blocks });
      }
      x += widthInBlocks * BLOCK;
      const gap = 70 + Math.random() * 170;
      if (gap > 130 && Math.random() < 0.6) tanks.push({ x: x + gap / 2, hp: 2, alive: true });
      x += gap;
    }
  }

  function placeCars() {
    cars = [];
    for (let i = 0; i < 12; i++) {
      cars.push({ x: Math.random() * WORLD_WIDTH, dir: Math.random() < 0.5 ? -1 : 1, speed: 1.5 + Math.random() * 2.5, color: pickOne(CAR_COLORS), wreckTimer: 0 });
    }
  }

  // hunters (Drone Defense) arrive from just off screen; the others float anywhere over the city
  function makeDrone(hunter: boolean): Drone {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = hunter
      ? clamp(camX + view.width / 2 + side * (view.width / 2 + 100 + Math.random() * 300), 50, WORLD_WIDTH - 50)
      : 400 + Math.random() * (WORLD_WIDTH - 800);
    const y = 120 + Math.random() * 280;
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      homeX: x,
      homeY: y,
      hp: hunter ? 2 + Math.floor(wave / 3) : 2,
      age: Math.random() * 1000,
      fireTimer: 90 + Math.random() * 90,
      hitFlash: 0,
      hunter,
    };
  }

  function startWave(number: number) {
    wave = number;
    for (let i = 0; i < 2 + number * 2; i++) drones.push(makeDrone(true));
    showBanner(`WAVE ${number}!`);
  }

  // ----- hitting things -----

  // Is there something solid at this point? (bolts, missiles and lasers stop here)
  function hitsSomething(x: number, y: number) {
    if (y >= GROUND_Y) return true;
    for (const drone of drones) if (drone.hp > 0 && Math.hypot(drone.x - x, drone.y - y) < 26) return true;
    for (const car of cars) if (car.wreckTimer <= 0 && Math.abs(car.x - x) < 32 && y > GROUND_Y - 34) return true;
    for (const tank of tanks) if (tank.alive && Math.abs(tank.x - x) < 24 && y > GROUND_Y - 58) return true;
    for (const column of columns) {
      if (x < column.x || x >= column.x + BLOCK) continue;
      for (const block of column.blocks) if (y >= block.y && y < block.y + BLOCK) return true;
    }
    return false;
  }

  // Damage everything within `radius` of a point
  function blast(x: number, y: number, radius: number, damage: number) {
    for (const drone of drones) {
      if (drone.hp > 0 && Math.hypot(drone.x - x, drone.y - y) < radius + 24) hitDrone(drone, damage);
    }
    for (const car of cars) {
      if (car.wreckTimer <= 0 && Math.abs(car.x - x) < radius + 30 && Math.abs(GROUND_Y - 16 - y) < radius + 16) wreckCar(car);
    }
    for (const tank of tanks) {
      if (tank.alive && Math.abs(tank.x - x) < radius + 22 && Math.abs(GROUND_Y - 28 - y) < radius + 28) {
        tank.hp -= damage;
        if (tank.hp <= 0) explodeTank(tank);
      }
    }
    for (const column of columns) {
      if (column.x + BLOCK < x - radius || column.x > x + radius) continue;
      for (const block of column.blocks.slice()) {
        const near = Math.abs(column.x + BLOCK / 2 - x) < radius + BLOCK / 2 && Math.abs(block.y + BLOCK / 2 - y) < radius + BLOCK / 2;
        if (near) hitBlock(column, block, damage);
      }
    }
  }

  function hitBlock(column: CityColumn, block: CityBlock, damage: number) {
    block.hp -= damage;
    if (block.hp > 0) return;
    column.blocks.splice(column.blocks.indexOf(block), 1); // the blocks above now fall
    const centerX = column.x + BLOCK / 2;
    const centerY = block.y + BLOCK / 2;
    addDebris(centerX, centerY, column.color, 5, 14);
    addSparks(centerX, centerY, "#ffc94a", 8);
    destroyed(POINTS.block, centerX, centerY);
  }

  function hitDrone(drone: Drone, damage: number) {
    drone.hp -= damage;
    drone.hitFlash = 6;
    if (drone.hp > 0) return;
    boom(drone.x, drone.y, 1.2);
    addDebris(drone.x, drone.y, "#4b5068", 6, 10);
    destroyed(POINTS.drone, drone.x, drone.y);
  }

  function wreckCar(car: Car) {
    car.wreckTimer = 360; // drives back in 6 seconds later
    boom(car.x, GROUND_Y - 16, 1.3);
    addDebris(car.x, GROUND_Y - 16, car.color, 4, 16);
    addDebris(car.x, GROUND_Y - 16, "#111111", 4, 9); // wheels
    destroyed(POINTS.car, car.x, GROUND_Y - 20);
  }

  // fuel tanks explode in a big ball that can set off the ones next to them
  function explodeTank(tank: FuelTank) {
    tank.alive = false;
    boom(tank.x, GROUND_Y - 28, 3);
    addDebris(tank.x, GROUND_Y - 28, "#b8c2cc", 8, 14);
    pendingBlasts.push({ x: tank.x, y: GROUND_Y - 40, radius: 150, damage: 6, delay: 10 });
    destroyed(POINTS.tank, tank.x, GROUND_Y - 60);
  }

  // Score, combo and special charge for anything destroyed
  function destroyed(points: number, x: number, y: number) {
    if (state !== "flying") return;
    destroyedCount++;
    chain = chainTimer > 0 ? chain + 1 : 1;
    chainTimer = 60;
    const gained = points * comboMultiplier();
    score += gained;
    // smashing things charges the special (but not while the unibeam is already firing)
    if (unibeamTime <= 0) specialCharge = Math.min(100, specialCharge + 0.4);
    // points float up for the bigger things (blocks break too often; it would be a mess)
    if (points > POINTS.block && popups.length < 25) popups.push({ x, y, text: `+${gained}`, life: 1 });
  }

  // every 12 things destroyed in a row adds x1, up to x5
  function comboMultiplier() {
    return Math.min(5, 1 + Math.floor(chain / 12));
  }

  function hurtPlayer() {
    if (player.invincible > 0 || unibeamTime > 0) return;
    player.shields--;
    player.invincible = 90;
    shake = 20;
    boom(player.x, player.y, 1);
    bump(shieldsValue);
    if (player.shields <= 0) {
      boom(player.x, player.y, 4);
      endMission();
    }
  }

  // ----- effects -----

  function boom(x: number, y: number, power: number) {
    for (let i = 0; i < 22 * power; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (1 + Math.random() * 5) * Math.sqrt(power);
      const color = pickOne(["#ffffff", "#ffc94a", "#ff8a3d", "#ff3b30"]);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, fade: 0.025, size: 2 + Math.random() * 4, color, glow: true });
    }
    for (let i = 0; i < 6 * power; i++) {
      const angle = Math.random() * Math.PI * 2;
      particles.push({ x, y, vx: Math.cos(angle) * 1.5, vy: Math.sin(angle) * 1.5 - 0.6, life: 1, fade: 0.012, size: 8 + Math.random() * 10, color: "rgba(60, 60, 75, 0.5)", glow: false });
    }
    rings.push({ x, y, radius: 6, maxRadius: 50 * power, life: 1 });
    shake = Math.max(shake, 3 * power);
  }

  function addSparks(x: number, y: number, color: string, amount: number) {
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, fade: 0.04, size: 1.5 + Math.random() * 2, color, glow: true });
    }
  }

  function addDebris(x: number, y: number, color: string, amount: number, size: number) {
    for (let i = 0; i < amount; i++) {
      debris.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 9,
        vy: -2 - Math.random() * 6,
        angle: Math.random() * 6,
        spin: (Math.random() - 0.5) * 0.4,
        size: size * (0.5 + Math.random() * 0.6),
        color,
        life: 1,
      });
    }
  }

  function bump(element: HTMLElement) {
    element.classList.remove("bump");
    void element.offsetWidth;
    element.classList.add("bump");
  }

  function showBanner(text: string) {
    banner.textContent = text;
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
  }

  // ----- weapons -----

  function suitPose(): SuitPose {
    const speed = Math.hypot(player.vx, player.vy);
    return {
      x: player.x,
      y: player.y,
      scale: SUIT_SIZE,
      tilt: player.tilt,
      facing: player.facing,
      aim: player.aim,
      thrust: Math.min(1, 0.3 + speed / stats.topSpeed),
      firing: player.firing,
      time: clock,
    };
  }

  // Things worth shooting that are on screen (for touch auto-aim and the missile swarm)
  function targetsOnScreen(): WorldPoint[] {
    const left = camX - 50;
    const right = camX + view.width + 50;
    const targets: WorldPoint[] = [];
    for (const drone of drones) if (drone.hp > 0 && drone.x > left && drone.x < right) targets.push({ x: drone.x, y: drone.y });
    for (const car of cars) if (car.wreckTimer <= 0 && car.x > left && car.x < right) targets.push({ x: car.x, y: GROUND_Y - 16 });
    for (const tank of tanks) if (tank.alive && tank.x > left && tank.x < right) targets.push({ x: tank.x, y: GROUND_Y - 28 });
    for (const column of columns) {
      const top = column.blocks[column.blocks.length - 1];
      if (top && column.x > left && column.x < right) targets.push({ x: column.x + BLOCK / 2, y: top.y + BLOCK / 2 });
    }
    return targets;
  }

  function nearestTarget(): WorldPoint | null {
    let best: WorldPoint | null = null;
    let bestDistance = 650;
    for (const target of targetsOnScreen()) {
      const distance = Math.hypot(target.x - player.x, target.y - player.y);
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  function fireWeapon(dt: number, aimPoint: WorldPoint) {
    const muzzle = suitMuzzle(suitPose());
    const dirX = Math.cos(player.aim);
    const dirY = Math.sin(player.aim);

    if (suit.weapon === "laser") {
      // a beam that melts the first thing it touches
      let end = { x: muzzle.x + dirX * 1100, y: muzzle.y + dirY * 1100 };
      for (let distance = 0; distance < 1100; distance += 8) {
        const x = muzzle.x + dirX * distance;
        const y = muzzle.y + dirY * distance;
        if (hitsSomething(x, y)) {
          end = { x, y };
          blast(x, y, 14, 0.13 * dt);
          addSparks(x, y, suit.eyes, 2);
          break;
        }
      }
      laserBeam = { from: muzzle, to: end };
      return;
    }

    player.fireTimer -= dt;
    if (player.fireTimer > 0) return;
    if (suit.weapon === "repulsors") {
      player.fireTimer = 7;
      shots.push({ kind: "bolt", x: muzzle.x, y: muzzle.y, vx: dirX * 24, vy: dirY * 24, targetX: 0, targetY: 0, life: 60 });
    } else {
      player.fireTimer = 24;
      shots.push({ kind: "missile", x: muzzle.x, y: muzzle.y, vx: dirX * 5, vy: dirY * 5, targetX: aimPoint.x, targetY: aimPoint.y, life: 150 });
    }
  }

  function fireSpecial() {
    if (state !== "flying" || specialCharge < 100) return;
    specialCharge = 0;
    showBanner(`${SPECIAL_NAMES[suit.special]}!`);
    if (suit.special === "unibeam") {
      unibeamTime = 80;
    } else if (suit.special === "shockwave") {
      blast(player.x, player.y, 300, 12);
      rings.push({ x: player.x, y: player.y, radius: 20, maxRadius: 420, life: 1 });
      rings.push({ x: player.x, y: player.y, radius: 10, maxRadius: 260, life: 1 });
      addSparks(player.x, player.y, suit.eyes, 80);
      shake = 30;
    } else {
      // twelve missiles burst out, each chasing something on screen
      const targets = targetsOnScreen().sort(() => Math.random() - 0.5);
      for (let i = 0; i < 12; i++) {
        const target = targets[i] ?? { x: player.x + player.facing * (200 + Math.random() * 500), y: GROUND_Y - 10 };
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        shots.push({ kind: "missile", x: player.x, y: player.y - 20, vx: Math.cos(angle) * 7, vy: Math.sin(angle) * 7, targetX: target.x, targetY: target.y, life: 200 });
      }
      shake = 10;
    }
  }

  // The chest beam: everything along it is wiped out
  function updateUnibeam(dt: number) {
    unibeamTime -= dt;
    shake = Math.max(shake, 7);
    const chest = { x: player.x + player.facing * 6, y: player.y - 10 };
    for (let distance = 30; distance < 1400; distance += 35) {
      blast(chest.x + Math.cos(player.aim) * distance, chest.y + Math.sin(player.aim) * distance, 40, 0.4 * dt);
    }
  }

  // ----- update (one frame; dt = 1 at 60fps) -----

  function screenToWorld(x: number, y: number): WorldPoint {
    return { x: camX + x / view.scale, y: y / view.scale - view.offsetY };
  }

  function updatePlayer(dt: number) {
    // which way to fly: keys, or toward a finger on a touch screen
    let inputX = 0;
    let inputY = 0;
    if (keys.has("arrowleft") || keys.has("a")) inputX -= 1;
    if (keys.has("arrowright") || keys.has("d")) inputX += 1;
    if (keys.has("arrowup") || keys.has("w")) inputY -= 1;
    if (keys.has("arrowdown") || keys.has("s")) inputY += 1;
    if (inputX && inputY) {
      inputX *= Math.SQRT1_2;
      inputY *= Math.SQRT1_2;
    }
    if (pointer.touch && pointer.down) {
      const finger = screenToWorld(pointer.x, pointer.y);
      const dx = finger.x - player.x;
      const dy = finger.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 20) {
        inputX = (dx / distance) * Math.min(1, distance / 150);
        inputY = (dy / distance) * Math.min(1, distance / 150);
      }
    }

    // speed up toward the wanted speed; low grip = slow to turn (drifty turbo thrusters)
    player.vx += (inputX * stats.topSpeed - player.vx) * stats.grip * dt;
    player.vy += (inputY * stats.topSpeed - player.vy) * stats.grip * dt;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (player.x < 40 || player.x > WORLD_WIDTH - 40) player.vx = 0;
    if (player.y < 70 || player.y > GROUND_Y - 60) player.vy = 0;
    player.x = clamp(player.x, 40, WORLD_WIDTH - 40);
    player.y = clamp(player.y, 70, GROUND_Y - 60);
    player.tilt += (clamp(player.vx / stats.topSpeed, -1, 1) * 0.9 - player.tilt) * 0.15 * dt;
    if (player.invincible > 0) player.invincible -= dt;

    // aim: at the mouse, or (touch) at the nearest target
    let aimPoint: WorldPoint = { x: player.x + player.facing * 300, y: player.y };
    player.firing = false;
    if (pointer.touch) {
      const target = nearestTarget();
      if (target) aimPoint = target;
      player.firing = pointer.down && !!target;
    } else if (pointer.moved) {
      aimPoint = screenToWorld(pointer.x, pointer.y);
      player.firing = pointer.down;
    }
    player.facing = aimPoint.x >= player.x ? 1 : -1;
    const shoulder = suitShoulder(suitPose());
    player.aim = Math.atan2(aimPoint.y - shoulder.y, aimPoint.x - shoulder.x);

    laserBeam = null;
    if (player.firing) fireWeapon(dt, aimPoint);
    if (unibeamTime > 0) updateUnibeam(dt);

    // heavy armor smashes through anything it flies into
    if (stats.smash && Math.hypot(player.vx, player.vy) > 3) blast(player.x, player.y, 24, 0.6 * dt);

    specialCharge = Math.min(100, specialCharge + 0.05 * dt);
  }

  function updateMode(dt: number) {
    if (chainTimer > 0) chainTimer -= dt;

    if (mode === "demolition") {
      timeLeft -= dt;
      timerBox.classList.toggle("is-urgent", timeLeft < 10 * 60);
      if (timeLeft <= 0) {
        timeLeft = 0;
        endMission();
      }
    }

    if (mode === "defense") {
      // a wave is over when every drone is gone; take a short break, get a shield back
      if (drones.length === 0 && !betweenWaves) {
        betweenWaves = true;
        waveBreak = wave === 0 ? 60 : 150;
        if (wave > 0) {
          showBanner("WAVE CLEARED!");
          player.shields = Math.min(stats.shields, player.shields + 1);
          bump(shieldsValue);
        }
      }
      if (betweenWaves) {
        waveBreak -= dt;
        if (waveBreak <= 0) {
          betweenWaves = false;
          startWave(wave + 1);
        }
      }
    } else if (drones.length < 6 && Math.random() < 0.01 * dt) {
      drones.push(makeDrone(false)); // new drones keep floating in
    }
  }

  function update(dt: number) {
    if (state === "flying") {
      updatePlayer(dt);
      updateMode(dt);
      const goal = clamp(player.x - view.width / 2, 0, Math.max(0, WORLD_WIDTH - view.width));
      camX += (goal - camX) * 0.1 * dt;
    } else {
      // behind the menus, the camera drifts slowly over the city
      laserBeam = null;
      camX += idleDirection * 0.8 * dt;
      if (camX > WORLD_WIDTH - view.width || camX < 0) idleDirection *= -1;
      camX = clamp(camX, 0, Math.max(0, WORLD_WIDTH - view.width));
    }

    // falling blocks: each block drops until it sits on the one below
    for (const column of columns) {
      column.blocks.forEach((block, index) => {
        const rest = restY(index);
        if (block.y >= rest) return;
        block.vy += 0.5 * dt;
        block.y += block.vy * dt;
        if (block.y >= rest) {
          if (block.vy > 6 && Math.random() < 0.3) {
            particles.push({ x: column.x + BLOCK / 2, y: rest + BLOCK, vx: (Math.random() - 0.5) * 3, vy: -0.5, life: 1, fade: 0.02, size: 8, color: "rgba(120, 120, 140, 0.35)", glow: false });
          }
          block.y = rest;
          block.vy = 0;
        }
      });
    }

    for (const car of cars) {
      if (car.wreckTimer > 0) {
        car.wreckTimer -= dt;
        // drive back in somewhere off screen
        if (car.wreckTimer <= 0) car.x = (camX + view.width + 200 + Math.random() * 2000) % WORLD_WIDTH;
        continue;
      }
      car.x += car.dir * car.speed * dt;
      if (car.x < -60) car.x = WORLD_WIDTH + 60;
      if (car.x > WORLD_WIDTH + 60) car.x = -60;
    }

    for (const drone of drones) {
      drone.age += dt;
      drone.hitFlash = Math.max(0, drone.hitFlash - dt);
      let goalX = drone.homeX + Math.sin(drone.age * 0.01) * 160;
      let goalY = drone.homeY + Math.sin(drone.age * 0.023) * 50;
      if (drone.hunter && state === "flying") {
        // circle around the suit and shoot at it
        const angle = drone.age * 0.012 + drone.homeX;
        goalX = player.x + Math.cos(angle) * 300;
        goalY = clamp(player.y - 60 + Math.sin(angle * 1.3) * 160, 80, GROUND_Y - 100);
        drone.fireTimer -= dt;
        const onScreen = drone.x > camX && drone.x < camX + view.width;
        if (drone.fireTimer <= 0 && onScreen) {
          drone.fireTimer = Math.max(45, 130 - wave * 8);
          const angleToPlayer = Math.atan2(player.y - drone.y, player.x - drone.x);
          droneShots.push({ x: drone.x, y: drone.y, vx: Math.cos(angleToPlayer) * 6.5, vy: Math.sin(angleToPlayer) * 6.5, life: 200 });
        }
      }
      drone.vx = clamp((drone.vx + (goalX - drone.x) * 0.002 * dt) * 0.97, -6, 6);
      drone.vy = clamp((drone.vy + (goalY - drone.y) * 0.002 * dt) * 0.97, -6, 6);
      drone.x += drone.vx * dt;
      drone.y += drone.vy * dt;
    }

    updateShots(dt);

    for (const shot of droneShots) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (state === "flying" && Math.hypot(shot.x - player.x, shot.y - player.y) < 32) {
        shot.life = 0;
        hurtPlayer();
      }
    }

    // fuel tank chain reactions go off a moment after each other
    for (const pending of pendingBlasts) {
      pending.delay -= dt;
      if (pending.delay <= 0) blast(pending.x, pending.y, pending.radius, pending.damage);
    }
    pendingBlasts = pendingBlasts.filter((p) => p.delay > 0);

    for (const piece of debris) {
      piece.vy += 0.4 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;
      if (piece.y > GROUND_Y - piece.size / 2) {
        // bounce on the street, losing speed each time
        piece.y = GROUND_Y - piece.size / 2;
        piece.vy *= -0.35;
        piece.vx *= 0.7;
        piece.spin *= 0.7;
      }
      piece.life -= 0.006 * dt;
    }

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= p.fade * dt;
    }

    for (const ring of rings) {
      ring.radius += (ring.maxRadius - ring.radius) * 0.15 * dt;
      ring.life -= 0.04 * dt;
    }

    for (const popup of popups) {
      popup.y -= 0.8 * dt;
      popup.life -= 0.02 * dt;
    }

    shake *= 0.88;

    // remove what's finished (and keep the effect lists from growing too big)
    drones = drones.filter((d) => d.hp > 0);
    droneShots = droneShots.filter((s) => s.life > 0 && s.y < GROUND_Y);
    debris = debris.filter((d) => d.life > 0).slice(-400);
    particles = particles.filter((p) => p.life > 0).slice(-1500);
    rings = rings.filter((r) => r.life > 0);
    popups = popups.filter((p) => p.life > 0);
  }

  function updateShots(dt: number) {
    for (const shot of shots) {
      if (shot.kind === "missile") {
        // speed up and turn gradually toward the target
        const speed = Math.min(15, Math.hypot(shot.vx, shot.vy) + 0.5 * dt);
        const heading = Math.atan2(shot.vy, shot.vx);
        let turn = Math.atan2(shot.targetY - shot.y, shot.targetX - shot.x) - heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn)); // the shortest way round
        const newHeading = heading + clamp(turn, -0.12 * dt, 0.12 * dt);
        shot.vx = Math.cos(newHeading) * speed;
        shot.vy = Math.sin(newHeading) * speed;
        particles.push({ x: shot.x, y: shot.y, vx: 0, vy: -0.3, life: 0.7, fade: 0.03, size: 4, color: "rgba(200, 200, 215, 0.35)", glow: false });
      }

      // move in small steps so fast shots can't skip through a block
      const steps = Math.ceil((Math.hypot(shot.vx, shot.vy) * dt) / 12);
      for (let i = 0; i < steps && shot.life > 0; i++) {
        shot.x += (shot.vx * dt) / steps;
        shot.y += (shot.vy * dt) / steps;
        const reachedTarget = shot.kind === "missile" && Math.hypot(shot.targetX - shot.x, shot.targetY - shot.y) < 16;
        if (hitsSomething(shot.x, shot.y) || reachedTarget) {
          shot.life = 0;
          if (shot.kind === "bolt") {
            blast(shot.x, shot.y, 18, 1.2);
            addSparks(shot.x, shot.y, suit.eyes, 6);
          } else {
            blast(shot.x, shot.y, 80, 3);
            boom(shot.x, shot.y, 1.5);
          }
        }
      }
      shot.life -= dt;
    }
    shots = shots.filter((s) => s.life > 0);
  }

  // ----- drawing -----

  function draw() {
    const width = world.size.width;
    const height = world.size.height;
    ctx.clearRect(0, 0, width, height);
    drawSky(width, height);

    ctx.save();
    ctx.scale(view.scale, view.scale);
    ctx.translate(0, view.offsetY);
    if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawSkyline(farSkyline, 0.2, 90, "#151935", false);
    drawSearchlights();
    drawSkyline(midSkyline, 0.45, 70, "#1d2244", true);

    ctx.translate(-camX, 0);
    drawCity();
    drawStreet();
    for (const car of cars) if (car.wreckTimer <= 0) drawCar(car);
    for (const drone of drones) drawDrone(drone);
    drawDebris();

    // glowing things add their light together
    ctx.globalCompositeOperation = "lighter";
    drawShots();
    for (const shot of droneShots) glowDot(ctx, shot.x, shot.y, 6, "#ff3b30");
    if (laserBeam) drawLaser(laserBeam.from, laserBeam.to);
    if (unibeamTime > 0 && state === "flying") drawUnibeam();
    for (const ring of rings) {
      ctx.globalAlpha = Math.max(ring.life, 0);
      ctx.strokeStyle = "#ffc94a";
      ctx.lineWidth = 6 * ring.life + 1;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawParticles();
    ctx.globalCompositeOperation = "source-over";

    // the suit blinks while it's safe after a hit
    const blinking = player.invincible > 0 && Math.floor(player.invincible / 5) % 2 === 0;
    if (state === "flying" && !blinking) drawSuit(ctx, suit, suitPose());

    drawPopups();
    ctx.restore();
  }

  function drawSky(width: number, height: number) {
    const groundOnScreen = (GROUND_Y + view.offsetY) * view.scale;
    const sky = ctx.createLinearGradient(0, 0, 0, groundOnScreen);
    sky.addColorStop(0, "#060818");
    sky.addColorStop(0.55, "#251a4d");
    sky.addColorStop(0.85, "#8a3a6a");
    sky.addColorStop(1, "#ff8a4d");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // twinkling stars
    for (const star of stars) {
      ctx.globalAlpha = 0.4 + Math.sin(clock * 2 + star.phase) * 0.4;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(star.x * width, star.y * groundOnScreen, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    // the moon barely moves as you fly (it's very far away)
    const moonX = width * 0.78 - camX * 0.02 * view.scale;
    const moonY = groundOnScreen * 0.2;
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 110 * view.scale);
    moonGlow.addColorStop(0, "rgba(255, 240, 220, 0.9)");
    moonGlow.addColorStop(0.35, "rgba(255, 220, 190, 0.6)");
    moonGlow.addColorStop(0.4, "rgba(255, 200, 170, 0.12)");
    moonGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = moonGlow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 110 * view.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // A row of far-away buildings that slides by slower than the city (parallax)
  function drawSkyline(heights: number[], depth: number, buildingWidth: number, color: string, withWindows: boolean) {
    const offset = camX * depth + clock * 2;
    const first = Math.floor(offset / buildingWidth);
    const count = Math.ceil(view.width / buildingWidth) + 2;
    for (let i = first; i < first + count; i++) {
      const height = heights[((i % heights.length) + heights.length) % heights.length]!;
      const x = i * buildingWidth - offset;
      ctx.fillStyle = color;
      ctx.fillRect(x, GROUND_Y - height, buildingWidth - 6, height);
      if (!withWindows) continue;
      ctx.fillStyle = "rgba(255, 210, 122, 0.35)";
      for (let row = 1; row * 22 < height - 10; row++) {
        if ((i * 7 + row * 3) % 4 === 0) ctx.fillRect(x + 10, GROUND_Y - height + row * 22, 6, 8);
        if ((i * 5 + row * 11) % 3 === 0) ctx.fillRect(x + 34, GROUND_Y - height + row * 22, 6, 8);
      }
    }
  }

  // two sweeping searchlight beams
  function drawSearchlights() {
    ctx.globalCompositeOperation = "lighter";
    [0.3, 0.72].forEach((spot, i) => {
      const x = view.width * spot;
      const angle = -Math.PI / 2 + Math.sin(clock * 0.5 + i * 2) * 0.55;
      ctx.save();
      ctx.translate(x, GROUND_Y);
      ctx.rotate(angle);
      const beam = ctx.createLinearGradient(0, 0, 800, 0);
      beam.addColorStop(0, "rgba(255, 240, 200, 0.18)");
      beam.addColorStop(1, "rgba(255, 240, 200, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(800, -60);
      ctx.lineTo(800, 60);
      ctx.fill();
      ctx.restore();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  function drawCity() {
    const left = camX - BLOCK;
    const right = camX + view.width;
    for (const column of columns) {
      if (column.x < left || column.x > right) continue;
      column.blocks.forEach((block, index) => {
        ctx.fillStyle = column.color;
        ctx.fillRect(column.x, block.y, BLOCK, BLOCK);
        // four windows per block
        block.windows.forEach((lit, w) => {
          ctx.fillStyle = lit ? "#ffd27a" : "rgba(0, 0, 0, 0.35)";
          ctx.fillRect(column.x + 7 + (w % 2) * 16, block.y + 7 + Math.floor(w / 2) * 16, 10, 10);
        });
        ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
        ctx.fillRect(column.x, block.y + BLOCK - 2, BLOCK, 2); // floor line
        // damaged blocks darken and crack
        if (block.hp < 3) {
          ctx.fillStyle = `rgba(0, 0, 0, ${(3 - block.hp) * 0.18})`;
          ctx.fillRect(column.x, block.y, BLOCK, BLOCK);
          ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(column.x + 6, block.y + 4);
          ctx.lineTo(column.x + 20, block.y + 22);
          ctx.lineTo(column.x + 14, block.y + 36);
          ctx.stroke();
        }
        // roof edge on the top block
        if (index === column.blocks.length - 1) {
          ctx.fillStyle = shade(column.color, 0.25);
          ctx.fillRect(column.x, block.y - 4, BLOCK, 4);
        }
      });
    }

    // fuel tanks
    for (const tank of tanks) {
      if (!tank.alive || tank.x < left || tank.x > right + BLOCK) continue;
      ctx.fillStyle = tank.hp < 2 && Math.sin(clock * 20) > 0 ? "#ffffff" : "#b8c2cc";
      suitRoundedRect(ctx, tank.x - 22, GROUND_Y - 56, 44, 56, 10);
      ctx.fill();
      ctx.fillStyle = "#ff3b30";
      ctx.fillRect(tank.x - 22, GROUND_Y - 44, 44, 6);
      ctx.fillRect(tank.x - 22, GROUND_Y - 22, 44, 6);
      ctx.fillStyle = "#ffc94a";
      ctx.beginPath();
      ctx.moveTo(tank.x, GROUND_Y - 36);
      ctx.lineTo(tank.x + 7, GROUND_Y - 25);
      ctx.lineTo(tank.x - 7, GROUND_Y - 25);
      ctx.fill();
    }
  }

  function drawStreet() {
    ctx.fillStyle = "#2c3352";
    ctx.fillRect(camX - 20, GROUND_Y, view.width + 40, 8); // sidewalk edge
    ctx.fillStyle = "#12152a";
    ctx.fillRect(camX - 20, GROUND_Y + 8, view.width + 40, WORLD_HEIGHT);
    ctx.fillStyle = "#ffc94a";
    for (let x = Math.floor(camX / 90) * 90; x < camX + view.width + 90; x += 90) {
      ctx.fillRect(x, GROUND_Y + 48, 44, 5); // lane dashes
    }
  }

  function drawCar(car: Car) {
    ctx.save();
    ctx.translate(car.x, GROUND_Y);
    ctx.scale(car.dir, 1);
    ctx.fillStyle = car.color;
    suitRoundedRect(ctx, -30, -22, 60, 16, 6);
    ctx.fill();
    suitRoundedRect(ctx, -16, -34, 28, 14, 6);
    ctx.fill();
    ctx.fillStyle = "#9fd8ff";
    ctx.fillRect(-12, -31, 10, 8);
    ctx.fillRect(1, -31, 9, 8);
    ctx.fillStyle = "#111111";
    for (const wheelX of [-18, 18]) {
      ctx.beginPath();
      ctx.arc(wheelX, -6, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, 30, -15, 3, "#fff3b0"); // headlight
    glowDot(ctx, -30, -15, 2, "#ff3b30"); // tail light
    ctx.restore();
  }

  function drawDrone(drone: Drone) {
    ctx.save();
    ctx.translate(drone.x, drone.y);
    // spinning rotor blades on top
    ctx.strokeStyle = "rgba(200, 210, 230, 0.7)";
    ctx.lineWidth = 2;
    const blade = Math.cos(drone.age * 0.6) * 22;
    ctx.beginPath();
    ctx.moveTo(-blade, -24);
    ctx.lineTo(blade, -24);
    ctx.stroke();
    ctx.fillStyle = drone.hitFlash > 0 ? "#ffffff" : "#4b5068";
    ctx.strokeStyle = drone.hunter ? "#ff3b30" : "#b47bff";
    ctx.lineWidth = 3;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + drone.age * 0.02;
      ctx.lineTo(Math.cos(angle) * 20, Math.sin(angle) * 20);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, 0, 0, 5, "#ff2a2a");
    ctx.restore();
  }

  function drawDebris() {
    for (const piece of debris) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, piece.life * 3);
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.angle);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
      ctx.restore();
    }
  }

  function drawShots() {
    for (const shot of shots) {
      if (shot.kind === "bolt") {
        ctx.strokeStyle = suit.eyes;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(shot.x, shot.y);
        ctx.lineTo(shot.x - shot.vx * 1.5, shot.y - shot.vy * 1.5);
        ctx.stroke();
        glowDot(ctx, shot.x, shot.y, 4, suit.eyes);
      } else {
        glowDot(ctx, shot.x, shot.y, 5, "#ff8a3d"); // missile flame
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(shot.x, shot.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawLaser(from: WorldPoint, to: WorldPoint) {
    const wobble = Math.random() * 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = suit.eyes;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 16 + wobble;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineCap = "butt";
    glowDot(ctx, to.x, to.y, 10 + wobble * 2, suit.eyes);
  }

  function drawUnibeam() {
    const strength = Math.min(1, unibeamTime / 20);
    const beamHeight = 90 * strength + Math.random() * 12;
    ctx.save();
    ctx.translate(player.x + player.facing * 6, player.y - 10);
    ctx.rotate(player.aim);
    const beam = ctx.createLinearGradient(0, -beamHeight / 2, 0, beamHeight / 2);
    beam.addColorStop(0, "rgba(0, 0, 0, 0)");
    beam.addColorStop(0.3, suit.eyes);
    beam.addColorStop(0.5, "#ffffff");
    beam.addColorStop(0.7, suit.eyes);
    beam.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = beam;
    ctx.fillRect(0, -beamHeight / 2, 1400, beamHeight);
    glowDot(ctx, 0, 0, 24 * strength + 8, suit.eyes);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      // sparks shrink as they fade; smoke puffs grow
      const radius = p.glow ? p.size * p.life + 0.5 : p.size * (2 - p.life);
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.font = "900 20px Orbitron, sans-serif";
    ctx.textAlign = "center";
    for (const popup of popups) {
      ctx.globalAlpha = Math.max(popup.life, 0);
      ctx.fillStyle = "#ffc94a";
      ctx.fillText(popup.text, popup.x, popup.y);
    }
    ctx.globalAlpha = 1;
  }

  function updateHud() {
    scoreValue.textContent = (mode === "free" ? destroyedCount : score).toLocaleString();
    timerValue.textContent = mode === "demolition" ? String(Math.ceil(timeLeft / 60)) : String(wave);
    shieldsValue.textContent = player.shields > 0 ? "♥".repeat(player.shields) : "-";
    const multiplier = comboMultiplier();
    comboBox.textContent = `COMBO x${multiplier}`;
    comboBox.classList.toggle("is-on", multiplier > 1 && chainTimer > 0);
    specialFill.style.width = `${specialCharge}%`;
    specialButton.classList.toggle("is-ready", specialCharge >= 100);
  }

  // ----- main loop -----

  let lastTime = performance.now();
  function frame(now: number) {
    // dt = how many 60fps frames passed (capped so a slow frame can't teleport things)
    const dt = Math.min((now - lastTime) / (1000 / 60), 3);
    lastTime = now;
    clock += dt / 60;
    world.sync(); // final check every frame that the canvas matches the play area
    if (document.body.dataset.phase !== "garage") {
      update(dt);
      draw();
      if (state === "flying") updateHud();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { showModes };
}
