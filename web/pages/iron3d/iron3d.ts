// Iron Strike 3D: fly a real 3D Iron Man suit over a city at sunset and stop a drone armada.
//
// How a game goes:
//   - the suit stands on the roof of Armory Tower in the middle of the city
//   - 3-2-1-GO! and it blasts off; waves of drones fly in, and they get tougher every wave
//   - every 4th wave a giant DREADNOUGHT drone arrives (it has a health bar and launches drones)
//   - gold rings in the sky give points, repair the armor, refill the boost and charge the unibeam
//   - when the armor hits 0 the suit goes down, and the mission report shows your score
//
// Controls:
//   mouse: steer toward the mouse, hold click to fire repulsors, right-click = missiles
//   keys:  WASD / arrows steer, SHIFT boost, F fire, E missiles, SPACE unibeam, P pause, M mute,
//          V switches between the helmet view (first person) and the chase camera
//   touch: drag anywhere to steer (a joystick appears); the suit fires by itself; buttons for
//          boost, missiles and unibeam
//
// The 3D is drawn with Three.js (libs/three.min.js, a global THREE). Everything in the world
// (city, suit, drones) is built from simple shapes in code, so there are no model files to load.
//
// The code, top to bottom:
//   settings and helpers, sound, glowing points (particles, traffic, beacons),
//   the scene (sky, city, tower), the suit, drones, weapons, rings, waves, camera, HUD, game flow.

// Everything lives inside this namespace so its names can't clash with the other pages'
// scripts (TypeScript checks all of the site's scripts together).
namespace Iron3D {
  // ===========================================================================
  // Settings
  // ===========================================================================

  const BLOCK = 60; // one city block: a building lot plus half of the street around it
  const LOT = 42; // the part of a block that buildings stand on
  const CITY_BLOCKS = 12; // the city reaches this many blocks out from the middle
  const ZONE_RADIUS = 820; // fly farther out than this and the suit turns you back
  const TOWER_HEIGHT = 210; // Armory Tower, in the middle of the city
  const DECK_TOP = TOWER_HEIGHT + 8; // top of the tower's flared roof
  const PAD_TOP = DECK_TOP + 0.6; // the landing pad the suit launches from
  const SUIT_CENTER = 0.95; // the suit's middle is this far above its feet

  const MIN_ALTITUDE = 4;
  const MAX_ALTITUDE = 420;
  const CRUISE_SPEED = 58;
  const BOOST_SPEED = 128;
  const TURN_RATE = 1.7; // radians per second at full steering
  const CLIMB_RATE = 1.25;
  const MAX_PITCH = 1.15;
  const FLIGHT_LEAN = 1.35; // how far the suit leans forward in flight (radians)

  const BOLT_SPEED = 330;
  const FIRE_RATE = 9; // repulsor shots per second
  const MISSILE_COOLDOWN = 6; // seconds
  const BEAM_SECONDS = 2.4;
  const BEAM_LENGTH = 700;

  const BEST_KEY = "iron3d-best";
  const MUTE_KEY = "iron3d-muted";
  const VIEW_KEY = "iron3d-chase-view"; // 1 = the player picked the chase camera instead of the helmet

  type Phase = "start" | "countdown" | "playing" | "paused" | "down" | "over";
  type DroneKind = "scout" | "gunner" | "boss";

  // ===========================================================================
  // Little helpers
  // ===========================================================================

  const rand = (min: number, max: number) => min + Math.random() * (max - min);
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

  // Moves `current` smoothly toward `target`, with the same feel at any frame rate
  const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

  // A color brighter than white. Anything brighter than about 1 glows (the "bloom" effect).
  function hot(hex: string, power: number) {
    return new THREE.Color(hex).multiplyScalar(power);
  }

  function wrapAngle(angle: number) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function el<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id) as T;
  }

  // Only touch the page when the text actually changes (the HUD updates every frame)
  function setText(element: HTMLElement, text: string) {
    if (element.textContent !== text) element.textContent = text;
  }

  // Plays a CSS animation again from the start
  function restartAnimation(element: HTMLElement, className: string) {
    element.classList.remove(className);
    void element.offsetWidth; // makes the browser notice the class was removed
    element.classList.add(className);
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
      // private browsing can block storage; the game still works without it
    }
  }

  // Does the line from a to b pass within `radius` of center? (used for fast-moving shots,
  // which can jump right over a target in a single frame)
  const segmentTemp = new THREE.Vector3();
  function segmentHitsSphere(a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3, radius: number) {
    return closestPointOnSegment(a, b, center, segmentTemp).distanceToSquared(center) < radius * radius;
  }

  // The point on the line from a to b that comes closest to `point`
  function closestPointOnSegment(a: THREE.Vector3, b: THREE.Vector3, point: THREE.Vector3, out: THREE.Vector3) {
    const abX = b.x - a.x, abY = b.y - a.y, abZ = b.z - a.z;
    const lengthSq = abX * abX + abY * abY + abZ * abZ || 1;
    const t = clamp(((point.x - a.x) * abX + (point.y - a.y) * abY + (point.z - a.z) * abZ) / lengthSq, 0, 1);
    return out.set(a.x + abX * t, a.y + abY * t, a.z + abZ * t);
  }

  // The direction the suit is heading (yaw turns left/right, pitch tilts up/down)
  function forwardFrom(yaw: number, pitch: number, out: THREE.Vector3) {
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  const UP = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  // ===========================================================================
  // Page elements
  // ===========================================================================

  const page = {
    stage: el("stage"),
    canvas: el<HTMLCanvasElement>("world"),
    score: el("hud-score"),
    wave: el("hud-wave"),
    combo: el("hud-combo"),
    armorFill: el("armor-fill"),
    armorText: el("armor-text"),
    armorBox: el("armor-box"),
    boostFill: el("boost-fill"),
    missileFill: el("missile-fill"),
    missileBox: el("missile-box"),
    beamButton: el("beam-button"),
    beamFill: el("beam-fill"),
    beamText: el("beam-text"),
    bossBar: el("boss-bar"),
    bossFill: el("boss-fill"),
    banner: el("banner"),
    comms: el("comms"),
    zoneWarning: el("zone-warning"),
    markers: el("markers"),
    popups: el("popups"),
    heading: el("heading"),
    hitmarker: el("hitmarker"),
    hurt: el("hurt"),
    countdown: el("countdown"),
    countdownNumber: el("countdown-number"),
    bestScore: el("best-score"),
    reportTitle: el("report-title"),
    reportScore: el("report-score"),
    reportWave: el("report-wave"),
    reportKills: el("report-kills"),
    reportCombo: el("report-combo"),
    reportBest: el("report-best"),
    radar: el<HTMLCanvasElement>("radar"),
    stick: el("stick"),
    stickKnob: el("stick-knob"),
    touchBoost: el("touch-boost"),
    touchMissiles: el("touch-missiles"),
    muteButton: el("mute-button"),
    viewButton: el("view-button"),
  };

  // ===========================================================================
  // Sound: every sound is made in code with the Web Audio API (no sound files)
  // ===========================================================================

  class SoundBoard {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private whiteNoise: AudioBuffer | null = null;
    private humGain: GainNode | null = null;
    private humFilter: BiquadFilterNode | null = null;
    private lastZap = 0;
    muted = readNumber(MUTE_KEY) === 1;

    // Browsers only allow sound after a click or key press, so the Launch button calls this
    unlock() {
      if (!this.ctx) {
        if (!window.AudioContext) return;
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(ctx.destination);

        // white noise (hiss) for explosions and whooshes, deep rumbling noise for the thrusters
        const length = ctx.sampleRate * 2;
        this.whiteNoise = ctx.createBuffer(1, length, ctx.sampleRate);
        const rumble = ctx.createBuffer(1, length, ctx.sampleRate);
        const white = this.whiteNoise.getChannelData(0);
        const deep = rumble.getChannelData(0);
        let last = 0;
        for (let i = 0; i < length; i++) {
          white[i] = Math.random() * 2 - 1;
          last = (last + 0.02 * white[i]!) / 1.02;
          deep[i] = last * 3.5;
        }

        // the thruster hum plays all the time; thrust() turns it up and down
        const hum = ctx.createBufferSource();
        hum.buffer = rumble;
        hum.loop = true;
        this.humFilter = ctx.createBiquadFilter();
        this.humFilter.type = "lowpass";
        this.humFilter.frequency.value = 200;
        this.humGain = ctx.createGain();
        this.humGain.gain.value = 0;
        hum.connect(this.humFilter).connect(this.humGain).connect(this.master);
        hum.start();
      }
      this.ctx.resume().catch(() => {});
    }

    setMuted(muted: boolean) {
      this.muted = muted;
      saveNumber(MUTE_KEY, muted ? 1 : 0);
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }

    // A beep that slides from one pitch to another and fades out
    private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
      if (!this.ctx || !this.master) return;
      const start = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(from, start);
      osc.frequency.exponentialRampToValueAtTime(to, start + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.max(volume, 0.0001), start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    }

    // A burst of hiss through a sweeping filter (explosions, whooshes)
    private noise(duration: number, volume: number, from: number, to: number, type: BiquadFilterType = "lowpass") {
      if (!this.ctx || !this.master || !this.whiteNoise) return;
      const start = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      source.buffer = this.whiteNoise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(from, start);
      filter.frequency.exponentialRampToValueAtTime(to, start + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.max(volume, 0.0001), start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(start);
      source.stop(start + duration + 0.05);
    }

    zap() {
      const now = performance.now();
      if (now - this.lastZap < 55) return;
      this.lastZap = now;
      this.tone("square", 1500, 320, 0.08, 0.03);
      this.tone("sine", 2600, 900, 0.06, 0.03);
    }

    boom(power: number, distance: number) {
      const volume = clamp((power * 0.5) / (1 + distance / 140), 0.02, 0.9);
      this.noise(0.5 + power * 0.2, volume, 2200, 80);
      this.tone("sine", 120, 30, 0.45 + power * 0.1, volume);
    }

    missile() {
      this.noise(0.7, 0.14, 500, 3500, "bandpass");
    }

    ring() {
      this.tone("sine", 988, 988, 0.18, 0.1);
      this.tone("sine", 1480, 1480, 0.32, 0.08, 0.07);
    }

    hurt() {
      this.tone("sawtooth", 240, 60, 0.3, 0.1);
      this.noise(0.2, 0.12, 3000, 500);
    }

    beam() {
      this.tone("sawtooth", 70, 150, BEAM_SECONDS, 0.1);
      this.tone("square", 140, 300, BEAM_SECONDS, 0.04);
      this.noise(BEAM_SECONDS, 0.16, 600, 2600, "bandpass");
    }

    launch() {
      this.noise(1.5, 0.3, 200, 2000, "bandpass");
      this.tone("sawtooth", 55, 190, 1.3, 0.09);
    }

    beep(high = false) {
      this.tone("square", high ? 1320 : 880, high ? 1320 : 880, 0.12, 0.04);
    }

    // The thruster hum: 0 = silent, 1 = full boost
    thrust(level: number) {
      if (!this.ctx || !this.humGain || !this.humFilter) return;
      const now = this.ctx.currentTime;
      this.humGain.gain.setTargetAtTime(level * 0.22, now, 0.12);
      this.humFilter.frequency.setTargetAtTime(160 + level * 900, now, 0.12);
    }
  }

  const sound = new SoundBoard();

  // ===========================================================================
  // Glowing points: hundreds of glowing dots drawn in one go.
  // Used for explosions, sparks, thruster exhaust, car lights and rooftop beacons.
  // Each dot has a position, color, size (in world units) and brightness.
  // ===========================================================================

  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 } }, // screen pixels per world unit at distance 1 (set on resize)
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -viewPosition.z; // farther away = smaller
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float distanceFromMiddle = length(gl_PointCoord - 0.5) * 2.0;
        float glow = pow(max(1.0 - distanceFromMiddle, 0.0), 1.6); // soft round dot
        gl_FragColor = vec4(vColor * glow * vAlpha, 1.0);
      }`,
    blending: THREE.AdditiveBlending, // overlapping light adds up
    depthWrite: false,
    transparent: true,
  });

  class GlowPoints {
    readonly max: number;
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly sizes: Float32Array;
    readonly alphas: Float32Array;
    readonly points: THREE.Points;
    count = 0;
    private readonly geometry = new THREE.BufferGeometry();

    constructor(max: number) {
      this.max = max;
      this.positions = new Float32Array(max * 3);
      this.colors = new Float32Array(max * 3);
      this.sizes = new Float32Array(max);
      this.alphas = new Float32Array(max);
      const add = (name: string, array: Float32Array, itemSize: number) => {
        const attribute = new THREE.BufferAttribute(array, itemSize);
        attribute.setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute(name, attribute);
      };
      add("position", this.positions, 3);
      add("aColor", this.colors, 3);
      add("aSize", this.sizes, 1);
      add("aAlpha", this.alphas, 1);
      this.points = new THREE.Points(this.geometry, glowMaterial);
      this.points.frustumCulled = false; // the dots move all over, so always draw them
    }

    set(i: number, x: number, y: number, z: number, color: THREE.Color, size: number, alpha: number) {
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
      this.sizes[i] = size;
      this.alphas[i] = alpha;
    }

    // Send the changed dots to the graphics card
    upload() {
      this.geometry.setDrawRange(0, this.count);
      for (const name of ["position", "aColor", "aSize", "aAlpha"]) this.geometry.getAttribute(name).needsUpdate = true;
    }
  }

  // Particles: glowing dots that fly, slow down, fall, shrink and fade
  class Particles {
    readonly dots: GlowPoints;
    private readonly velocity: Float32Array;
    private readonly life: Float32Array;
    private readonly maxLife: Float32Array;
    private readonly startSize: Float32Array;
    private readonly endSize: Float32Array;
    private readonly drag: Float32Array;
    private readonly gravity: Float32Array;
    private readonly brightness: Float32Array;

    constructor(max: number) {
      this.dots = new GlowPoints(max);
      this.velocity = new Float32Array(max * 3);
      this.life = new Float32Array(max);
      this.maxLife = new Float32Array(max);
      this.startSize = new Float32Array(max);
      this.endSize = new Float32Array(max);
      this.drag = new Float32Array(max);
      this.gravity = new Float32Array(max);
      this.brightness = new Float32Array(max);
    }

    spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, startSize: number, endSize: number, color: THREE.Color, drag = 2, gravity = 0, brightness = 1) {
      const dots = this.dots;
      // when full, reuse a random dot (nobody notices one spark vanishing)
      const i = dots.count < dots.max ? dots.count++ : Math.floor(Math.random() * dots.max);
      dots.set(i, x, y, z, color, startSize, brightness);
      this.velocity[i * 3] = vx;
      this.velocity[i * 3 + 1] = vy;
      this.velocity[i * 3 + 2] = vz;
      this.life[i] = life;
      this.maxLife[i] = life;
      this.startSize[i] = startSize;
      this.endSize[i] = endSize;
      this.drag[i] = drag;
      this.gravity[i] = gravity;
      this.brightness[i] = brightness;
    }

    update(dt: number) {
      const dots = this.dots;
      const p = dots.positions;
      const v = this.velocity;
      for (let i = 0; i < dots.count; i++) {
        this.life[i]! -= dt;
        if (this.life[i]! <= 0) {
          this.moveLastInto(i);
          i--;
          continue;
        }
        const slow = Math.exp(-this.drag[i]! * dt);
        v[i * 3]! *= slow;
        v[i * 3 + 1] = v[i * 3 + 1]! * slow - this.gravity[i]! * dt;
        v[i * 3 + 2]! *= slow;
        p[i * 3]! += v[i * 3]! * dt;
        p[i * 3 + 1]! += v[i * 3 + 1]! * dt;
        p[i * 3 + 2]! += v[i * 3 + 2]! * dt;
        const left = this.life[i]! / this.maxLife[i]!; // 1 = just born, 0 = gone
        dots.sizes[i] = this.endSize[i]! + (this.startSize[i]! - this.endSize[i]!) * left;
        dots.alphas[i] = this.brightness[i]! * Math.min(1, left * 1.6);
      }
      dots.upload();
    }

    clear() {
      this.dots.count = 0;
      this.dots.upload();
    }

    // Removing a dot: the last dot takes its place, so the list never has gaps
    private moveLastInto(i: number) {
      const dots = this.dots;
      const last = --dots.count;
      if (i === last) return;
      for (let k = 0; k < 3; k++) {
        dots.positions[i * 3 + k] = dots.positions[last * 3 + k]!;
        dots.colors[i * 3 + k] = dots.colors[last * 3 + k]!;
        this.velocity[i * 3 + k] = this.velocity[last * 3 + k]!;
      }
      dots.sizes[i] = dots.sizes[last]!;
      dots.alphas[i] = dots.alphas[last]!;
      this.life[i] = this.life[last]!;
      this.maxLife[i] = this.maxLife[last]!;
      this.startSize[i] = this.startSize[last]!;
      this.endSize[i] = this.endSize[last]!;
      this.drag[i] = this.drag[last]!;
      this.gravity[i] = this.gravity[last]!;
      this.brightness[i] = this.brightness[last]!;
    }
  }

  // ===========================================================================
  // The scene: camera, lights, sky
  // ===========================================================================

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 3200);
  const FOG_COLOR = new THREE.Color("#3b2342");
  scene.fog = new THREE.Fog(FOG_COLOR, 280, 1300);
  scene.background = FOG_COLOR;

  // the sun sits low on the horizon, straight ahead of where the suit launches
  const SUN_DIRECTION = new THREE.Vector3(0, 0.05, -1).normalize();

  const sunLight = new THREE.DirectionalLight("#ffb27a", 2.6);
  sunLight.position.copy(SUN_DIRECTION).multiplyScalar(500);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight("#8496e0", "#2c1a33", 1.25));
  // a soft light that travels with the camera, so the suit is never just a dark shape against the sunset
  const cameraLight = new THREE.PointLight("#dfe8ff", 8, 14, 1.2);
  camera.add(cameraLight);
  scene.add(camera);

  // The sky: a giant ball around the camera, colored by which way you look
  // (navy overhead, purple, then an orange sunset glow at the horizon)
  const skyGroup = new THREE.Group(); // follows the camera, so you can never reach the sky
  scene.add(skyGroup);
  skyGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(2600, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uSun: { value: SUN_DIRECTION },
          uFog: { value: FOG_COLOR },
          uGlow: { value: new THREE.Color("#ff7a3d") },
          uMid: { value: new THREE.Color("#4a2366") },
          uTop: { value: new THREE.Color("#060a24") },
        },
        vertexShader: `
          varying vec3 vDirection;
          void main() {
            vDirection = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uSun, uFog, uGlow, uMid, uTop;
          varying vec3 vDirection;
          void main() {
            vec3 d = normalize(vDirection);
            float h = d.y; // 0 at the horizon, 1 straight up
            vec3 color = mix(uFog, uMid, smoothstep(0.0, 0.22, h));
            color = mix(color, uTop, smoothstep(0.18, 0.7, h));
            float sun = max(dot(d, uSun), 0.0);
            color += uGlow * pow(sun, 5.0) * (1.0 - smoothstep(-0.05, 0.45, h)) * 1.3; // glow around the sun
            color += uGlow * (1.0 - smoothstep(0.0, 0.1, abs(h))) * 0.3; // warm band all around the horizon
            color += vec3(5.0, 3.2, 1.8) * smoothstep(0.9993, 0.9997, sun); // the sun itself
            if (h < 0.0) color = uFog;
            gl_FragColor = vec4(color, 1.0);
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    )
  );

  // stars in the upper sky
  {
    const starPositions: number[] = [];
    while (starPositions.length < 1400 * 3) {
      const direction = new THREE.Vector3(rand(-1, 1), rand(0.12, 1), rand(-1, 1)).normalize().multiplyScalar(2400);
      starPositions.push(direction.x, direction.y, direction.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    skyGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#dfe8ff", size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
  }

  // ===========================================================================
  // The city
  // ===========================================================================

  // Collision boxes for the buildings, sorted into city blocks so we only check nearby ones
  type BuildingBox = { x: number; z: number; halfX: number; halfZ: number; height: number };
  const buildingsByBlock = new Map<string, BuildingBox[]>();
  const blockKey = (x: number, z: number) => `${Math.round(x / BLOCK)},${Math.round(z / BLOCK)}`;

  function addBuildingBox(box: BuildingBox) {
    const key = blockKey(box.x, box.z);
    if (!buildingsByBlock.has(key)) buildingsByBlock.set(key, []);
    buildingsByBlock.get(key)!.push(box);
  }

  // The building that `point` is inside of (or within `margin` of), if any
  function buildingAt(point: THREE.Vector3, margin: number) {
    for (const box of buildingsByBlock.get(blockKey(point.x, point.z)) ?? []) {
      if (Math.abs(point.x - box.x) < box.halfX + margin && Math.abs(point.z - box.z) < box.halfZ + margin && point.y < box.height + margin) return box;
    }
    return null;
  }

  // Did something moving from a to b this frame pass through a building? Fast shots can jump
  // farther in one frame than a building is wide, so check points every few units along the way.
  const pathPoint = new THREE.Vector3();
  function segmentHitsBuilding(a: THREE.Vector3, b: THREE.Vector3) {
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 4));
    for (let i = 1; i <= steps; i++) {
      if (buildingAt(pathPoint.lerpVectors(a, b, i / steps), 0)) return true;
    }
    return false;
  }

  function makeCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext("2d")! };
  }

  // The ground: one city block drawn on a small canvas, repeated across the whole map
  function makeGround() {
    const { canvas, ctx } = makeCanvas(256, 256);
    const lot = (256 * LOT) / BLOCK;
    const edge = (256 - lot) / 2;
    ctx.fillStyle = "#11131b"; // street
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#2a3142"; // sidewalk
    ctx.fillRect(edge - 7, edge - 7, lot + 14, lot + 14);
    ctx.fillStyle = "#191d29"; // the lot
    ctx.fillRect(edge, edge, lot, lot);
    // glowing curbs
    ctx.strokeStyle = "#2c9fd6";
    ctx.lineWidth = 2;
    ctx.strokeRect(edge - 7, edge - 7, lot + 14, lot + 14);
    // dashed yellow lines down the middle of the streets (the edges of the tile)
    ctx.fillStyle = "#e0b441";
    for (let i = 0; i < 256; i += 32) {
      ctx.fillRect(i + 6, 0, 18, 1.5);
      ctx.fillRect(i + 6, 254.5, 18, 1.5);
      ctx.fillRect(0, i + 6, 1.5, 18);
      ctx.fillRect(254.5, i + 6, 1.5, 18);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const tiles = 67; // an odd number of blocks, so the streets line up with the buildings
    texture.repeat.set(tiles, tiles);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK * tiles, BLOCK * tiles),
      new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: "#ffffff", emissiveIntensity: 0.55, roughness: 0.85, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    return texture;
  }

  // Building walls: two canvases with the same windows. One is the wall color, the other
  // has only the lit windows, which glow at night.
  function makeWindowTextures() {
    const size = 512;
    const cells = 8;
    const cell = size / cells;
    const wall = makeCanvas(size, size);
    const glow = makeCanvas(size, size);
    wall.ctx.fillStyle = "#a2a8b5";
    wall.ctx.fillRect(0, 0, size, size);
    glow.ctx.fillStyle = "#000";
    glow.ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        const x = col * cell + 9;
        const y = row * cell + 13;
        const w = cell - 18;
        const h = cell - 24;
        const lit = Math.random() < 0.3;
        wall.ctx.fillStyle = lit ? "#56565e" : "#1b2234";
        wall.ctx.fillRect(x, y, w, h);
        if (lit) {
          glow.ctx.globalAlpha = rand(0.35, 1);
          glow.ctx.fillStyle = Math.random() < 0.72 ? "#ffd08a" : "#9fe3ff";
          glow.ctx.fillRect(x, y, w, h);
        }
      }
    }
    const toTexture = (canvas: HTMLCanvasElement) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      return texture;
    };
    return { wall: toTexture(wall.canvas), glow: toTexture(glow.canvas) };
  }

  // A box for buildings of one height, with its window pattern scaled so windows are always
  // the same size. Many buildings share each box shape (drawn together = fast).
  function makeBuildingGeometry(height: number) {
    const geometry = new THREE.BoxGeometry(1, height, 1);
    geometry.translate(0, height / 2, 0); // stands on the ground
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    const shiftU = Math.floor(Math.random() * 8) / 8;
    const shiftV = Math.floor(Math.random() * 8) / 8;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4); // the box's 6 faces, 4 corners each: +x, -x, top, bottom, +z, -z
      if (face === 2 || face === 3) uv.setXY(i, 0.005, 0.005); // roof: plain wall color
      else uv.setXY(i, uv.getX(i) * 1.25 + shiftU, (uv.getY(i) * height) / 28 + shiftV);
    }
    return geometry;
  }

  const beacons = new GlowPoints(260); // blinking red lights on top of tall buildings
  const beaconBlink: number[] = [];
  const traffic = new GlowPoints(700); // car lights moving along the streets
  type Car = { alongX: boolean; line: number; lane: number; dir: number; speed: number; at: number; color: THREE.Color };
  const cars: Car[] = [];

  function buildCity() {
    const textures = makeWindowTextures();
    const material = new THREE.MeshStandardMaterial({
      map: textures.wall,
      emissiveMap: textures.glow,
      emissive: "#ffffff",
      emissiveIntensity: 1.15,
      roughness: 0.55,
      metalness: 0.35,
    });
    const HEIGHTS = [18, 28, 40, 55, 72, 92, 115, 140, 170, 205];
    const TINTS = ["#8b93a9", "#7a86a3", "#9a8faa", "#7d98a6", "#a59c94", "#6e7a95", "#8d8aa0"];
    type Placement = { x: number; z: number; width: number; depth: number; turned: boolean; tint: THREE.Color };
    const byHeight: Placement[][] = HEIGHTS.map(() => []);

    const place = (x: number, z: number, width: number, depth: number, wantedHeight: number) => {
      let index = 0;
      HEIGHTS.forEach((h, i) => {
        if (Math.abs(h - wantedHeight) < Math.abs(HEIGHTS[index]! - wantedHeight)) index = i;
      });
      const height = HEIGHTS[index]!;
      const turned = Math.random() < 0.5; // turned buildings show a different part of the window pattern
      byHeight[index]!.push({ x, z, width, depth, turned, tint: new THREE.Color(pick(TINTS)) });
      addBuildingBox({ x, z, halfX: (turned ? depth : width) / 2, halfZ: (turned ? width : depth) / 2, height });
      if (height >= 115) {
        beacons.set(beacons.count, x, height + 1.5, z, hot("#ff2a20", 5), 3, 1);
        beaconBlink.push(Math.random() * Math.PI * 2);
        beacons.count++;
      }
    };

    for (let bx = -CITY_BLOCKS; bx <= CITY_BLOCKS; bx++) {
      for (let bz = -CITY_BLOCKS; bz <= CITY_BLOCKS; bz++) {
        if (Math.abs(bx) <= 1 && Math.abs(bz) <= 1) continue; // the plaza around the tower
        if (Math.random() < 0.07) continue; // a few empty lots
        const x = bx * BLOCK;
        const z = bz * BLOCK;
        const skyline = Math.exp(-Math.hypot(bx, bz) / 5.5); // tall in the middle, low at the edges
        if (Math.random() < 0.28) {
          // four small buildings sharing the lot
          for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            place(x + ox * 10.5, z + oz * 10.5, 17, 17, 14 + rand(0, 45) * (0.4 + skyline));
          }
        } else {
          place(x, z, rand(30, LOT), rand(30, LOT), 20 + skyline * rand(70, 200) + rand(0, 35));
        }
      }
    }

    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
    const noTurn = new THREE.Quaternion();
    byHeight.forEach((placements, i) => {
      if (!placements.length) return;
      const mesh = new THREE.InstancedMesh(makeBuildingGeometry(HEIGHTS[i]!), material, placements.length);
      placements.forEach((p, k) => {
        matrix.compose(new THREE.Vector3(p.x, 0, p.z), p.turned ? turn : noTurn, new THREE.Vector3(p.width, 1, p.depth));
        mesh.setMatrixAt(k, matrix);
        mesh.setColorAt(k, p.tint);
      });
      scene.add(mesh);
    });
    beacons.upload();
    scene.add(beacons.points);

    // cars drive along the streets (between the blocks), white headlights one way, red the other
    for (let i = 0; i < traffic.max; i++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      cars.push({
        alongX: Math.random() < 0.5,
        line: (Math.floor(rand(-CITY_BLOCKS - 1, CITY_BLOCKS + 1)) + 0.5) * BLOCK,
        lane: dir * 3,
        dir,
        speed: rand(18, 40),
        at: rand(-CITY_BLOCKS * BLOCK, CITY_BLOCKS * BLOCK),
        color: dir > 0 ? hot("#fff3d6", 3) : hot("#ff3a2a", 3),
      });
    }
    traffic.count = traffic.max;
    scene.add(traffic.points);
  }

  function updateCity(dt: number, time: number) {
    const reach = (CITY_BLOCKS + 0.5) * BLOCK;
    cars.forEach((car, i) => {
      car.at += car.dir * car.speed * dt;
      if (car.at > reach) car.at = -reach;
      if (car.at < -reach) car.at = reach;
      const x = car.alongX ? car.at : car.line + car.lane;
      const z = car.alongX ? car.line + car.lane : car.at;
      traffic.set(i, x, 0.8, z, car.color, 2.4, 1);
    });
    traffic.upload();
    for (let i = 0; i < beacons.count; i++) {
      beacons.alphas[i] = Math.sin(time * 2.4 + beaconBlink[i]!) > 0.55 ? 1 : 0.12;
    }
    beacons.upload();
  }

  // Armory Tower: the tall tower in the middle of the city, with a glowing ring, a spinning
  // holo-sign, and the landing pad on top where the suit launches from
  const towerSpinners: { object: THREE.Object3D; speed: number }[] = [];

  function buildTower() {
    const tower = new THREE.Group();
    scene.add(tower);
    const glass = new THREE.MeshStandardMaterial({ color: "#1d2c48", metalness: 0.95, roughness: 0.12 });
    const steel = new THREE.MeshStandardMaterial({ color: "#5a6070", metalness: 0.9, roughness: 0.3 });
    const cyan = new THREE.MeshBasicMaterial({ color: hot("#5ee7ff", 3.5) });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(11, 16, TOWER_HEIGHT, 32), glass);
    shaft.position.y = TOWER_HEIGHT / 2;
    tower.add(shaft);
    // glowing light strips running up the tower
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.6, TOWER_HEIGHT, 0.6), cyan);
      strip.position.set(Math.cos(angle) * 13.6, TOWER_HEIGHT / 2, Math.sin(angle) * 13.6);
      strip.rotation.z = Math.cos(angle) * 0.024; // follows the tower's slight taper
      strip.rotation.x = -Math.sin(angle) * 0.024;
      tower.add(strip);
    }
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(22, 12, 8, 40), steel);
    deck.position.y = TOWER_HEIGHT + 4;
    tower.add(deck);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.6, 40), new THREE.MeshStandardMaterial({ color: "#20242e", metalness: 0.6, roughness: 0.4 }));
    pad.position.y = DECK_TOP + 0.3;
    tower.add(pad);
    // arc-reactor style rings on the pad
    const padGlow = new THREE.MeshBasicMaterial({ color: hot("#5ee7ff", 0.9) });
    for (const [radius, tube] of [[8, 0.1], [5, 0.07], [2, 0.12]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius!, tube!, 8, 64), padGlow);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = PAD_TOP + 0.05;
      tower.add(ring);
    }
    // the big glowing halo around the top of the tower
    const halo = new THREE.Mesh(new THREE.TorusGeometry(27, 0.55, 10, 96), new THREE.MeshBasicMaterial({ color: hot("#ffc94a", 3) }));
    halo.position.y = TOWER_HEIGHT - 18;
    halo.rotation.x = Math.PI / 2 + 0.12;
    tower.add(halo);
    towerSpinners.push({ object: halo, speed: 0.25 });
    // red beacon on top
    beacons.set(beacons.count, 0, PAD_TOP + 0.5, 0, hot("#ff2a20", 6), 4, 1);
    beaconBlink.push(0);
    beacons.count++;

    // the spinning holo-sign. Text is drawn once the Orbitron font has loaded.
    const sign = makeCanvas(2048, 128);
    const signTexture = new THREE.CanvasTexture(sign.canvas);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    const drawSign = () => {
      sign.ctx.clearRect(0, 0, 2048, 128);
      sign.ctx.font = "900 78px Orbitron, Arial Black, sans-serif";
      sign.ctx.textAlign = "center";
      sign.ctx.textBaseline = "middle";
      sign.ctx.fillStyle = "#ffffff";
      sign.ctx.fillText("NOAH'S ARMORY  ✦  IRON STRIKE  ✦", 1024, 66);
      signTexture.needsUpdate = true;
    };
    drawSign();
    document.fonts.load("900 78px Orbitron").then(drawSign).catch(() => {});
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(24, 24, 7, 64, 1, true),
      new THREE.MeshBasicMaterial({ map: signTexture, color: hot("#5ee7ff", 2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }) // one-sided: from inside the ring it would read backwards
    );
    band.position.y = TOWER_HEIGHT - 6;
    tower.add(band);
    towerSpinners.push({ object: band, speed: -0.18 });

    addBuildingBox({ x: 0, z: 0, halfX: 19, halfZ: 19, height: DECK_TOP });
  }

  // ===========================================================================
  // The suit
  // ===========================================================================

  type Suit = {
    root: THREE.Group; // where the suit is and which way it faces
    body: THREE.Group; // leans forward to fly
    head: THREE.Group;
    arms: THREE.Group[]; // [left, right]
    legs: THREE.Group[];
    palms: THREE.Object3D[]; // where the repulsor shots come from
    chest: THREE.Object3D; // where the unibeam comes from
    shoulders: THREE.Object3D[]; // where the missiles launch from
    palmFlames: THREE.Group[];
    bootFlames: THREE.Group[];
    light: THREE.PointLight; // the thrusters light up whatever the suit flies past
  };

  const suitRed = new THREE.MeshStandardMaterial({ color: "#b8130f", metalness: 0.75, roughness: 0.28 });
  const suitGold = new THREE.MeshStandardMaterial({ color: "#e6aa30", metalness: 0.92, roughness: 0.24 });
  const suitDark = new THREE.MeshStandardMaterial({ color: "#2a2d36", metalness: 0.7, roughness: 0.45 });
  const suitGlow = new THREE.MeshBasicMaterial({ color: hot("#c8f8ff", 3) });

  // a thruster flame: a cone pointing down from its base, with a white-hot core inside
  const flameGeometry = new THREE.ConeGeometry(0.075, 0.8, 12, 1, true).rotateX(Math.PI).translate(0, -0.4, 0);
  const flameOuter = new THREE.MeshBasicMaterial({ color: hot("#ff8a2a", 2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flameCore = new THREE.MeshBasicMaterial({ color: hot("#d8fbff", 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  function makeFlame() {
    const flame = new THREE.Group();
    flame.add(new THREE.Mesh(flameGeometry, flameOuter));
    const core = new THREE.Mesh(flameGeometry, flameCore);
    core.scale.set(0.5, 0.55, 0.5);
    flame.add(core);
    return flame;
  }

  function buildSuit(): Suit {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const rounded = (w: number, h: number, d: number, r: number) => new THREE.RoundedBoxGeometry(w, h, d, 3, r);

    // Body (the suit faces -z; its middle, at the waist, is the origin)
    part(rounded(0.64, 0.5, 0.38, 0.09), suitRed, body, 0, 0.43, 0); // chest
    part(rounded(0.46, 0.26, 0.3, 0.06), suitGold, body, 0, 0.09, 0); // stomach
    part(rounded(0.5, 0.2, 0.32, 0.06), suitRed, body, 0, -0.12, 0); // hips
    const chest = part(new THREE.CylinderGeometry(0.085, 0.085, 0.04, 24).rotateX(Math.PI / 2), suitGlow, body, 0, 0.45, -0.19); // arc reactor
    part(new THREE.TorusGeometry(0.1, 0.022, 8, 24), suitDark, body, 0, 0.45, -0.19);
    const shoulders: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const pad = part(new THREE.SphereGeometry(0.15, 16, 12), suitRed, body, side * 0.38, 0.63, 0);
      pad.scale.set(1.1, 0.9, 1);
      shoulders.push(pad);
    }
    part(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 12), suitDark, body, 0, 0.73, 0); // neck

    // Head: red helmet, gold face plate, glowing eyes
    const head = new THREE.Group();
    head.position.y = 0.88;
    body.add(head);
    part(new THREE.SphereGeometry(0.165, 24, 16), suitRed, head, 0, 0, 0).scale.set(0.95, 1.12, 1.05);
    part(rounded(0.24, 0.26, 0.08, 0.035), suitGold, head, 0, -0.01, -0.13);
    part(rounded(0.17, 0.07, 0.06, 0.02), suitGold, head, 0, -0.12, -0.12);
    for (const side of [-1, 1]) {
      const eye = part(new THREE.BoxGeometry(0.075, 0.022, 0.012), suitGlow, head, side * 0.055, 0.03, -0.172);
      eye.rotation.z = -side * 0.14;
    }

    // Arms (left, right), each hanging from the shoulder
    const arms: THREE.Group[] = [];
    const palms: THREE.Object3D[] = [];
    const palmFlames: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.4, 0.6, 0);
      body.add(arm);
      part(new THREE.CapsuleGeometry(0.075, 0.2, 4, 12), suitGold, arm, 0, -0.17, 0); // upper arm
      part(new THREE.SphereGeometry(0.07, 12, 8), suitDark, arm, 0, -0.33, 0); // elbow
      part(new THREE.CapsuleGeometry(0.088, 0.2, 4, 12), suitRed, arm, 0, -0.48, 0); // gauntlet
      part(rounded(0.11, 0.13, 0.075, 0.03), suitRed, arm, 0, -0.67, 0); // hand
      palms.push(part(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 16), suitGlow, arm, 0, -0.737, 0));
      const flame = makeFlame();
      flame.position.y = -0.745;
      arm.add(flame);
      palmFlames.push(flame);
      arms.push(arm);
    }

    // Legs, with thrusters in the boots
    const legs: THREE.Group[] = [];
    const bootFlames: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.14, -0.2, 0);
      body.add(leg);
      part(new THREE.CapsuleGeometry(0.098, 0.26, 4, 12), suitRed, leg, 0, -0.2, 0); // thigh
      part(new THREE.SphereGeometry(0.08, 12, 8), suitGold, leg, 0, -0.4, -0.02); // knee
      part(new THREE.CapsuleGeometry(0.088, 0.26, 4, 12), suitRed, leg, 0, -0.58, 0); // shin
      part(rounded(0.13, 0.12, 0.22, 0.04), suitRed, leg, 0, -0.79, -0.03); // boot
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), suitGlow, leg, 0, -0.856, 0);
      const flame = makeFlame();
      flame.position.y = -0.86;
      flame.scale.set(1.4, 1, 1.4);
      leg.add(flame);
      bootFlames.push(flame);
      legs.push(leg);
    }

    const light = new THREE.PointLight("#ffab66", 0, 18, 1.4);
    light.position.y = -3; // behind the boots, so it lights the city but doesn't wash out the suit
    body.add(light);

    return { root, body, head, arms, legs, palms, chest, shoulders, palmFlames, bootFlames, light };
  }

  // Puts the suit in its pose. lean: 0 = standing, FLIGHT_LEAN = flying flat.
  // aim: 0 = arms at its sides, 1 = both arms pointing forward (firing).
  function poseSuit(suit: Suit, lean: number, aim: number, thrust: number, time: number) {
    suit.body.rotation.x = -lean;
    suit.head.rotation.x = lean * 0.7; // keep looking where it's going
    suit.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      // pointing forward = a quarter turn up, plus however far the body leans
      arm.rotation.x = lean * 0.08 + aim * (Math.PI / 2 + lean - lean * 0.08);
      arm.rotation.z = side * (0.14 - aim * 0.1);
    });
    suit.legs.forEach((leg, i) => {
      leg.rotation.x = lean * 0.1 + Math.sin(time * 2 + i) * 0.03;
      leg.rotation.z = (i === 0 ? -1 : 1) * 0.04;
    });
    const flicker = () => 0.85 + Math.random() * 0.3;
    suit.bootFlames.forEach((flame) => flame.scale.set(1.4, thrust * flicker() + 0.05, 1.4));
    suit.palmFlames.forEach((flame) => {
      const size = thrust * (1 - aim) * 0.8;
      flame.visible = size > 0.05;
      flame.scale.set(1, size * flicker(), 1);
    });
    suit.light.intensity = thrust * 12;
  }

  // ===========================================================================
  // Drones
  // ===========================================================================

  type Drone = {
    kind: DroneKind;
    mesh: THREE.Group;
    spinners: { object: THREE.Object3D; axis: "x" | "y" | "z"; speed: number }[];
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    hp: number;
    maxHp: number;
    radius: number;
    speed: number;
    fireTimer: number;
    spawnTimer: number;
    orbit: number;
    orbitSpeed: number;
    frontDistance: number;
    sideDistance: number;
    upDistance: number;
    hitPop: number;
    marker: HTMLElement | null;
  };

  const DRONE_STATS = {
    scout: { hp: 3, radius: 1.5, speed: 92, points: 100, fireEvery: 3.4, damage: 4, boltSpeed: 115 },
    gunner: { hp: 7, radius: 2.1, speed: 74, points: 175, fireEvery: 1.9, damage: 6, boltSpeed: 135 },
    boss: { hp: 160, radius: 9, speed: 70, points: 3000, fireEvery: 2.6, damage: 5, boltSpeed: 120 },
  };

  const droneGeometry = {
    body: new THREE.SphereGeometry(1, 24, 16),
    ring: new THREE.TorusGeometry(1.35, 0.08, 8, 40),
    eye: new THREE.SphereGeometry(0.3, 16, 12),
    fin: new THREE.BoxGeometry(0.16, 0.16, 1),
    cannon: new THREE.CylinderGeometry(0.13, 0.18, 1.3, 10).rotateX(Math.PI / 2),
    spike: new THREE.ConeGeometry(0.25, 1.2, 8),
  };
  const droneMetal = new THREE.MeshStandardMaterial({ color: "#4a5163", metalness: 0.85, roughness: 0.3 });
  const droneArmor = new THREE.MeshStandardMaterial({ color: "#23262f", metalness: 0.8, roughness: 0.35 });
  const droneDark = new THREE.MeshStandardMaterial({ color: "#16181f", metalness: 0.6, roughness: 0.5 });
  const redEye = new THREE.MeshBasicMaterial({ color: hot("#ff2a1a", 6) });
  const orangeEye = new THREE.MeshBasicMaterial({ color: hot("#ff8a1a", 6) });
  const redStrip = new THREE.MeshBasicMaterial({ color: hot("#ff3020", 2.4) });
  const purpleStrip = new THREE.MeshBasicMaterial({ color: hot("#d43cff", 3) });

  function buildDroneMesh(kind: DroneKind) {
    const mesh = new THREE.Group();
    const spinners: Drone["spinners"] = [];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z);
      parent.add(part);
      return part;
    };
    const spinner = (axis: "x" | "y" | "z", speed: number) => {
      const group = new THREE.Group();
      mesh.add(group);
      spinners.push({ object: group, axis, speed });
      return group;
    };
    // (the eye is on the +z side, which faces the player)

    if (kind === "scout") {
      add(droneGeometry.body, droneMetal, mesh).scale.set(1, 0.78, 1);
      add(droneGeometry.eye, redEye, mesh, 0, 0, 0.86);
      const spin = spinner("y", 4);
      add(droneGeometry.ring, redStrip, spin).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const fin = add(droneGeometry.fin, droneDark, spin, Math.cos(angle) * 1.25, 0, Math.sin(angle) * 1.25);
        fin.rotation.y = -angle;
      }
    } else if (kind === "gunner") {
      mesh.scale.setScalar(1.45);
      add(droneGeometry.body, droneArmor, mesh).scale.set(1, 0.85, 1.05);
      add(droneGeometry.eye, orangeEye, mesh, 0, 0.1, 0.9).scale.setScalar(1.25);
      add(droneGeometry.cannon, droneMetal, mesh, -0.75, -0.35, 0.8);
      add(droneGeometry.cannon, droneMetal, mesh, 0.75, -0.35, 0.8);
      add(droneGeometry.ring, redStrip, spinner("y", 3)).rotation.x = Math.PI / 2;
      add(droneGeometry.ring, droneMetal, spinner("z", -2)).scale.setScalar(1.12);
    } else {
      // the DREADNOUGHT
      mesh.scale.setScalar(6.5);
      add(droneGeometry.body, droneArmor, mesh).scale.set(1.05, 0.9, 1.05);
      add(droneGeometry.eye, redEye, mesh, 0, 0, 0.92).scale.setScalar(1.3);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        add(droneGeometry.eye, orangeEye, mesh, Math.cos(angle) * 0.55, Math.sin(angle) * 0.45, 0.75).scale.setScalar(0.35);
      }
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = add(droneGeometry.spike, droneMetal, mesh, Math.cos(angle) * 1.05, Math.sin(angle) * 1.05, -0.1);
        spike.scale.setScalar(0.45);
        spike.rotation.z = angle - Math.PI / 2;
      }
      add(droneGeometry.cannon, droneMetal, mesh, -0.55, -0.55, 0.75).scale.setScalar(0.6);
      add(droneGeometry.cannon, droneMetal, mesh, 0.55, -0.55, 0.75).scale.setScalar(0.6);
      add(droneGeometry.ring, purpleStrip, spinner("y", 1.2)).rotation.x = Math.PI / 2;
      add(droneGeometry.ring, redStrip, spinner("z", -0.9)).scale.setScalar(1.15);
      add(droneGeometry.ring, droneMetal, spinner("x", 0.7)).scale.setScalar(1.3);
    }
    return { mesh, spinners };
  }

  // ===========================================================================
  // Game state
  // ===========================================================================

  const state = {
    phase: "start" as Phase,
    pausedFrom: "playing" as Phase,
    time: 0,
    countdown: 0,
    lastCount: 0,
    score: 0,
    best: readNumber(BEST_KEY),
    wave: 0,
    waveActive: false,
    waveBreak: 0, // seconds until the next wave
    kills: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    shake: 0,
    slowMo: 1,
    slowMoTimer: 0,
    downTimer: 0,
    lowArmorWarned: false,
    buildingWarned: false,
    orbitAngle: Math.PI - 0.7, // the camera starts in front of the suit, a little to the side
    orbitRadius: 4.6,
    orbitHeight: 0.45,
    lookShift: 0,
    fov: 68,
    flightTime: 0, // seconds since launch (steering eases in, so takeoff is smooth)
    helmetView: readNumber(VIEW_KEY) !== 1, // flying from inside the helmet (or the chase camera behind)
    inHelmet: false, // the camera has finished flying into the helmet
  };

  const player = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    lean: 0,
    aim: 0,
    aimHold: 0,
    armor: 100,
    boost: 100,
    boostLocked: false,
    boosting: false,
    beamCharge: 0,
    beamTime: 0,
    missileCooldown: 0,
    fireCooldown: 0,
    nextPalm: 0,
    crashCooldown: 0,
    hurtFlash: 0,
    alive: true,
    spin: 0,
  };

  const input = {
    keys: new Set<string>(),
    mouseActive: false, // the mouse is over the play area and steering
    mouseX: 0, // -1 (left edge) to 1 (right edge)
    mouseY: 0, // -1 (bottom) to 1 (top)
    firing: false,
    touchMode: window.matchMedia("(pointer: coarse)").matches,
    stickId: -1,
    stickStartX: 0,
    stickStartY: 0,
    stickX: 0,
    stickY: 0,
    touchBoost: false,
  };

  const drones: Drone[] = [];
  let aimTarget: Drone | null = null;
  const aimPoint = new THREE.Vector3();

  // ===========================================================================
  // Effects: particles, shockwaves, flashes, flying debris
  // ===========================================================================

  const particles = new Particles(6000);
  scene.add(particles.dots.points);

  const COLORS = {
    white: hot("#ffffff", 3),
    fire: hot("#ff7a1a", 3),
    yellow: hot("#ffd060", 3),
    ember: hot("#ff3a10", 2),
    cyan: hot("#5ee7ff", 3),
    gold: hot("#ffc94a", 3),
    red: hot("#ff2a20", 3),
    exhaust: hot("#ff9a4a", 1.6),
    dim: hot("#cfe8ff", 0.8),
  };

  const shockwaves = Array.from({ length: 8 }, () => {
    const material = new THREE.MeshBasicMaterial({ color: COLORS.fire.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), material);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, material, life: 0, size: 1, color: COLORS.fire };
  });

  const flashLights = Array.from({ length: 2 }, () => {
    const light = new THREE.PointLight("#ff9a4a", 0, 160, 1.3);
    scene.add(light);
    return light;
  });

  const debrisGeometry = new THREE.BoxGeometry(1, 1, 1);
  const debris = Array.from({ length: 36 }, () => {
    const mesh = new THREE.Mesh(debrisGeometry, droneMetal);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
  });

  // Chain explosions (the Dreadnought goes off in pieces)
  const pendingBlasts: { pos: THREE.Vector3; power: number; delay: number }[] = [];

  function sparks(at: THREE.Vector3, count: number, speed: number, color: THREE.Color, size = 0.6) {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      particles.spawn(at.x, at.y, at.z, dir.x, dir.y, dir.z, rand(0.2, 0.5), size, 0, Math.random() < 0.3 ? COLORS.white : color, 3, 10);
    }
  }

  function explode(at: THREE.Vector3, power: number) {
    const strength = Math.sqrt(power);
    // flying sparks
    for (let i = 0; i < 40 * power; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(15, 70) * strength);
      particles.spawn(at.x, at.y, at.z, dir.x, dir.y, dir.z, rand(0.4, 1.1), rand(0.8, 2.2) * strength, 0, pick([COLORS.white, COLORS.yellow, COLORS.fire, COLORS.fire]), 2.2, 18);
    }
    // the fireball: big, slow, glowing blobs
    for (let i = 0; i < 14 * strength; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 14) * strength);
      particles.spawn(at.x, at.y, at.z, dir.x, dir.y, dir.z, rand(0.4, 0.8), 3.5 * strength, 8 * strength, pick([COLORS.fire, COLORS.ember, COLORS.yellow]), 3, -2, 0.3);
    }
    shockwave(at, 9 * strength, COLORS.fire);
    const light = flashLights[0]!.intensity < flashLights[1]!.intensity ? flashLights[0]! : flashLights[1]!;
    light.position.copy(at);
    light.intensity = 1500 * power;
    // chunks of drone flying off
    for (let i = 0; i < Math.min(4 * power, 12); i++) {
      const chunk = debris.find((d) => d.life <= 0);
      if (!chunk) break;
      chunk.life = rand(1.5, 2.5);
      chunk.mesh.visible = true;
      chunk.mesh.position.copy(at);
      chunk.mesh.scale.setScalar(rand(0.25, 0.7) * strength);
      chunk.vel.set(rand(-1, 1), rand(0, 1.3), rand(-1, 1)).multiplyScalar(rand(15, 40) * strength);
      chunk.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    }
    const distance = at.distanceTo(camera.position);
    state.shake = Math.min(state.shake + (power * 1.2) / (1 + distance / 60), 2.5);
    sound.boom(power, distance);
  }

  function shockwave(at: THREE.Vector3, size: number, color: THREE.Color) {
    const wave = shockwaves.find((w) => w.life <= 0) ?? shockwaves[0]!;
    wave.life = 1;
    wave.size = size;
    wave.color = color;
    wave.mesh.position.copy(at);
    wave.mesh.visible = true;
  }

  function updateEffects(dt: number) {
    particles.update(dt);
    for (const wave of shockwaves) {
      if (wave.life <= 0) continue;
      wave.life -= dt * 2;
      if (wave.life <= 0) {
        wave.mesh.visible = false;
        continue;
      }
      const grown = 1 - wave.life;
      wave.mesh.scale.setScalar(0.5 + wave.size * (1 - Math.pow(1 - grown, 3)));
      wave.mesh.quaternion.copy(camera.quaternion); // always faces the camera
      wave.material.color.copy(wave.color).multiplyScalar(wave.life * wave.life * 0.5);
    }
    for (const light of flashLights) light.intensity *= Math.exp(-7 * dt);
    for (const chunk of debris) {
      if (chunk.life <= 0) continue;
      chunk.life -= dt;
      chunk.vel.y -= 35 * dt;
      chunk.mesh.position.addScaledVector(chunk.vel, dt);
      if (chunk.mesh.position.y < 0.3) {
        chunk.mesh.position.y = 0.3;
        chunk.vel.multiplyScalar(0.4);
        chunk.vel.y = Math.abs(chunk.vel.y);
      }
      chunk.mesh.rotation.x += chunk.spin.x * dt;
      chunk.mesh.rotation.y += chunk.spin.y * dt;
      chunk.mesh.rotation.z += chunk.spin.z * dt;
      if (chunk.life <= 0) chunk.mesh.visible = false;
    }
    for (let i = pendingBlasts.length - 1; i >= 0; i--) {
      const blast = pendingBlasts[i]!;
      blast.delay -= dt;
      if (blast.delay <= 0) {
        explode(blast.pos, blast.power);
        pendingBlasts.splice(i, 1);
      }
    }
  }

  // ===========================================================================
  // Weapons: repulsor shots, enemy shots, missiles, unibeam
  // ===========================================================================

  type Shot = { mesh: THREE.Mesh; pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; life: number; damage: number; active: boolean };

  function makeShots(count: number, geometry: THREE.BufferGeometry, material: THREE.Material): Shot[] {
    return Array.from({ length: count }, () => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, damage: 0, active: false };
    });
  }

  const boltGeometry = new THREE.SphereGeometry(0.2, 8, 6).scale(1, 1, 8);
  const playerShots = makeShots(70, boltGeometry, new THREE.MeshBasicMaterial({ color: hot("#7fefff", 6) }));
  const enemyShots = makeShots(90, new THREE.SphereGeometry(0.55, 10, 8).scale(1, 1, 2.6), new THREE.MeshBasicMaterial({ color: hot("#ff3a22", 6) }));

  function launchShot(pool: Shot[], from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, life: number) {
    const shot = pool.find((s) => !s.active);
    if (!shot) return;
    shot.active = true;
    shot.pos.copy(from);
    shot.prev.copy(from);
    shot.vel.copy(dir).multiplyScalar(speed);
    shot.damage = damage;
    shot.life = life;
    shot.mesh.visible = true;
    shot.mesh.position.copy(from);
    shot.mesh.quaternion.setFromUnitVectors(Z_AXIS, dir);
  }

  function endShot(shot: Shot) {
    shot.active = false;
    shot.mesh.visible = false;
  }

  const palmWorld = new THREE.Vector3();
  const shotDir = new THREE.Vector3();

  function fireRepulsor() {
    player.nextPalm = 1 - player.nextPalm;
    suit.palms[player.nextPalm]!.getWorldPosition(palmWorld);
    shotDir.copy(aimPoint).sub(palmWorld).normalize();
    // never shoot backwards (if the aim point is somehow behind the suit, fire straight ahead)
    if (shotDir.dot(player.forward) < 0.2) shotDir.copy(player.forward);
    launchShot(playerShots, palmWorld, shotDir, BOLT_SPEED + player.speed, 1, 1.3);
    particles.spawn(palmWorld.x, palmWorld.y, palmWorld.z, player.vel.x, player.vel.y, player.vel.z, 0.08, 1.6, 0.4, COLORS.cyan, 0, 0);
    sound.zap();
  }

  function updatePlayerShots(dt: number) {
    for (const shot of playerShots) {
      if (!shot.active) continue;
      shot.prev.copy(shot.pos);
      shot.pos.addScaledVector(shot.vel, dt);
      shot.mesh.position.copy(shot.pos);
      shot.life -= dt;
      if (shot.pos.y < 0 || segmentHitsBuilding(shot.prev, shot.pos)) {
        sparks(shot.pos, 6, 20, COLORS.cyan);
        endShot(shot);
        continue;
      }
      const hit = drones.find((d) => segmentHitsSphere(shot.prev, shot.pos, d.pos, d.radius + 0.5));
      if (hit) {
        sparks(shot.pos, 8, 30, COLORS.cyan);
        damageDrone(hit, shot.damage);
        restartAnimation(page.hitmarker, "is-on");
        endShot(shot);
      } else if (shot.life <= 0) {
        endShot(shot);
      }
    }
  }

  function fireEnemyShot(drone: Drone, from: THREE.Vector3, accuracy: number) {
    const stats = DRONE_STATS[drone.kind];
    const distance = from.distanceTo(player.pos);
    // aim close to where the suit is going to be (not exactly, so turning dodges the shots)
    const target = player.pos.clone().addScaledVector(player.vel, (distance / stats.boltSpeed) * 0.8);
    target.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(accuracy));
    launchShot(enemyShots, from, target.sub(from).normalize(), stats.boltSpeed, stats.damage, 3.5);
  }

  function updateEnemyShots(dt: number) {
    for (const shot of enemyShots) {
      if (!shot.active) continue;
      shot.prev.copy(shot.pos);
      shot.pos.addScaledVector(shot.vel, dt);
      shot.mesh.position.copy(shot.pos);
      shot.life -= dt;
      if (segmentHitsBuilding(shot.prev, shot.pos)) {
        // buildings block shots, so they're cover
        sparks(shot.pos, 8, 20, COLORS.red);
        endShot(shot);
      } else if (player.alive && segmentHitsSphere(shot.prev, shot.pos, player.pos, 1.25)) {
        damagePlayer(shot.damage);
        sparks(shot.pos, 14, 25, COLORS.red);
        endShot(shot);
      } else if (shot.life <= 0 || shot.pos.y < 0) {
        endShot(shot);
      }
    }
  }

  // Missiles: four at once, each chasing its own drone, with a big blast
  type Missile = { mesh: THREE.Group; pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; target: Drone | null; life: number; speed: number; active: boolean };
  const missileBody = new THREE.CylinderGeometry(0.11, 0.11, 1.1, 8).rotateX(Math.PI / 2);
  const missileTip = new THREE.ConeGeometry(0.11, 0.35, 8).rotateX(Math.PI / 2).translate(0, 0, 0.72);
  const missiles: Missile[] = Array.from({ length: 12 }, () => {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(missileBody, suitDark));
    mesh.add(new THREE.Mesh(missileTip, suitGold));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, life: 0, speed: 0, active: false };
  });

  function fireMissiles() {
    if (state.phase !== "playing" || !player.alive || player.missileCooldown > 0) return;
    player.missileCooldown = MISSILE_COOLDOWN;
    // the drones most in front of the suit, closest first
    const targets = drones
      .filter((d) => d.pos.clone().sub(player.pos).normalize().dot(player.forward) > 0.45 && d.pos.distanceTo(player.pos) < 600)
      .sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
    const right = new THREE.Vector3().crossVectors(player.forward, UP).normalize();
    for (let i = 0; i < 4; i++) {
      const missile = missiles.find((m) => !m.active);
      if (!missile) break;
      const from = new THREE.Vector3();
      suit.shoulders[i % 2]!.getWorldPosition(from);
      missile.active = true;
      missile.mesh.visible = true;
      missile.pos.copy(from);
      missile.target = targets.length ? targets[i % targets.length]! : null;
      missile.speed = player.speed + 30;
      // they pop out sideways and up first, then swing toward their targets
      missile.vel.copy(player.forward).multiplyScalar(missile.speed).addScaledVector(right, (i - 1.5) * 18).addScaledVector(UP, 16);
      missile.life = 4;
    }
    sound.missile();
    if (!targets.length) say("No targets locked. Missiles flying straight!");
  }

  function updateMissiles(dt: number) {
    const toTarget = new THREE.Vector3();
    for (const missile of missiles) {
      if (!missile.active) continue;
      missile.life -= dt;
      missile.speed = Math.min(missile.speed + 320 * dt, 240);
      const dir = missile.vel.clone().normalize();
      if (missile.target && drones.includes(missile.target)) {
        toTarget.copy(missile.target.pos).sub(missile.pos).normalize();
        dir.lerp(toTarget, 1 - Math.exp(-7 * dt)).normalize();
      }
      missile.vel.copy(dir).multiplyScalar(missile.speed);
      missile.prev.copy(missile.pos);
      missile.pos.addScaledVector(missile.vel, dt);
      missile.mesh.position.copy(missile.pos);
      missile.mesh.quaternion.setFromUnitVectors(Z_AXIS, dir);
      // smoky golden trail
      particles.spawn(missile.pos.x, missile.pos.y, missile.pos.z, rand(-2, 2), rand(-2, 2), rand(-2, 2), 0.45, 0.9, 2.4, COLORS.gold, 1, 0, 0.7);
      // (a fast missile can fly right through a drone between two frames, so check the whole path)
      const hit = drones.find((d) => segmentHitsSphere(missile.prev, missile.pos, d.pos, d.radius + 1.5));
      if (hit) closestPointOnSegment(missile.prev, missile.pos, hit.pos, missile.pos); // blow up where it met the drone
      if (hit || missile.life <= 0 || missile.pos.y < 0.5 || segmentHitsBuilding(missile.prev, missile.pos)) {
        missile.active = false;
        missile.mesh.visible = false;
        explode(missile.pos, 1.3);
        // the blast hurts every drone close by
        for (const drone of [...drones]) {
          const distance = drone.pos.distanceTo(missile.pos) - drone.radius;
          if (distance < 14) damageDrone(drone, distance < 3 ? 5 : 2);
        }
      }
    }
  }

  // The unibeam: a giant beam from the chest that wipes out everything in front of the suit
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5); // points along -z
  const beam = new THREE.Group();
  const beamCore = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: hot("#e8fdff", 6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const beamGlow = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: hot("#5ee7ff", 1.6), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.add(beamCore, beamGlow);
  beam.visible = false;
  scene.add(beam);

  function fireBeam() {
    if (state.phase !== "playing" || !player.alive || player.beamCharge < 100 || player.beamTime > 0) return;
    player.beamCharge = 0;
    player.beamTime = BEAM_SECONDS;
    beam.visible = true;
    sound.beam();
    showBanner("UNIBEAM!", "is-cyan");
  }

  function updateBeam(dt: number) {
    if (player.beamTime <= 0) return;
    player.beamTime -= dt;
    const origin = new THREE.Vector3();
    suit.chest.getWorldPosition(origin);
    beam.position.copy(origin);
    beam.quaternion.copy(suit.root.quaternion);
    // grows in, flickers, then shrinks away
    const fade = Math.min(1, (BEAM_SECONDS - player.beamTime) * 6, player.beamTime * 3);
    const radius = fade * (1.3 + Math.sin(state.time * 60) * 0.15);
    beamCore.scale.set(radius, radius, BEAM_LENGTH);
    beamGlow.scale.set(radius * 2.6, radius * 2.6, BEAM_LENGTH);
    state.shake = Math.max(state.shake, 0.35);
    particles.spawn(origin.x, origin.y, origin.z, rand(-15, 15), rand(-15, 15), rand(-15, 15), 0.25, 2.5, 0, COLORS.cyan, 2, 0);
    // anything close to the line of the beam takes heavy damage
    const toDrone = new THREE.Vector3();
    for (const drone of [...drones]) {
      toDrone.copy(drone.pos).sub(origin);
      const along = toDrone.dot(player.forward);
      if (along < 0 || along > BEAM_LENGTH) continue;
      const sideways = toDrone.addScaledVector(player.forward, -along).length();
      if (sideways < drone.radius + 4) {
        damageDrone(drone, 40 * dt);
        if (Math.random() < 0.5) sparks(drone.pos, 3, 40, COLORS.cyan, 1);
      }
    }
    if (player.beamTime <= 0) beam.visible = false;
  }

  // ===========================================================================
  // Drones: spawning, flying, shooting, getting hit
  // ===========================================================================

  function spawnDrone(kind: DroneKind, at: THREE.Vector3) {
    const stats = DRONE_STATS[kind];
    const { mesh, spinners } = buildDroneMesh(kind);
    const bossNumber = Math.max(1, state.wave / 4);
    const hp = kind === "boss" ? stats.hp + (bossNumber - 1) * 60 : stats.hp;
    // scouts don't shoot in the first two waves
    const shoots = kind !== "scout" || state.wave >= 3;
    const drone: Drone = {
      kind,
      mesh,
      spinners,
      pos: at.clone(),
      vel: new THREE.Vector3(),
      hp,
      maxHp: hp,
      radius: stats.radius,
      speed: stats.speed,
      fireTimer: shoots ? rand(2, 4) : Infinity,
      spawnTimer: 6,
      orbit: rand(0, Math.PI * 2),
      orbitSpeed: rand(0.4, 0.9) * (Math.random() < 0.5 ? 1 : -1),
      frontDistance: kind === "boss" ? 170 : kind === "gunner" ? rand(90, 140) : rand(55, 115),
      sideDistance: kind === "boss" ? 70 : rand(25, 60),
      upDistance: kind === "boss" ? 25 : rand(8, 26),
      hitPop: 0,
      marker: null,
    };
    mesh.position.copy(at);
    scene.add(mesh);
    drones.push(drone);
    return drone;
  }

  // Somewhere far ahead of the suit, so the drones fly in toward you
  function spawnPointAhead(distance: number, spread: number) {
    const flat = new THREE.Vector3(player.forward.x, 0, player.forward.z).normalize();
    const right = new THREE.Vector3(-flat.z, 0, flat.x);
    const point = player.pos.clone().addScaledVector(flat, distance).addScaledVector(right, rand(-spread, spread));
    point.y = clamp(player.pos.y + rand(-20, 50), 30, 300);
    return point;
  }

  const droneFlat = new THREE.Vector3();
  const droneRight = new THREE.Vector3();
  const droneWanted = new THREE.Vector3();

  function updateDrones(dt: number) {
    droneFlat.set(player.forward.x, 0, player.forward.z).normalize();
    droneRight.set(-droneFlat.z, 0, droneFlat.x);
    for (const drone of [...drones]) {
      // each drone circles a spot in front of the suit, so you can see (and blast) it
      drone.orbit += drone.orbitSpeed * dt;
      const front = player.alive ? drone.frontDistance : 40; // after a crash they circle the wreck
      droneWanted
        .copy(player.pos)
        .addScaledVector(droneFlat, front)
        .addScaledVector(droneRight, Math.sin(drone.orbit) * drone.sideDistance);
      droneWanted.y = Math.max(player.pos.y + Math.cos(drone.orbit * 0.7) * drone.upDistance + (drone.kind === "boss" ? 25 : 4), 14);

      const toWanted = droneWanted.sub(drone.pos);
      const distance = toWanted.length();
      const topSpeed = drone.speed * (distance > 250 ? 1.7 : 1); // hurry back when far behind
      toWanted.normalize().multiplyScalar(Math.min(topSpeed, distance * 1.5));
      drone.vel.lerp(toWanted, 1 - Math.exp(-dt * (drone.kind === "boss" ? 0.8 : 1.6)));
      drone.pos.addScaledVector(drone.vel, dt);
      drone.pos.y = Math.max(drone.pos.y, 6);
      const building = buildingAt(drone.pos, drone.radius);
      if (building) drone.pos.y = building.height + drone.radius + 0.5; // hop over buildings

      drone.mesh.position.copy(drone.pos);
      drone.mesh.lookAt(player.pos);
      for (const spinner of drone.spinners) spinner.object.rotation[spinner.axis] += spinner.speed * dt;
      drone.hitPop = Math.max(0, drone.hitPop - dt * 6);
      const baseScale = drone.kind === "boss" ? 6.5 : drone.kind === "gunner" ? 1.45 : 1;
      drone.mesh.scale.setScalar(baseScale * (1 + drone.hitPop * 0.25));

      if (!player.alive || state.phase !== "playing") continue;

      // shooting
      drone.fireTimer -= dt;
      if (drone.fireTimer <= 0) {
        const stats = DRONE_STATS[drone.kind];
        drone.fireTimer = stats.fireEvery * rand(0.8, 1.3);
        if (drone.pos.distanceTo(player.pos) < (drone.kind === "boss" ? 420 : 280)) {
          if (drone.kind === "boss") {
            for (let i = 0; i < 7; i++) fireEnemyShot(drone, drone.pos, 14);
          } else {
            fireEnemyShot(drone, drone.pos, drone.kind === "gunner" ? 1.5 : 2.5);
          }
        }
      }
      // the Dreadnought launches more scouts
      if (drone.kind === "boss") {
        drone.spawnTimer -= dt;
        if (drone.spawnTimer <= 0 && drones.length < 14) {
          drone.spawnTimer = 9;
          spawnDrone("scout", drone.pos.clone().add(new THREE.Vector3(rand(-10, 10), -6, rand(-10, 10))));
          spawnDrone("scout", drone.pos.clone().add(new THREE.Vector3(rand(-10, 10), -6, rand(-10, 10))));
          say("The Dreadnought is launching more drones!");
        }
      }
      // ramming into a drone wrecks it, but dents the armor too
      if (drone.kind !== "boss" && drone.pos.distanceTo(player.pos) < drone.radius + 1.2) {
        damagePlayer(6);
        damageDrone(drone, 999);
      }
    }
  }

  function damageDrone(drone: Drone, amount: number) {
    if (!drones.includes(drone)) return;
    drone.hp -= amount;
    drone.hitPop = 1;
    if (drone.hp <= 0) destroyDrone(drone);
  }

  function destroyDrone(drone: Drone) {
    drones.splice(drones.indexOf(drone), 1);
    scene.remove(drone.mesh);
    drone.marker?.remove();
    if (aimTarget === drone) aimTarget = null;
    const stats = DRONE_STATS[drone.kind];

    state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
    state.comboTimer = 2.6;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    const multiplier = Math.min(state.combo, 10);
    const points = stats.points * multiplier;
    state.score += points;
    state.kills++;
    restartAnimation(page.score, "bump");
    popup(drone.pos, multiplier > 1 ? `+${points} x${multiplier}` : `+${points}`, multiplier >= 5 ? "is-gold" : "");
    if (state.combo === 5) say("FIVE in a row! Keep it going!");
    if (state.combo === 10) say("TEN COMBO! Unstoppable, Noah!");
    player.beamCharge = Math.min(100, player.beamCharge + (drone.kind === "boss" ? 100 : 9));

    if (drone.kind === "boss") {
      explode(drone.pos, 6);
      for (let i = 0; i < 7; i++) {
        pendingBlasts.push({ pos: drone.pos.clone().add(new THREE.Vector3(rand(-14, 14), rand(-10, 10), rand(-14, 14))), power: rand(1.5, 3), delay: 0.15 + i * 0.18 });
      }
      state.slowMo = 0.3;
      state.slowMoTimer = 1.4;
      page.bossBar.classList.remove("is-on");
      showBanner("DREADNOUGHT DESTROYED!", "is-gold");
      say("You took down the Dreadnought! Incredible!");
    } else {
      explode(drone.pos, drone.kind === "gunner" ? 1.7 : 1.1);
    }
  }

  // ===========================================================================
  // Gold rings
  // ===========================================================================

  type Ring = { group: THREE.Group; inner: THREE.Mesh; collected: number };
  const ringOuter = new THREE.TorusGeometry(6, 0.42, 10, 56);
  const ringInner = new THREE.TorusGeometry(5, 0.12, 6, 48);
  const ringGold = new THREE.MeshBasicMaterial({ color: hot("#ffc94a", 3.2) });
  const ringCyan = new THREE.MeshBasicMaterial({ color: hot("#5ee7ff", 2.5), transparent: true, opacity: 0.8 });
  const rings: Ring[] = Array.from({ length: 8 }, () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(ringOuter, ringGold));
    const inner = new THREE.Mesh(ringInner, ringCyan);
    group.add(inner);
    scene.add(group);
    return { group, inner, collected: 0 };
  });

  // Puts a ring somewhere ahead of the suit, facing it
  function placeRing(ring: Ring, distance: number, spread: number) {
    const flat = new THREE.Vector3(player.forward.x, 0, player.forward.z).normalize();
    const right = new THREE.Vector3(-flat.z, 0, flat.x);
    ring.group.position.copy(player.pos).addScaledVector(flat, distance).addScaledVector(right, rand(-spread, spread));
    ring.group.position.y = clamp(player.pos.y + rand(-35, 35), 25, 300);
    if (buildingAt(ring.group.position, 8)) ring.group.position.y = buildingAt(ring.group.position, 8)!.height + 18;
    ring.group.lookAt(player.pos.x, ring.group.position.y, player.pos.z);
    ring.group.scale.setScalar(1);
    ring.group.visible = true;
    ring.collected = 0;
    ring.group.updateMatrixWorld();
  }

  // The first rings make a path off the tower toward the sunset
  function placeLaunchRings() {
    rings.forEach((ring, i) => {
      ring.group.position.set(Math.sin(i * 0.8) * 30, PAD_TOP + 10 - i * 8, -70 - i * 85);
      ring.group.lookAt(ring.group.position.x, ring.group.position.y, 0);
      ring.group.scale.setScalar(1);
      ring.group.visible = true;
      ring.collected = 0;
      ring.group.updateMatrixWorld();
    });
  }

  const ringLocal = new THREE.Vector3();

  function updateRings(dt: number) {
    for (const ring of rings) {
      ring.inner.rotation.z += dt * 2;
      if (ring.collected > 0) {
        // collected: grows and fades away, then moves somewhere new
        ring.collected -= dt;
        ring.group.scale.setScalar(1 + (0.4 - ring.collected) * 4);
        if (ring.collected <= 0) placeRing(ring, rand(250, 450), 160);
        continue;
      }
      if (state.phase !== "playing" || !player.alive) continue;
      ringLocal.copy(player.pos);
      ring.group.worldToLocal(ringLocal);
      if (Math.abs(ringLocal.z) < 3 && Math.hypot(ringLocal.x, ringLocal.y) < 6.6) {
        collectRing(ring);
      } else {
        // left far behind: move it ahead again
        const away = ring.group.position.distanceTo(player.pos);
        const behind = ringLocal.copy(ring.group.position).sub(player.pos).dot(player.forward) < 0;
        if (away > 950 || (behind && away > 260)) placeRing(ring, rand(250, 450), 160);
      }
    }
  }

  function collectRing(ring: Ring) {
    ring.collected = 0.4;
    state.score += 50;
    player.armor = Math.min(100, player.armor + 4);
    player.boost = Math.min(100, player.boost + 25);
    player.beamCharge = Math.min(100, player.beamCharge + 6);
    player.speed += 25; // a little speed kick
    shockwave(ring.group.position, 12, COLORS.gold);
    sparks(ring.group.position, 30, 40, COLORS.gold, 0.9);
    popup(ring.group.position, "+50 RING", "is-gold");
    sound.ring();
  }

  // ===========================================================================
  // The suit in flight
  // ===========================================================================

  const suit = buildSuit();
  scene.add(suit.root);

  function steering() {
    let x = 0;
    let y = 0;
    const keys = input.keys;
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;
    if (keys.has("w") || keys.has("arrowup")) y += 1;
    if (keys.has("s") || keys.has("arrowdown")) y -= 1;
    if (input.mouseActive && !input.touchMode) {
      // a dead zone in the middle, so a resting mouse flies straight
      const curve = (value: number) => Math.sign(value) * Math.pow(clamp((Math.abs(value) - 0.08) / 0.75, 0, 1), 1.3);
      x += curve(input.mouseX);
      y += curve(input.mouseY);
    }
    if (input.stickId !== -1) {
      x += input.stickX;
      y += input.stickY;
    }
    const easeIn = clamp(state.flightTime / 1.5, 0, 1);
    return { x: clamp(x, -1, 1) * easeIn, y: clamp(y, -1, 1) * easeIn };
  }

  function updatePlayer(dt: number) {
    state.flightTime += dt;
    const steer = steering();
    player.yaw -= steer.x * TURN_RATE * dt;
    player.pitch += steer.y * CLIMB_RATE * dt;
    if (Math.abs(steer.y) < 0.05) player.pitch = approach(player.pitch, 0, 1.1, dt); // levels out by itself
    player.pitch = clamp(player.pitch, -MAX_PITCH, MAX_PITCH);
    player.roll = approach(player.roll, -steer.x * 0.85, 5, dt); // bank into turns

    // too far out: the suit turns itself back toward the city
    const fromCenter = Math.hypot(player.pos.x, player.pos.z);
    const leaving = fromCenter > ZONE_RADIUS;
    page.zoneWarning.classList.toggle("is-on", leaving);
    if (leaving) {
      const homeYaw = Math.atan2(player.pos.x, player.pos.z);
      player.yaw += clamp(wrapAngle(homeYaw - player.yaw), -2.2 * dt, 2.2 * dt);
    }

    // boost: drains while held, refills when not; if it runs out it must refill a bit first
    const wantsBoost = input.keys.has("shift") || input.touchBoost;
    player.boosting = wantsBoost && !player.boostLocked && player.boost > 0;
    if (player.boosting) {
      player.boost -= 26 * dt;
      if (player.boost <= 0) player.boostLocked = true;
    } else {
      player.boost = Math.min(100, player.boost + 13 * dt);
      if (player.boostLocked && player.boost > 30) player.boostLocked = false;
    }
    const targetSpeed = player.beamTime > 0 ? CRUISE_SPEED * 0.55 : player.boosting ? BOOST_SPEED : CRUISE_SPEED;
    player.speed = approach(player.speed, targetSpeed, player.boosting ? 2.4 : 1.4, dt);

    forwardFrom(player.yaw, player.pitch, player.forward);
    player.vel.copy(player.forward).multiplyScalar(player.speed);
    player.pos.addScaledVector(player.vel, dt);

    if (player.pos.y < MIN_ALTITUDE) {
      player.pos.y = MIN_ALTITUDE;
      player.pitch = Math.max(player.pitch, 0.05);
    }
    if (player.pos.y > MAX_ALTITUDE) {
      player.pos.y = MAX_ALTITUDE;
      player.pitch = Math.min(player.pitch, 0);
    }
    hitBuildings(dt);

    // speed streaks while boosting
    if (player.boosting) {
      for (let i = 0; i < 3; i++) {
        const angle = rand(0, Math.PI * 2);
        const offset = rand(4, 12);
        const at = player.pos.clone().addScaledVector(player.forward, rand(25, 60));
        particles.spawn(at.x + Math.cos(angle) * offset, at.y + Math.sin(angle) * offset, at.z + Math.cos(angle * 1.7) * offset, 0, 0, 0, 0.5, 0.35, 0.35, COLORS.dim, 0, 0, 0.8);
      }
    }

    // firing: hold the mouse, F, or (touch) automatically when a drone is lined up
    player.fireCooldown -= dt;
    const wantsFire = input.firing || input.keys.has("f") || input.keys.has("j") || (input.touchMode && aimTarget !== null);
    if (wantsFire && player.beamTime <= 0) {
      player.aimHold = 0.35;
      if (player.fireCooldown <= 0 && player.aim > 0.6) {
        player.fireCooldown = 1 / FIRE_RATE;
        fireRepulsor();
      }
    }
    player.aimHold -= dt;
    player.missileCooldown = Math.max(0, player.missileCooldown - dt);
    player.crashCooldown -= dt;
    player.hurtFlash = Math.max(0, player.hurtFlash - dt * 2.5);
    if (state.comboTimer > 0) state.comboTimer -= dt;

    sound.thrust(0.35 + (player.speed / BOOST_SPEED) * 0.65);
  }

  // Flying into a building pushes you back out (skimming a roof is fine)
  function hitBuildings(dt: number) {
    const box = buildingAt(player.pos, 1);
    if (!box) return;
    const intoX = box.halfX + 1 - Math.abs(player.pos.x - box.x);
    const intoZ = box.halfZ + 1 - Math.abs(player.pos.z - box.z);
    const intoY = box.height + 1 - player.pos.y;
    if (intoY < intoX && intoY < intoZ) {
      player.pos.y = box.height + 1;
      player.pitch = Math.max(player.pitch, 0.08);
      return;
    }
    if (intoX < intoZ) player.pos.x = box.x + Math.sign(player.pos.x - box.x || 1) * (box.halfX + 1);
    else player.pos.z = box.z + Math.sign(player.pos.z - box.z || 1) * (box.halfZ + 1);
    if (player.crashCooldown <= 0) {
      player.crashCooldown = 0.8;
      player.speed *= 0.4;
      sparks(player.pos, 25, 30, COLORS.yellow, 0.8);
      damagePlayer(5);
      if (!state.buildingWarned) {
        state.buildingWarned = true;
        say("Watch the buildings! Fly up over them.");
      }
    }
    player.pitch = approach(player.pitch, 0.6, 3, dt); // pull up
  }

  function damagePlayer(amount: number) {
    if (!player.alive || state.phase !== "playing") return;
    player.armor = Math.max(0, player.armor - amount);
    player.hurtFlash = 1;
    state.shake = Math.min(state.shake + 0.7, 2.5);
    sound.hurt();
    if (player.armor <= 30 && !state.lowArmorWarned) {
      state.lowArmorWarned = true;
      say("Armor critical! Fly through gold rings to repair it!");
      sound.beep(true);
    }
    if (player.armor <= 0) suitDown();
  }

  // Aim: a line from the camera through the mouse (or the middle of the screen).
  // Aim assist picks the drone closest to that line, so shots curve onto it.
  const raycaster = new THREE.Raycaster();
  const aimNdc = new THREE.Vector2();

  function updateAim() {
    if (input.mouseActive && !input.touchMode) aimNdc.set(input.mouseX, input.mouseY);
    else aimNdc.set(0, state.helmetView ? 0 : 0.12);
    raycaster.setFromCamera(aimNdc, camera);
    const ray = raycaster.ray.direction;
    let best: Drone | null = null;
    let bestAngle = input.touchMode ? 0.17 : 0.11;
    const toDrone = new THREE.Vector3();
    for (const drone of drones) {
      toDrone.copy(drone.pos).sub(camera.position);
      const distance = toDrone.length();
      if (distance > 650) continue;
      const angle = ray.angleTo(toDrone) - Math.atan(drone.radius / distance);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = drone;
      }
    }
    aimTarget = best;
    if (best) {
      // lead the target: aim where it will be when the shot gets there
      const distance = best.pos.distanceTo(player.pos);
      aimPoint.copy(best.pos).addScaledVector(best.vel, distance / BOLT_SPEED);
    } else {
      aimPoint.copy(camera.position).addScaledVector(ray, 320);
    }
  }

  function updateSuitModel(dt: number) {
    const flying = state.phase === "playing" || state.phase === "paused" || state.phase === "down";
    player.lean = approach(player.lean, flying ? FLIGHT_LEAN : 0, 2.5, dt);
    player.aim = approach(player.aim, player.aimHold > 0 ? 1 : 0, 14, dt);
    suit.root.position.copy(player.pos);
    const roll = player.roll + player.spin;
    suit.root.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, roll, "YXZ"));
    const thrust = state.phase === "start" ? 0.45 : state.phase === "countdown" ? 0.45 + (1 - state.countdown / 3) * 0.5 : player.alive ? 0.55 + (player.speed / BOOST_SPEED) * 0.6 : 0.2;
    poseSuit(suit, player.lean, player.aim, thrust, state.time);
    suit.root.updateMatrixWorld();

    // glowing exhaust trailing from the boots (and palms when they aren't firing)
    if (state.phase !== "over") {
      const at = new THREE.Vector3();
      const back = player.vel.clone().multiplyScalar(0.3);
      for (const flame of suit.bootFlames) {
        flame.getWorldPosition(at);
        particles.spawn(at.x, at.y, at.z, back.x + rand(-1, 1), back.y + rand(-1, 1) - (flying ? 0 : 6), back.z + rand(-1, 1), rand(0.15, 0.3), 0.4 * thrust + 0.15, 0, COLORS.exhaust, 3, 0, 0.35);
      }
    }
  }

  // ===========================================================================
  // Waves
  // ===========================================================================

  function startWave(number: number) {
    state.wave = number;
    state.waveActive = true;
    setText(page.wave, String(number));
    restartAnimation(page.wave, "bump");
    if (number % 4 === 0) {
      spawnDrone("boss", spawnPointAhead(520, 60));
      for (let i = 0; i < number / 2; i++) spawnDrone("scout", spawnPointAhead(rand(380, 480), 200));
      page.bossBar.classList.add("is-on");
      showBanner("⚠ DREADNOUGHT INCOMING", "is-red");
      say("Huge signal ahead... it's a DREADNOUGHT! Hit it with everything!");
      sound.beep(true);
      setTimeout(() => sound.beep(true), 250);
    } else {
      const count = Math.min(3 + number * 2, 18);
      const gunners = number < 2 ? 0 : Math.round(count * Math.min(0.16 * (number - 1), 0.5));
      for (let i = 0; i < count; i++) spawnDrone(i < gunners ? "gunner" : "scout", spawnPointAhead(rand(380, 520), 180));
      showBanner(`WAVE ${number}`, "");
      if (number === 1) say("Drones dead ahead! Line them up and blast them!");
      else if (number === 2) say("Orange-eyed gunners shoot back. Keep moving!");
      else say(pick(["More drones incoming!", "Here comes another wave!", "They're getting angrier. Stay sharp!"]));
    }
  }

  function updateWaves(dt: number) {
    if (state.waveActive && drones.length === 0) {
      state.waveActive = false;
      state.waveBreak = 4;
      const bonus = 250 * state.wave;
      state.score += bonus;
      player.armor = Math.min(100, player.armor + 25);
      if (player.armor > 30) state.lowArmorWarned = false;
      showBanner(`WAVE ${state.wave} CLEAR! +${bonus}`, "is-gold");
      if (state.wave % 4 !== 0) say("Wave clear! Armor repaired. Get ready for the next one...");
    }
    if (!state.waveActive && state.waveBreak > 0) {
      state.waveBreak -= dt;
      if (state.waveBreak <= 0) startWave(state.wave + 1);
    }
  }

  // ===========================================================================
  // Camera
  // ===========================================================================

  const cameraLook = new THREE.Vector3();
  const cameraWanted = new THREE.Vector3();
  const helmetTurn = new THREE.Quaternion();
  // where the camera was at takeoff: it flies from there into the helmet
  const launchCameraPos = new THREE.Vector3();
  const launchCameraTurn = new THREE.Quaternion();

  // Looking out through the helmet: the camera sits in the suit's head and faces where it flies
  function helmetCamera() {
    suit.head.getWorldPosition(cameraWanted).addScaledVector(player.forward, 0.25);
    helmetTurn.setFromEuler(new THREE.Euler(player.pitch, player.yaw, player.roll * 0.5, "YXZ"));
    const t = clamp(state.flightTime / 0.9, 0, 1);
    const smooth = t * t * (3 - 2 * t); // starts and ends gently
    camera.position.lerpVectors(launchCameraPos, cameraWanted, smooth);
    camera.quaternion.slerpQuaternions(launchCameraTurn, helmetTurn, smooth);
    setInHelmet(t > 0.7);
  }

  // Inside the helmet: hide the suit's own head (or you'd see the inside of it) and show the visor
  function setInHelmet(inside: boolean) {
    if (state.inHelmet === inside) return;
    state.inHelmet = inside;
    suit.head.visible = !inside;
    document.body.classList.toggle("in-helmet", inside);
  }

  function updateCamera(dt: number) {
    const phase = state.phase;
    if (phase === "start" || phase === "countdown") {
      // circling the suit on the landing pad
      if (phase === "start") {
        state.orbitAngle += dt * 0.15;
      } else {
        // swing around behind the suit, ready for launch
        const behind = Math.round(state.orbitAngle / (Math.PI * 2)) * Math.PI * 2;
        state.orbitAngle = approach(state.orbitAngle, behind, 2.2, dt);
      }
      const wide = page.stage.clientWidth > page.stage.clientHeight * 1.2;
      state.orbitRadius = approach(state.orbitRadius, phase === "start" ? 4.6 : 8.5, 2, dt);
      state.orbitHeight = approach(state.orbitHeight, phase === "start" ? 0.45 : 2.4, 2, dt);
      state.lookShift = approach(state.lookShift, phase === "start" && wide ? 1.7 : 0, 2, dt);
      const a = state.orbitAngle;
      camera.position.set(player.pos.x + Math.sin(a) * state.orbitRadius, player.pos.y + state.orbitHeight, player.pos.z + Math.cos(a) * state.orbitRadius);
      // shifting the look point left puts the suit on the right, next to the menu
      cameraLook.set(player.pos.x - Math.cos(a) * state.lookShift, player.pos.y + 0.4, player.pos.z + Math.sin(a) * state.lookShift);
      camera.lookAt(cameraLook);
    } else if ((phase === "playing" || phase === "paused") && state.helmetView) {
      helmetCamera();
    } else if (phase === "playing" || phase === "paused") {
      setInHelmet(false);
      // chasing behind the suit; farther back while boosting
      const distance = player.boosting ? 10.5 : 8.5;
      cameraWanted.set(0, 2.4, distance).applyEuler(new THREE.Euler(player.pitch * 0.5, player.yaw, 0, "YXZ")).add(player.pos);
      camera.position.lerp(cameraWanted, 1 - Math.exp(-dt * 6));
      camera.position.y = Math.max(camera.position.y, 2);
      cameraLook.lerp(player.pos.clone().addScaledVector(player.forward, 25).addScaledVector(UP, 1.2), 1 - Math.exp(-dt * 10));
      camera.lookAt(cameraLook);
      camera.rotateZ(player.roll * 0.25);
    } else {
      setInHelmet(false);
      // the suit is going down: watch it fall, then circle the crash site
      const t = state.time * 0.15;
      cameraWanted.set(player.pos.x + Math.sin(t) * 30, Math.max(player.pos.y + 12, 8), player.pos.z + Math.cos(t) * 30);
      camera.position.lerp(cameraWanted, 1 - Math.exp(-dt * (phase === "down" ? 1 : 0.8)));
      cameraLook.lerp(player.pos, 1 - Math.exp(-dt * 5));
      camera.lookAt(cameraLook);
    }

    // shake after explosions and hits
    if (state.shake > 0.01) {
      camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(state.shake * 0.25));
      state.shake = Math.max(0, state.shake - dt * 3);
    }

    // a wider view when boosting or firing the beam (feels faster)
    const wantedFov = phase === "playing" ? (player.beamTime > 0 ? 76 : player.boosting ? 82 : 68) : 60;
    state.fov = approach(state.fov, wantedFov, 3, dt);
    if (Math.abs(camera.fov - state.fov) > 0.01) {
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
      updatePointScale();
    }
    skyGroup.position.copy(camera.position);
  }

  // ===========================================================================
  // HUD
  // ===========================================================================

  const screenPoint = new THREE.Vector3();

  // Where a point in the world shows up on screen (in pixels), and whether it's behind the camera
  function toScreen(world: THREE.Vector3) {
    screenPoint.copy(world).project(camera);
    return {
      ndcX: screenPoint.x,
      ndcY: screenPoint.y,
      behind: screenPoint.z > 1,
      x: ((screenPoint.x + 1) / 2) * page.stage.clientWidth,
      y: ((1 - screenPoint.y) / 2) * page.stage.clientHeight,
    };
  }

  // Brackets around every drone; arrows at the screen edge for drones you can't see
  function updateMarkers() {
    const width = page.stage.clientWidth;
    const height = page.stage.clientHeight;
    const showing = state.phase === "playing" && player.alive;
    for (const drone of drones) {
      if (!drone.marker) {
        drone.marker = document.createElement("div");
        drone.marker.className = `marker${drone.kind === "boss" ? " is-boss" : ""}`;
        page.markers.append(drone.marker);
      }
      const marker = drone.marker;
      marker.hidden = !showing;
      if (!showing) continue;
      const spot = toScreen(drone.pos);
      const onScreen = !spot.behind && Math.abs(spot.ndcX) < 0.96 && Math.abs(spot.ndcY) < 0.94;
      marker.classList.toggle("is-offscreen", !onScreen);
      marker.classList.toggle("is-locked", drone === aimTarget);
      if (onScreen) {
        marker.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
        marker.style.rotate = "";
      } else {
        // point toward the drone from the middle of the screen
        let dx = spot.behind ? -spot.ndcX : spot.ndcX;
        let dy = spot.behind ? -spot.ndcY : spot.ndcY;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = -1;
        const scale = 1 / Math.max(Math.abs(dx), Math.abs(dy));
        dx *= scale;
        dy *= scale;
        const x = width / 2 + dx * (width / 2 - 28);
        const y = height / 2 - dy * (height / 2 - 28);
        marker.style.transform = `translate(${x}px, ${y}px)`;
        marker.style.rotate = `${Math.atan2(-dy, dx)}rad`;
      }
    }
    // the hit flash sits where you're aiming
    const aimX = input.mouseActive && !input.touchMode ? input.mouseX : 0;
    const aimY = input.mouseActive && !input.touchMode ? input.mouseY : state.helmetView ? 0 : 0.12;
    page.hitmarker.style.left = `${((aimX + 1) / 2) * width}px`;
    page.hitmarker.style.top = `${((1 - aimY) / 2) * height}px`;
    // the little circle showing where the suit is heading
    page.heading.hidden = !showing;
    if (showing) {
      const spot = toScreen(player.pos.clone().addScaledVector(player.forward, 150));
      page.heading.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
    }
  }

  // Floating "+100" text where something happened
  function popup(world: THREE.Vector3, text: string, className: string) {
    const spot = toScreen(world);
    if (spot.behind) return;
    const element = document.createElement("div");
    element.className = `popup ${className}`;
    element.textContent = text;
    element.style.left = `${spot.x}px`;
    element.style.top = `${spot.y}px`;
    page.popups.append(element);
    element.addEventListener("animationend", () => element.remove());
    setTimeout(() => element.remove(), 2000); // in case the animation never runs
  }

  function showBanner(text: string, className: string) {
    page.banner.textContent = text;
    page.banner.className = `banner ${className}`;
    restartAnimation(page.banner, "is-on");
  }

  // A message from the suit's computer at the bottom of the screen
  function say(text: string) {
    page.comms.textContent = text;
    restartAnimation(page.comms, "is-on");
  }

  const radar = keepCanvasSized(page.radar);

  function drawRadar() {
    radar.sync();
    const { ctx, size } = radar;
    const w = size.width;
    const h = size.height;
    if (!w || !h) return;
    const r = Math.min(w, h) / 2 - 2;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5, 12, 30, 0.75)";
    ctx.fill();
    ctx.clip();

    // range rings and the sweeping scan line
    ctx.strokeStyle = "rgba(94, 231, 255, 0.28)";
    ctx.lineWidth = 1;
    for (const fraction of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * fraction, 0, Math.PI * 2);
      ctx.stroke();
    }
    const sweep = state.time * 2.2;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, sweep - (i + 1) * 0.05, sweep - i * 0.05);
      ctx.fillStyle = `rgba(94, 231, 255, ${0.16 * (1 - i / 12)})`;
      ctx.fill();
    }

    // everything is turned so straight ahead is up
    const range = 520;
    const scale = r / range;
    const cos = Math.cos(player.yaw);
    const sin = Math.sin(player.yaw);
    const plot = (x: number, z: number, color: string, dot: number) => {
      const rx = x - player.pos.x;
      const rz = z - player.pos.z;
      let px = (rx * cos - rz * sin) * scale;
      let py = (rx * sin + rz * cos) * scale;
      const d = Math.hypot(px, py);
      if (d > r - 4) {
        px *= (r - 4) / d;
        py *= (r - 4) / d;
        dot *= 0.7;
      }
      ctx.beginPath();
      ctx.arc(cx + px, cy + py, dot, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };

    // the edge of the city
    const zx = (-player.pos.x * cos + player.pos.z * sin) * scale;
    const zy = (-player.pos.x * sin - player.pos.z * cos) * scale;
    ctx.beginPath();
    ctx.arc(cx + zx, cy + zy, ZONE_RADIUS * scale, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 59, 48, 0.55)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    plot(0, 0, "#5ee7ff", 3.5); // Armory Tower
    for (const ring of rings) if (ring.collected <= 0) plot(ring.group.position.x, ring.group.position.z, "#ffc94a", 2.2);
    for (const drone of drones) plot(drone.pos.x, drone.pos.z, drone.kind === "boss" ? "#d43cff" : drone.kind === "gunner" ? "#ff8a1a" : "#ff3b30", drone.kind === "boss" ? 6 : 3);

    // you, in the middle
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 4.5, cy + 5);
    ctx.lineTo(cx - 4.5, cy + 5);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  function updateHud() {
    setText(page.score, state.score.toLocaleString());
    const armor = Math.ceil(player.armor);
    page.armorFill.style.width = `${armor}%`;
    setText(page.armorText, `${armor}%`);
    page.armorBox.classList.toggle("is-low", armor <= 30);
    document.body.classList.toggle("armor-low", armor <= 30 && player.alive);
    page.boostFill.style.width = `${player.boost}%`;
    page.boostFill.classList.toggle("is-locked", player.boostLocked);
    page.missileFill.style.width = `${(1 - player.missileCooldown / MISSILE_COOLDOWN) * 100}%`;
    page.missileBox.classList.toggle("is-ready", player.missileCooldown <= 0);
    page.beamFill.style.width = `${player.beamCharge}%`;
    page.beamButton.classList.toggle("is-ready", player.beamCharge >= 100);
    setText(page.beamText, player.beamTime > 0 ? "FIRING!" : player.beamCharge >= 100 ? "UNIBEAM READY" : "UNIBEAM");
    const comboOn = state.comboTimer > 0 && state.combo > 1;
    page.combo.classList.toggle("is-on", comboOn);
    if (comboOn) setText(page.combo, `COMBO x${Math.min(state.combo, 10)}`);
    page.hurt.style.opacity = String(player.hurtFlash * 0.85);
    const boss = drones.find((d) => d.kind === "boss");
    if (boss) page.bossFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
  }

  // ===========================================================================
  // Game flow: start screen -> countdown -> playing -> down -> report
  // ===========================================================================

  function setPhase(phase: Phase) {
    state.phase = phase;
    document.body.dataset.phase = phase;
  }

  // Back to the suit standing on the landing pad, with a fresh city
  function resetGame() {
    for (const drone of drones) {
      scene.remove(drone.mesh);
      drone.marker?.remove();
    }
    drones.length = 0;
    aimTarget = null;
    [...playerShots, ...enemyShots].forEach(endShot);
    missiles.forEach((m) => {
      m.active = false;
      m.mesh.visible = false;
    });
    pendingBlasts.length = 0;
    page.popups.replaceChildren();
    beam.visible = false;

    Object.assign(state, { score: 0, wave: 0, waveActive: false, waveBreak: 0, kills: 0, combo: 0, comboTimer: 0, bestCombo: 0, slowMo: 1, slowMoTimer: 0, lowArmorWarned: false, downTimer: 0 });
    Object.assign(player, { yaw: 0, pitch: 0, roll: 0, speed: 0, lean: 0, aim: 0, aimHold: 0, armor: 100, boost: 100, boostLocked: false, boosting: false, beamCharge: 0, beamTime: 0, missileCooldown: 0, fireCooldown: 0, crashCooldown: 0, hurtFlash: 0, alive: true, spin: 0 });
    player.pos.set(0, PAD_TOP + SUIT_CENTER, 0);
    player.vel.set(0, 0, 0);
    forwardFrom(0, 0, player.forward);
    suit.root.visible = true;
    page.bossBar.classList.remove("is-on");
    page.zoneWarning.classList.remove("is-on");
    setText(page.wave, "-");
    placeLaunchRings();
    camera.position.set(0, PAD_TOP + SUIT_CENTER + 2.4, 8.5);
    camera.lookAt(player.pos);
  }

  function beginCountdown() {
    sound.unlock();
    resetGame();
    state.countdown = 3.2;
    state.lastCount = 0;
    page.countdown.classList.add("is-on");
    setPhase("countdown");
  }

  function updateCountdown(dt: number) {
    state.countdown -= dt;
    sound.thrust(0.25 + (1 - state.countdown / 3.2) * 0.3); // thrusters powering up
    const number = Math.ceil(state.countdown / 0.8); // 4, 3, 2, 1 -> shows 3, 2, 1, GO!
    if (number !== state.lastCount) {
      state.lastCount = number;
      setText(page.countdownNumber, number >= 2 ? String(number - 1) : "GO!");
      restartAnimation(page.countdownNumber, "pop");
      sound.beep(number < 2);
    }
    if (state.countdown <= 0) {
      page.countdown.classList.remove("is-on");
      launch();
    }
  }

  // Blast off the pad: straight into the game
  function launch() {
    sound.unlock();
    document.body.classList.remove("resumed");
    setPhase("playing");
    player.speed = 18;
    player.pitch = 0.5; // climb off the tower
    state.flightTime = 0;
    launchCameraPos.copy(camera.position);
    launchCameraTurn.copy(camera.quaternion);
    input.mouseActive = false; // the mouse is still on the Launch button; it steers once it moves
    state.waveBreak = 2.2; // the first wave arrives right after takeoff
    shockwave(new THREE.Vector3(0, PAD_TOP + 0.3, 0), 14, COLORS.cyan);
    sparks(new THREE.Vector3(0, PAD_TOP + 0.3, 0), 60, 40, COLORS.cyan, 1);
    state.shake = 1;
    sound.launch();
    say("All systems online. Let's go, Noah!");
  }

  function suitDown() {
    player.alive = false;
    setPhase("down");
    state.downTimer = 0;
    state.slowMo = 0.35;
    state.slowMoTimer = 1.2;
    explode(player.pos, 2);
    page.bossBar.classList.remove("is-on");
    page.zoneWarning.classList.remove("is-on");
    beam.visible = false;
    player.beamTime = 0;
    sound.thrust(0);
    say("Suit down! Suit down!");
  }

  // The suit tumbles to the ground, trailing smoke and sparks
  function updateDown(dt: number) {
    state.downTimer += dt;
    if (player.pos.y > 1.2) {
      player.vel.y -= 30 * dt;
      player.vel.multiplyScalar(Math.exp(-0.5 * dt));
      player.pos.addScaledVector(player.vel, dt);
      player.spin += dt * 6;
      player.pitch = approach(player.pitch, -0.9, 1.5, dt);
      particles.spawn(player.pos.x, player.pos.y, player.pos.z, rand(-3, 3), rand(2, 6), rand(-3, 3), 0.8, 1.2, 4, pick([COLORS.fire, COLORS.ember]), 1, -3, 0.7);
      if (player.pos.y <= 1.2) {
        player.pos.y = 1.2;
        explode(player.pos, 2.5);
      }
    }
    if (state.downTimer > 3.2) showReport();
  }

  function showReport() {
    const newBest = state.score > state.best;
    if (newBest) {
      state.best = state.score;
      saveNumber(BEST_KEY, state.best);
    }
    page.reportTitle.innerHTML = newBest ? 'NEW <span class="gold">BEST!</span>' : 'SUIT <span class="gold">DOWN!</span>';
    setText(page.reportScore, state.score.toLocaleString());
    setText(page.reportWave, String(state.wave));
    setText(page.reportKills, String(state.kills));
    setText(page.reportCombo, `x${state.bestCombo}`);
    setText(page.reportBest, newBest ? "That's your best score ever!" : `Best score: ${state.best.toLocaleString()}`);
    setText(page.bestScore, state.best.toLocaleString());
    setPhase("over");
  }

  function pause() {
    if (state.phase !== "playing") return;
    state.pausedFrom = state.phase;
    setPhase("paused");
    input.firing = false;
    sound.thrust(0);
  }

  function resume() {
    if (state.phase !== "paused") return;
    document.body.classList.add("resumed"); // the HUD doesn't slide in again
    setPhase(state.pausedFrom);
  }

  // ===========================================================================
  // Controls
  // ===========================================================================

  function setupControls() {
    const stage = page.stage;
    const onButton = (event: Event) => !!(event.target as Element).closest("button, a, .overlay");

    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (state.phase === "playing" && [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault(); // don't scroll the page
      if (event.repeat) return;
      input.keys.add(key);
      if (key === " ") fireBeam();
      if (key === "e" || key === "q") fireMissiles();
      if (key === "p" || key === "escape") state.phase === "paused" ? resume() : pause();
      if (key === "m") toggleMute();
      if (key === "v") toggleView();
    });
    window.addEventListener("keyup", (event) => input.keys.delete(event.key.toLowerCase()));
    window.addEventListener("blur", () => {
      input.keys.clear();
      input.firing = false;
    });

    // mouse: steer toward it, hold to fire, right-click for missiles
    window.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      setTouchMode(false); // a device with a mouse AND a touch screen: the mouse is back in charge
      const box = stage.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      input.mouseActive = inside;
      input.mouseX = clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1);
      input.mouseY = clamp(1 - ((event.clientY - box.top) / box.height) * 2, -1, 1);
    });
    document.addEventListener("pointerleave", () => (input.mouseActive = false));
    stage.addEventListener("contextmenu", (event) => event.preventDefault());

    stage.addEventListener("pointerdown", (event) => {
      if (onButton(event)) return;
      if (event.pointerType === "touch") {
        setTouchMode(true);
        if (input.stickId === -1) {
          // a joystick appears where the finger touches
          input.stickId = event.pointerId;
          input.stickStartX = event.clientX;
          input.stickStartY = event.clientY;
          input.stickX = input.stickY = 0;
          const box = stage.getBoundingClientRect();
          page.stick.style.left = `${event.clientX - box.left}px`;
          page.stick.style.top = `${event.clientY - box.top}px`;
          page.stickKnob.style.transform = "";
          page.stick.classList.add("is-on");
        }
        return;
      }
      setTouchMode(false);
      if (event.button === 0) input.firing = true;
      if (event.button === 2) fireMissiles();
    });
    window.addEventListener("pointermove", (event) => {
      if (event.pointerId !== input.stickId) return;
      const dx = clamp(event.clientX - input.stickStartX, -55, 55);
      const dy = clamp(event.clientY - input.stickStartY, -55, 55);
      input.stickX = dx / 55;
      input.stickY = -dy / 55;
      page.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const release = (event: PointerEvent) => {
      if (event.pointerType !== "touch") input.firing = false;
      if (event.pointerId === input.stickId) {
        input.stickId = -1;
        input.stickX = input.stickY = 0;
        page.stick.classList.remove("is-on");
      }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    // on-screen buttons
    el("start-button").addEventListener("click", beginCountdown);
    el("again-button").addEventListener("click", () => {
      resetGame();
      launch(); // Play again starts straight away
    });
    el("pause-button").addEventListener("click", pause);
    el("resume-button").addEventListener("click", resume);
    for (const id of ["quit-button", "menu-button"]) {
      el(id).addEventListener("click", () => {
        resetGame();
        state.orbitAngle = Math.PI - 0.7;
        setPhase("start");
      });
    }
    page.beamButton.addEventListener("click", fireBeam);
    page.touchMissiles.addEventListener("click", fireMissiles);
    page.muteButton.addEventListener("click", toggleMute);
    page.viewButton.addEventListener("click", toggleView);
    const holdBoost = (on: boolean) => (event: Event) => {
      event.preventDefault();
      input.touchBoost = on;
    };
    page.touchBoost.addEventListener("pointerdown", holdBoost(true));
    for (const name of ["pointerup", "pointercancel", "pointerleave"]) page.touchBoost.addEventListener(name, holdBoost(false));

    // switching tabs pauses the game
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
    });
  }

  // Touch mode (joystick, auto-fire, touch buttons) follows whichever input was used last
  function setTouchMode(on: boolean) {
    if (input.touchMode === on) return;
    input.touchMode = on;
    document.body.classList.toggle("touch-mode", on);
  }

  function toggleView() {
    state.helmetView = !state.helmetView;
    saveNumber(VIEW_KEY, state.helmetView ? 0 : 1);
    state.flightTime = Math.max(state.flightTime, 1); // switch straight away, no fly-in
    showView();
  }

  function showView() {
    page.viewButton.textContent = state.helmetView ? "HELMET" : "CHASE";
    page.viewButton.setAttribute("aria-label", state.helmetView ? "Switch to the chase camera" : "Switch to the helmet view");
  }

  function toggleMute() {
    sound.setMuted(!sound.muted);
    showMute();
  }

  function showMute() {
    page.muteButton.textContent = sound.muted ? "🔇" : "🔊";
    page.muteButton.setAttribute("aria-label", sound.muted ? "Turn sound on" : "Turn sound off");
  }

  // ===========================================================================
  // Drawing: renderer, glow (bloom), screen size, quality
  // ===========================================================================

  let renderer!: THREE.WebGLRenderer;
  let composer!: THREE.EffectComposer;
  let bloom!: THREE.UnrealBloomPass;
  const view = { width: 0, height: 0, ratio: 0 };
  // sharpness steps: if the game runs slowly it drops to a lower one (never back up, so it
  // doesn't keep switching back and forth)
  const RATIOS = [2, 1.5, 1, 0.75];
  let ratioStep = 0;
  let slowTime = 0;

  // The canvas's drawing size must always match its box on the page, or the picture stretches.
  // Checked every frame, because browsers don't always say when the box changes.
  function syncSize() {
    const width = page.canvas.clientWidth;
    const height = page.canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, RATIOS[ratioStep]!);
    if (width === view.width && height === view.height && ratio === view.ratio) return;
    view.width = width;
    view.height = height;
    view.ratio = ratio;
    if (!width || !height) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updatePointScale();
    page.canvas.dataset.pixelRatio = String(ratio); // the page tests read this
  }

  // Glowing points are sized in world units; this turns those into screen pixels
  function updatePointScale() {
    glowMaterial.uniforms.uScale!.value = (view.height * view.ratio) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  function watchSpeed(realDt: number) {
    slowTime = realDt > 1 / 35 ? slowTime + realDt : Math.max(0, slowTime - realDt * 0.5);
    if (slowTime < 2.5) return;
    slowTime = 0;
    const next = RATIOS.findIndex((r, i) => i > ratioStep && r < Math.min(window.devicePixelRatio || 1, RATIOS[ratioStep]!));
    if (next !== -1) ratioStep = next;
    else bloom.strength = 0.5; // already as low as it goes: make the glow cheaper to look at
  }

  // ===========================================================================
  // The main loop
  // ===========================================================================

  let lastFrame = performance.now();

  function frame(now: number) {
    const realDt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    syncSize();
    if (state.phase === "playing") watchSpeed(realDt);

    if (state.slowMoTimer > 0) {
      state.slowMoTimer -= realDt;
      if (state.slowMoTimer <= 0) state.slowMo = 1;
    }
    const dt = realDt * state.slowMo;
    const phase = state.phase;

    if (phase !== "paused") {
      state.time += dt;
      updateCity(dt, state.time);
      for (const spinner of towerSpinners) spinner.object.rotation.z += spinner.speed * dt;

      if (phase === "countdown") updateCountdown(realDt);
      if (phase === "playing") {
        updatePlayer(dt);
        updateWaves(dt);
      }
      if (phase === "down") updateDown(dt);
      if (phase === "start" || phase === "countdown") {
        player.pos.y = PAD_TOP + SUIT_CENTER + 0.25 + Math.sin(state.time * 1.6) * 0.12; // hovering just above the pad
      }
      updateDrones(dt);
      updatePlayerShots(dt);
      updateEnemyShots(dt);
      updateMissiles(dt);
      updateBeam(dt);
      updateRings(dt);
      updateEffects(dt);
      updateSuitModel(dt);
      suit.root.visible = phase !== "over" || player.pos.y > 1.3;
      updateCamera(realDt);
      if (phase === "playing") updateAim();
      updateMarkers();
      updateHud();
      drawRadar();
    }
    if (view.width && view.height) composer.render();
    requestAnimationFrame(frame);
  }

  // ===========================================================================
  // Start
  // ===========================================================================

  function webglWorks() {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  // Arriving: the second half of the warp jump from the other pages
  function playIntro() {
    const warpIn = document.getElementById("warp-in");
    const warpCanvas = document.getElementById("warp-canvas") as HTMLCanvasElement | null;
    if (warpIn && warpCanvas) {
      playWarpStreaks(warpCanvas, window.innerWidth / 2, window.innerHeight / 2, "in", 1500);
      setTimeout(() => warpIn.remove(), 1800);
    }
    setTimeout(() => document.body.classList.remove("intro"), 3000);
  }

  export function start() {
    playIntro();
    setText(page.bestScore, state.best.toLocaleString());
    showMute();
    showView();
    if (input.touchMode) document.body.classList.add("touch-mode");
    if (!webglWorks()) {
      document.body.dataset.phase = "no-3d";
      return;
    }

    renderer = new THREE.WebGLRenderer({ canvas: page.canvas, antialias: true, powerPreference: "high-performance" });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // reflections for the shiny metal suit
    const environment = new THREE.PMREMGenerator(renderer);
    scene.environment = environment.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.8;

    // the glow: anything brighter than "threshold" bleeds light around itself
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.85);
    composer.addPass(bloom);
    composer.addPass(new THREE.OutputPass());

    const groundTexture = makeGround();
    groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy(); // keeps the streets sharp far away
    buildCity();
    buildTower();
    setupControls();
    resetGame();
    setPhase("start");
    syncSize();
    updateCamera(0);
    renderer.compile(scene, camera); // prepare every shader now, so nothing stutters later
    requestAnimationFrame(frame);
  }
}

Iron3D.start();
