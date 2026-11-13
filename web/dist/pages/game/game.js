"use strict";
// Repulsor Rush: fly above the clouds and blast enemy drones.
//
// - The hero follows the mouse / finger (or arrow keys / WASD)
// - Repulsors fire automatically
// - Blue cores = triple shot, red hearts = +1 shield
// - Each kill charges the MEGA BEAM; when full press SPACE or tap the meter
// - Every 25 seconds the level goes up and drones come faster
function startGame() {
    const stage = document.getElementById("stage");
    const canvas = document.getElementById("game");
    const ctx = canvas.getContext("2d");
    const scoreText = document.getElementById("score");
    const levelText = document.getElementById("level");
    const shieldsText = document.getElementById("shields");
    const beamButton = document.getElementById("beam-button");
    const beamFill = document.getElementById("beam-fill");
    const screen = document.getElementById("screen");
    const screenKicker = document.getElementById("screen-kicker");
    const screenTitle = document.getElementById("screen-title");
    const screenText = document.getElementById("screen-text");
    const howTo = document.getElementById("how-to");
    const bestText = document.getElementById("best");
    const startButton = document.getElementById("start-button");
    const banner = document.getElementById("banner");
    const MAX_SHIELDS = 5;
    const HERO_SCALE = 1.6; // how big the hero is drawn
    const HERO_RADIUS = 34; // how close something must be to hit the hero
    // ----- game state -----
    let width = 0;
    let height = 0;
    let playing = false;
    let score = 0;
    let level = 1;
    let shields = 3;
    let beamCharge = 0; // 0 to 100
    let beamTime = 0; // frames left of an active mega beam
    let tripleShotTime = 0; // frames left of triple shot
    let invincibleTime = 0; // frames of safety after getting hit
    let playTime = 0; // seconds
    let fireTimer = 0;
    let spawnTimer = 0;
    let shake = 0;
    let bestScore = loadBest();
    const player = { x: 150, y: 300, targetX: 150, targetY: 300, tilt: 0 };
    const keys = new Set();
    let bolts = [];
    let enemies = [];
    let enemyShots = [];
    let pickups = [];
    let particles = [];
    const streaks = [];
    bestText.textContent = String(bestScore);
    // ----- setup -----
    function resize() {
        const ratio = window.devicePixelRatio || 1;
        width = stage.clientWidth;
        height = stage.clientHeight;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);
    // speed lines that rush past to make it feel fast
    for (let i = 0; i < 40; i++) {
        streaks.push({ x: Math.random() * width, y: Math.random() * height, length: 40 + Math.random() * 120, speed: 8 + Math.random() * 14 });
    }
    // ----- input -----
    stage.addEventListener("pointermove", (event) => {
        const box = stage.getBoundingClientRect();
        player.targetX = event.clientX - box.left;
        player.targetY = event.clientY - box.top;
    });
    stage.addEventListener("pointerdown", (event) => {
        const box = stage.getBoundingClientRect();
        player.targetX = event.clientX - box.left;
        player.targetY = event.clientY - box.top;
    });
    window.addEventListener("keydown", (event) => {
        if (!playing)
            return;
        const key = event.key.toLowerCase();
        if (key === " ")
            fireMegaBeam();
        if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "].includes(key)) {
            keys.add(key);
            event.preventDefault(); // stop the page from scrolling
        }
    });
    window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
    beamButton.addEventListener("click", fireMegaBeam);
    startButton.addEventListener("click", startRun);
    // ----- starting and ending -----
    function startRun() {
        score = 0;
        level = 1;
        shields = 3;
        beamCharge = 0;
        beamTime = 0;
        tripleShotTime = 0;
        invincibleTime = 60;
        playTime = 0;
        spawnTimer = 30;
        bolts = [];
        enemies = [];
        enemyShots = [];
        pickups = [];
        particles = [];
        player.x = player.targetX = width * 0.2;
        player.y = player.targetY = height * 0.5;
        playing = true;
        document.body.classList.add("is-playing");
        screen.classList.remove("is-on");
        stage.scrollIntoView({ behavior: "smooth" });
        showBanner("GO, NOAH!");
        updateHud();
    }
    function endRun() {
        playing = false;
        document.body.classList.remove("is-playing");
        const isRecord = score > bestScore;
        if (isRecord) {
            bestScore = score;
            saveBest(score);
        }
        bestText.textContent = String(bestScore);
        screenKicker.textContent = "MISSION REPORT";
        screenTitle.innerHTML = isRecord ? 'NEW <span class="gold">RECORD!</span>' : 'SUIT <span class="gold">DOWN!</span>';
        screenText.textContent = `You scored ${score.toLocaleString()} points and reached level ${level}. ${isRecord ? "That's your best ever!" : "Suit up and try again!"}`;
        howTo.style.display = "none";
        startButton.textContent = "▶ Play again";
        screen.classList.add("is-on");
    }
    function loadBest() {
        try {
            return Number(localStorage.getItem("repulsor-rush-best")) || 0;
        }
        catch {
            return 0;
        }
    }
    function saveBest(value) {
        try {
            localStorage.setItem("repulsor-rush-best", String(value));
        }
        catch {
            // storage blocked (private window): the record just won't be remembered
        }
    }
    // ----- HUD -----
    function updateHud() {
        scoreText.textContent = score.toLocaleString();
        levelText.textContent = String(level);
        shieldsText.textContent = shields > 0 ? "♥".repeat(shields) : "-";
        beamFill.style.width = `${beamCharge}%`;
        beamButton.classList.toggle("is-ready", beamCharge >= 100);
    }
    function bump(element) {
        element.classList.remove("bump");
        void element.offsetWidth;
        element.classList.add("bump");
    }
    function showBanner(text) {
        banner.textContent = text;
        banner.classList.remove("show");
        void banner.offsetWidth;
        banner.classList.add("show");
    }
    // ----- spawning -----
    function spawnEnemy() {
        const roll = Math.random();
        const y = 60 + Math.random() * (height - 180);
        let enemy;
        if (level >= 2 && roll < 0.18) {
            enemy = { kind: "tank", x: width + 60, y, baseY: y, radius: 44, speed: 1.2, hp: 5, maxHp: 5, age: 0, fireTimer: 60, hitFlash: 0, points: 300 };
        }
        else if (roll < 0.45) {
            enemy = { kind: "zipper", x: width + 40, y, baseY: y, radius: 20, speed: 5 + level * 0.5, hp: 1, maxHp: 1, age: 0, fireTimer: 0, hitFlash: 0, points: 150 };
        }
        else {
            enemy = { kind: "drone", x: width + 40, y, baseY: y, radius: 28, speed: 2.2 + level * 0.35, hp: 2, maxHp: 2, age: 0, fireTimer: 0, hitFlash: 0, points: 100 };
        }
        enemies.push(enemy);
    }
    function explode(x, y, color, amount) {
        for (let i = 0; i < amount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 6;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1,
                color: Math.random() < 0.3 ? "#ffffff" : color,
                size: 2 + Math.random() * 4,
            });
        }
    }
    function fireMegaBeam() {
        if (!playing || beamCharge < 100 || beamTime > 0)
            return;
        beamCharge = 0;
        beamTime = 75;
        shake = 18;
        showBanner("MEGA BEAM!");
        updateHud();
    }
    // ----- update (one frame; dt = 1 at 60fps) -----
    function update(dt) {
        playTime += dt / 60;
        // level up every 25 seconds
        const newLevel = 1 + Math.floor(playTime / 25);
        if (newLevel > level) {
            level = newLevel;
            showBanner(`LEVEL ${level}!`);
            bump(levelText);
            updateHud();
        }
        // keyboard moves the target point
        const keySpeed = 9 * dt;
        if (keys.has("arrowup") || keys.has("w"))
            player.targetY -= keySpeed;
        if (keys.has("arrowdown") || keys.has("s"))
            player.targetY += keySpeed;
        if (keys.has("arrowleft") || keys.has("a"))
            player.targetX -= keySpeed;
        if (keys.has("arrowright") || keys.has("d"))
            player.targetX += keySpeed;
        player.targetX = Math.min(Math.max(player.targetX, 40), width * 0.75);
        player.targetY = Math.min(Math.max(player.targetY, 40), height - 110);
        // glide toward the target, tilting with vertical movement
        const moveY = (player.targetY - player.y) * 0.18 * dt;
        player.x += (player.targetX - player.x) * 0.18 * dt;
        player.y += moveY;
        player.tilt = Math.max(-0.4, Math.min(0.4, moveY * 0.04));
        // automatic repulsor fire
        fireTimer -= dt;
        if (fireTimer <= 0) {
            fireTimer = 10;
            const handX = player.x + 40 * HERO_SCALE;
            const handY = player.y + 6 * HERO_SCALE;
            bolts.push({ x: handX, y: handY, vx: 16, vy: 0 });
            if (tripleShotTime > 0) {
                bolts.push({ x: handX, y: handY, vx: 15, vy: -3.5 });
                bolts.push({ x: handX, y: handY, vx: 15, vy: 3.5 });
            }
        }
        // new enemies come faster at higher levels
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnEnemy();
            spawnTimer = Math.max(14, 62 - level * 7) * (0.6 + Math.random() * 0.6);
        }
        // move everything
        for (const bolt of bolts) {
            bolt.x += bolt.vx * dt;
            bolt.y += bolt.vy * dt;
        }
        for (const enemy of enemies) {
            enemy.age += dt;
            enemy.x -= enemy.speed * dt;
            enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
            if (enemy.kind === "drone")
                enemy.y = enemy.baseY + Math.sin(enemy.age * 0.05) * 45;
            if (enemy.kind === "tank") {
                enemy.y = enemy.baseY + Math.sin(enemy.age * 0.02) * 30;
                enemy.fireTimer -= dt;
                if (enemy.fireTimer <= 0 && enemy.x < width - 40) {
                    // aim at the player
                    enemy.fireTimer = Math.max(50, 110 - level * 6);
                    const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
                    enemyShots.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 4.5, vy: Math.sin(angle) * 4.5 });
                }
            }
        }
        for (const shot of enemyShots) {
            shot.x += shot.vx * dt;
            shot.y += shot.vy * dt;
        }
        for (const pickup of pickups) {
            pickup.age += dt;
            pickup.x -= 2 * dt;
            pickup.y += Math.sin(pickup.age * 0.08) * 0.8;
        }
        // ----- collisions -----
        // repulsor bolts hit enemies
        for (const bolt of bolts) {
            for (const enemy of enemies) {
                if (enemy.hp > 0 && Math.hypot(bolt.x - enemy.x, bolt.y - enemy.y) < enemy.radius + 6) {
                    bolt.x = width + 999; // remove bolt
                    damageEnemy(enemy, 1);
                    break;
                }
            }
        }
        // the mega beam wipes out everything in front of the chest
        if (beamTime > 0) {
            beamTime -= dt;
            shake = Math.max(shake, 6);
            for (const enemy of enemies) {
                if (enemy.hp > 0 && enemy.x > player.x && Math.abs(enemy.y - player.y) < 70 + enemy.radius)
                    damageEnemy(enemy, 99);
            }
            enemyShots = enemyShots.filter((s) => !(s.x > player.x && Math.abs(s.y - player.y) < 70));
        }
        // getting hit
        if (invincibleTime > 0)
            invincibleTime -= dt;
        for (const enemy of enemies) {
            if (enemy.hp > 0 && Math.hypot(enemy.x - player.x, enemy.y - player.y) < enemy.radius + HERO_RADIUS) {
                damageEnemy(enemy, 99);
                hurtPlayer();
            }
        }
        for (const shot of enemyShots) {
            if (Math.hypot(shot.x - player.x, shot.y - player.y) < HERO_RADIUS) {
                shot.x = -999;
                hurtPlayer();
            }
        }
        // collecting pickups
        for (const pickup of pickups) {
            if (Math.hypot(pickup.x - player.x, pickup.y - player.y) < HERO_RADIUS + 20) {
                pickup.x = -999;
                if (pickup.kind === "core") {
                    tripleShotTime = 8 * 60;
                    showBanner("TRIPLE SHOT!");
                    explode(player.x, player.y, "#5ee7ff", 30);
                }
                else {
                    shields = Math.min(MAX_SHIELDS, shields + 1);
                    showBanner("+1 SHIELD!");
                    explode(player.x, player.y, "#ff3b30", 30);
                    bump(shieldsText);
                }
                updateHud();
            }
        }
        // timers
        if (tripleShotTime > 0)
            tripleShotTime -= dt;
        shake *= 0.88;
        // remove things that are finished or off screen
        bolts = bolts.filter((b) => b.x < width + 20 && b.y > -20 && b.y < height + 20);
        enemies = enemies.filter((e) => e.hp > 0 && e.x > -80);
        enemyShots = enemyShots.filter((s) => s.x > -20 && s.x < width + 20 && s.y > -20 && s.y < height + 20);
        pickups = pickups.filter((p) => p.x > -40);
    }
    function damageEnemy(enemy, amount) {
        enemy.hp -= amount;
        enemy.hitFlash = 6;
        if (enemy.hp > 0)
            return;
        score += enemy.points * level;
        beamCharge = Math.min(100, beamCharge + (enemy.kind === "tank" ? 20 : 8));
        explode(enemy.x, enemy.y, enemy.kind === "tank" ? "#ffc94a" : "#ff8a3d", enemy.kind === "tank" ? 60 : 28);
        shake = Math.max(shake, enemy.kind === "tank" ? 10 : 4);
        bump(scoreText);
        // sometimes drop a power-up
        const roll = Math.random();
        if (roll < 0.08)
            pickups.push({ kind: "heart", x: enemy.x, y: enemy.y, age: 0 });
        else if (roll < 0.2)
            pickups.push({ kind: "core", x: enemy.x, y: enemy.y, age: 0 });
        updateHud();
    }
    function hurtPlayer() {
        if (invincibleTime > 0 || beamTime > 0)
            return;
        shields--;
        invincibleTime = 90;
        shake = 20;
        explode(player.x, player.y, "#ff3b30", 40);
        bump(shieldsText);
        updateHud();
        if (shields <= 0) {
            explode(player.x, player.y, "#ffc94a", 120);
            endRun();
        }
    }
    // ----- drawing -----
    function draw(dt) {
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        if (shake > 0.5)
            ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        // speed lines (they always move, even on the menu)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 2;
        for (const streak of streaks) {
            streak.x -= streak.speed * dt;
            if (streak.x + streak.length < 0) {
                streak.x = width + Math.random() * 200;
                streak.y = Math.random() * height;
            }
            ctx.beginPath();
            ctx.moveTo(streak.x, streak.y);
            ctx.lineTo(streak.x + streak.length, streak.y);
            ctx.stroke();
        }
        for (const pickup of pickups)
            drawPickup(pickup);
        for (const enemy of enemies)
            drawEnemy(enemy);
        // glowing things add their light together
        ctx.globalCompositeOperation = "lighter";
        for (const shot of enemyShots) {
            glowCircle(shot.x, shot.y, 8, "#ff3b30");
        }
        for (const bolt of bolts) {
            ctx.strokeStyle = "#5ee7ff";
            ctx.lineWidth = 5;
            ctx.shadowColor = "#5ee7ff";
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.moveTo(bolt.x, bolt.y);
            ctx.lineTo(bolt.x - bolt.vx * 2.5, bolt.y - bolt.vy * 2.5);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        if (beamTime > 0)
            drawMegaBeam();
        for (const p of particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 0.95;
            p.vy *= 0.95;
            p.life -= 0.022 * dt;
            ctx.globalAlpha = Math.max(p.life, 0);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life + 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
        particles = particles.filter((p) => p.life > 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        // hero blinks while invincible after a hit
        const blinking = invincibleTime > 0 && Math.floor(invincibleTime / 5) % 2 === 0;
        if (playing && !blinking)
            drawHero();
        ctx.restore();
    }
    function glowCircle(x, y, radius, color) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.5);
        glow.addColorStop(0, "#ffffff");
        glow.addColorStop(0.3, color);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    // The hero, flying to the right: jets, legs, body, head, glowing hand
    function drawHero() {
        const flicker = Math.random() * 10;
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.tilt);
        ctx.scale(HERO_SCALE, HERO_SCALE);
        // boot jets
        ctx.globalCompositeOperation = "lighter";
        const flame = ctx.createLinearGradient(-34, 0, -80 - flicker, 0);
        flame.addColorStop(0, "#ffffff");
        flame.addColorStop(0.3, "#ffc94a");
        flame.addColorStop(1, "transparent");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(-34, 2);
        ctx.lineTo(-80 - flicker, 8);
        ctx.lineTo(-34, 14);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        // legs + body (red armor)
        ctx.fillStyle = "#c81d16";
        ctx.strokeStyle = "#5a0b08";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-36, 0, 34, 14, 6);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(-6, -14, 30, 28, 10);
        ctx.fill();
        ctx.stroke();
        // gold arm reaching forward
        ctx.fillStyle = "#ffc94a";
        ctx.beginPath();
        ctx.roundRect(12, 2, 26, 9, 4);
        ctx.fill();
        // chest reactor
        glowCircle(8, -2, 4, "#5ee7ff");
        // head with gold face plate and glowing eye
        ctx.fillStyle = "#c81d16";
        ctx.beginPath();
        ctx.arc(30, -18, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffc94a";
        ctx.beginPath();
        ctx.arc(32, -18, 10, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        ctx.fillStyle = "#e9fbff";
        ctx.shadowColor = "#5ee7ff";
        ctx.shadowBlur = 10;
        ctx.fillRect(34, -22, 7, 3);
        ctx.shadowBlur = 0;
        // glowing palm
        ctx.globalCompositeOperation = "lighter";
        glowCircle(40, 6, 5 + flicker * 0.2, "#5ee7ff");
        ctx.restore();
    }
    function drawEnemy(enemy) {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        const flash = enemy.hitFlash > 0;
        if (enemy.kind === "zipper") {
            // small fast dart pointing left
            ctx.rotate(Math.sin(enemy.age * 0.3) * 0.1);
            ctx.fillStyle = flash ? "#ffffff" : "#ff8a00";
            ctx.beginPath();
            ctx.moveTo(-20, 0);
            ctx.lineTo(14, -12);
            ctx.lineTo(8, 0);
            ctx.lineTo(14, 12);
            ctx.closePath();
            ctx.fill();
            ctx.globalCompositeOperation = "lighter";
            glowCircle(16, 0, 4, "#ff3b30");
        }
        else {
            // round drone (tanks are bigger, with a health bar)
            const r = enemy.radius;
            ctx.rotate(enemy.age * 0.02);
            ctx.fillStyle = flash ? "#ffffff" : enemy.kind === "tank" ? "#3a3f55" : "#4b5068";
            ctx.strokeStyle = enemy.kind === "tank" ? "#ffc94a" : "#b47bff";
            ctx.lineWidth = 4;
            ctx.shadowColor = ctx.strokeStyle; // neon glow around the edge
            ctx.shadowBlur = 16;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.rotate(-enemy.age * 0.02);
            ctx.globalCompositeOperation = "lighter";
            glowCircle(-r * 0.15, 0, r * 0.28, "#ff2a2a");
            ctx.globalCompositeOperation = "source-over";
            if (enemy.kind === "tank") {
                ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
                ctx.fillRect(-r, -r - 14, r * 2, 6);
                ctx.fillStyle = "#ffc94a";
                ctx.fillRect(-r, -r - 14, (r * 2 * enemy.hp) / enemy.maxHp, 6);
            }
        }
        ctx.restore();
    }
    function drawPickup(pickup) {
        const pulse = 1 + Math.sin(pickup.age * 0.15) * 0.15;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (pickup.kind === "core") {
            glowCircle(pickup.x, pickup.y, 10 * pulse, "#5ee7ff");
        }
        else {
            glowCircle(pickup.x, pickup.y, 10 * pulse, "#ff3b30");
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 18px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("♥", pickup.x, pickup.y + 1);
        }
        ctx.restore();
    }
    function drawMegaBeam() {
        const strength = Math.min(1, beamTime / 20);
        const beamHeight = 120 * strength + Math.random() * 12;
        const startX = player.x + 8;
        const beam = ctx.createLinearGradient(0, player.y - beamHeight / 2, 0, player.y + beamHeight / 2);
        beam.addColorStop(0, "transparent");
        beam.addColorStop(0.3, "#5ee7ff");
        beam.addColorStop(0.5, "#ffffff");
        beam.addColorStop(0.7, "#5ee7ff");
        beam.addColorStop(1, "transparent");
        ctx.fillStyle = beam;
        ctx.fillRect(startX, player.y - beamHeight / 2, width - startX, beamHeight);
        glowCircle(startX, player.y, 30 * strength + 10, "#5ee7ff");
    }
    // ----- main loop -----
    let lastTime = performance.now();
    function frame(now) {
        // dt = how many 60fps frames passed (capped so a slow frame can't teleport things)
        const dt = Math.min((now - lastTime) / (1000 / 60), 3);
        lastTime = now;
        if (playing)
            update(dt);
        draw(dt);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
startGame();
//# sourceMappingURL=game.js.map