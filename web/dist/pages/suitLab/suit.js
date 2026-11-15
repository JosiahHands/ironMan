"use strict";
// Suit Lab, part 1: the suit you design.
//   - SuitDesign: every choice you make in the garage
//   - suitStats(): how those choices change the way the suit flies and fights
//   - loadSuit() / saveSuit(): your suit is remembered for next time
//   - drawSuit(): draws the suit (used by the garage preview AND the flight game)
const DEFAULT_SUIT = {
    name: "MARK NOAH-1",
    armor: "#c81d16",
    trim: "#ffc94a",
    eyes: "#5ee7ff",
    helmet: "classic",
    plating: "standard",
    thrusters: "standard",
    weapon: "repulsors",
    special: "unibeam",
};
const SUIT_SAVE_KEY = "suit-lab-suit";
function loadSuit() {
    try {
        const saved = JSON.parse(localStorage.getItem(SUIT_SAVE_KEY) ?? "null");
        if (saved)
            return { ...DEFAULT_SUIT, ...saved };
    }
    catch {
        // storage blocked or broken save: start with the default suit
    }
    return { ...DEFAULT_SUIT };
}
function saveSuit(suit) {
    try {
        localStorage.setItem(SUIT_SAVE_KEY, JSON.stringify(suit));
    }
    catch {
        // storage blocked (private window): the suit just won't be remembered
    }
}
function suitStats(suit) {
    const platingSpeed = { light: 1.2, standard: 1, heavy: 0.8 }[suit.plating];
    const thrusterSpeed = { standard: 1, turbo: 1.35, hover: 0.85 }[suit.thrusters];
    return {
        topSpeed: 10 * platingSpeed * thrusterSpeed,
        grip: { standard: 0.1, turbo: 0.05, hover: 0.2 }[suit.thrusters],
        shields: { light: 3, standard: 5, heavy: 8 }[suit.plating],
        firepower: { repulsors: 0.6, missiles: 0.9, laser: 0.75 }[suit.weapon],
        smash: suit.plating === "heavy",
    };
}
// The four stat bars in the garage, each from 0 to 1
function statBars(suit) {
    const stats = suitStats(suit);
    return {
        speed: stats.topSpeed / 16.2, // 16.2 = light plating + turbo thrusters, the fastest suit
        shields: stats.shields / 8,
        handling: stats.grip / 0.2,
        firepower: stats.firepower,
    };
}
const SUIT_ARM_LENGTH = 28;
// Where the gun arm's shoulder is (the arm swings from here)
function suitShoulder(pose) {
    return {
        x: pose.x + Math.sin(pose.tilt) * 14 * pose.scale,
        y: pose.y - Math.cos(pose.tilt) * 14 * pose.scale,
    };
}
// Where shots come out: the palm at the end of the gun arm
function suitMuzzle(pose) {
    const shoulder = suitShoulder(pose);
    const reach = SUIT_ARM_LENGTH * pose.scale;
    return { x: shoulder.x + Math.cos(pose.aim) * reach, y: shoulder.y + Math.sin(pose.aim) * reach };
}
// Mix a "#rrggbb" color toward black (amount below 0) or white (above 0)
function shade(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const mix = (channel) => Math.round(channel + (target - channel) * Math.abs(amount));
    return `rgb(${mix(value >> 16)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
}
// Rounded rectangle drawn by hand (ctx.roundRect doesn't exist in older Safari)
function suitRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
// A glowing dot: white center fading out through the color
function glowDot(ctx, x, y, radius, color) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.5);
    glow.addColorStop(0, "#ffffff");
    glow.addColorStop(0.3, color);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();
}
function drawSuit(ctx, suit, pose) {
    const bulk = { light: 0.85, standard: 1, heavy: 1.25 }[suit.plating]; // heavier armor is chunkier
    const dark = shade(suit.armor, -0.45);
    const flicker = Math.random();
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.scale(pose.scale, pose.scale);
    ctx.rotate(pose.tilt);
    ctx.scale(pose.facing, 1);
    // boot flames (thruster type changes their color and size)
    const flameColor = { standard: "#ffc94a", turbo: "#7fb2ff", hover: suit.eyes }[suit.thrusters];
    const flameWidth = suit.thrusters === "hover" ? 10 : 7;
    const flameLength = 12 + pose.thrust * (suit.thrusters === "turbo" ? 46 : 32) + flicker * 8;
    ctx.globalCompositeOperation = "lighter";
    for (const footX of [-4 * bulk, 5 * bulk]) {
        const flame = ctx.createLinearGradient(0, 44, 0, 44 + flameLength);
        flame.addColorStop(0, "#ffffff");
        flame.addColorStop(0.3, flameColor);
        flame.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(footX - flameWidth / 2, 43);
        ctx.lineTo(footX, 44 + flameLength);
        ctx.lineTo(footX + flameWidth / 2, 43);
        ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = shade(suit.armor, -0.7);
    ctx.lineWidth = 1.5;
    // missile pod on the back
    if (suit.weapon === "missiles") {
        ctx.fillStyle = dark;
        suitRoundedRect(ctx, -11 * bulk - 9, -24, 11, 18, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ff3b30";
        for (const tipY of [-20, -15, -10])
            ctx.fillRect(-11 * bulk - 11, tipY, 4, 3);
    }
    // back arm, hanging down
    ctx.save();
    ctx.translate(-2, -14);
    ctx.rotate(0.3 + Math.sin(pose.time * 2) * 0.05);
    ctx.fillStyle = dark;
    suitRoundedRect(ctx, -4, 0, 8 * bulk, 26, 4);
    ctx.fill();
    ctx.restore();
    // legs: the back one darker, gold-trimmed boots
    ctx.fillStyle = dark;
    suitRoundedRect(ctx, -8 * bulk, 10, 8 * bulk, 34, 4);
    ctx.fill();
    ctx.fillStyle = suit.armor;
    suitRoundedRect(ctx, 0.5, 10, 9 * bulk, 34, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = suit.trim;
    ctx.fillRect(0.5, 36, 9 * bulk, 8);
    ctx.fillRect(0.5, 22, 9 * bulk, 3); // knee stripe
    // body
    ctx.fillStyle = suit.armor;
    suitRoundedRect(ctx, -11 * bulk, -21, 22 * bulk, 35, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = suit.trim;
    ctx.fillRect(-11 * bulk + 2, 3, 22 * bulk - 4, 5); // belt
    // shoulder pad (heavy armor gets a big one)
    const padSize = { light: 0, standard: 6, heavy: 10 }[suit.plating];
    if (padSize) {
        ctx.fillStyle = shade(suit.armor, 0.15);
        ctx.beginPath();
        ctx.arc(-1, -16, padSize, Math.PI, 0);
        ctx.fill();
        ctx.stroke();
    }
    // chest reactor
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, 5 * bulk, -8, 3.5 + flicker * 0.6, suit.eyes);
    ctx.globalCompositeOperation = "source-over";
    // head
    ctx.fillStyle = suit.helmet === "stealth" ? shade(suit.armor, -0.6) : suit.armor;
    ctx.beginPath();
    ctx.arc(1, -32, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = suit.eyes;
    ctx.shadowBlur = 10;
    if (suit.helmet === "classic") {
        // the famous gold face plate with a glowing eye slit
        ctx.fillStyle = suit.trim;
        ctx.beginPath();
        ctx.arc(3, -32, 9, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        ctx.fillStyle = shade(suit.eyes, 0.6);
        ctx.fillRect(5, -36, 7, 3);
    }
    else if (suit.helmet === "stealth") {
        // dark helmet with one wide visor
        ctx.fillStyle = suit.eyes;
        ctx.fillRect(1, -35, 12, 4);
    }
    else {
        // spartan: crest on top and a T-shaped visor
        ctx.fillStyle = suit.trim;
        ctx.beginPath();
        ctx.moveTo(-8, -40);
        ctx.lineTo(4, -48);
        ctx.lineTo(6, -41);
        ctx.fill();
        ctx.fillStyle = suit.eyes;
        ctx.fillRect(3, -36, 9, 3);
        ctx.fillRect(8, -36, 3, 9);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
    // gun arm: drawn on its own, pointing wherever you aim
    const shoulder = suitShoulder(pose);
    ctx.save();
    ctx.translate(shoulder.x, shoulder.y);
    ctx.scale(pose.scale, pose.scale);
    ctx.rotate(pose.aim);
    ctx.fillStyle = suit.armor;
    ctx.strokeStyle = shade(suit.armor, -0.7);
    ctx.lineWidth = 1.5;
    suitRoundedRect(ctx, -4, -4.5 * bulk, 24, 9 * bulk, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = suit.trim;
    suitRoundedRect(ctx, 13, -5 * bulk, 12, 10 * bulk, 3); // gauntlet
    ctx.fill();
    if (suit.weapon === "laser") {
        ctx.fillStyle = suit.eyes; // laser emitter along the top of the wrist
        ctx.fillRect(14, -8, 12, 3);
    }
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, SUIT_ARM_LENGTH, 0, (pose.firing ? 5 : 3) + flicker, suit.eyes);
    ctx.restore();
}
//# sourceMappingURL=suit.js.map