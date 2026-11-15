"use strict";
// Landing page: a spinning network globe (like Cloudflare's) in Iron Man colors,
// with glowing energy arcs flying between points. The mouse tilts the globe.
function startLanding() {
    const canvas = document.getElementById("globe");
    // keeps the drawing grid matched to the canvas box, so the globe is never stretched
    const { ctx, size, sync } = keepCanvasSized(canvas);
    // Spread points evenly over a sphere (the "golden spiral" trick)
    const points = [];
    const pointCount = 700;
    for (let i = 0; i < pointCount; i++) {
        const y = 1 - (i / (pointCount - 1)) * 2; // from 1 down to -1
        const ringRadius = Math.sqrt(1 - y * y);
        const angle = i * Math.PI * (3 - Math.sqrt(5));
        points.push({ x: Math.cos(angle) * ringRadius, y, z: Math.sin(angle) * ringRadius });
    }
    const randomPoint = () => points[Math.floor(Math.random() * points.length)];
    // Energy arcs between random points; finished arcs are replaced with new ones
    const arcs = [];
    const newArc = () => ({ from: randomPoint(), to: randomPoint(), progress: 0, speed: 0.006 + Math.random() * 0.01 });
    for (let i = 0; i < 14; i++)
        arcs.push({ ...newArc(), progress: Math.random() });
    let spin = 0;
    let tiltX = 0.35;
    let targetTiltX = 0.35;
    let extraSpin = 0;
    // Mouse movement tilts the globe and speeds up the spin a little
    window.addEventListener("pointermove", (event) => {
        targetTiltX = 0.35 + (event.clientY / window.innerHeight - 0.5) * 0.6;
        extraSpin = (event.clientX / window.innerWidth - 0.5) * 0.01;
    });
    // Rotate a point on the sphere, then flatten it onto the screen
    function project(p) {
        const cosY = Math.cos(spin);
        const sinY = Math.sin(spin);
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const cosX = Math.cos(tiltX);
        const sinX = Math.sin(tiltX);
        const y2 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;
        const radius = size.width * 0.36; // leaves room for the arcs that loop outside the globe
        return { x: size.width / 2 + x1 * radius, y: size.height / 2 + y2 * radius, depth: z2 };
    }
    // A point partway along the arc, lifted off the surface so arcs curve outward
    function arcPoint(arc, t) {
        const lift = 1 + Math.sin(t * Math.PI) * 0.35;
        const x = arc.from.x + (arc.to.x - arc.from.x) * t;
        const y = arc.from.y + (arc.to.y - arc.from.y) * t;
        const z = arc.from.z + (arc.to.z - arc.from.z) * t;
        const length = Math.hypot(x, y, z) || 1;
        return { x: (x / length) * lift, y: (y / length) * lift, z: (z / length) * lift };
    }
    function draw() {
        spin += 0.003 + extraSpin;
        tiltX += (targetTiltX - tiltX) * 0.05;
        sync(); // final check every frame that the canvas matches its box
        ctx.clearRect(0, 0, size.width, size.height);
        const dot = size.width / 400;
        // Dots: front ones are bright gold, back ones are faint red
        for (const p of points) {
            const s = project(p);
            const front = s.depth < 0;
            ctx.fillStyle = front ? "rgba(255, 201, 74, 0.9)" : "rgba(215, 38, 30, 0.35)";
            ctx.beginPath();
            ctx.arc(s.x, s.y, front ? dot * 1.4 : dot * 0.9, 0, Math.PI * 2);
            ctx.fill();
        }
        // Arcs: a faint trail plus a bright head traveling along it
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < arcs.length; i++) {
            const arc = arcs[i];
            arc.progress += arc.speed;
            if (arc.progress > 1.3) {
                arcs[i] = newArc();
                continue;
            }
            ctx.beginPath();
            const tail = Math.max(0, arc.progress - 0.35);
            const head = Math.min(1, arc.progress);
            for (let t = tail; t <= head; t += 0.02) {
                const s = project(arcPoint(arc, t));
                if (t === tail)
                    ctx.moveTo(s.x, s.y);
                else
                    ctx.lineTo(s.x, s.y);
            }
            ctx.strokeStyle = "rgba(94, 231, 255, 0.7)";
            ctx.lineWidth = dot * 1.5;
            ctx.shadowColor = "#5ee7ff";
            ctx.shadowBlur = 12;
            ctx.stroke();
            if (arc.progress <= 1) {
                const h = project(arcPoint(arc, head));
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(h.x, h.y, dot * 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = "source-over";
        requestAnimationFrame(draw);
    }
    draw();
    // Enter button: power-up animation, then go to the home page
    const enterButton = document.getElementById("enter-button");
    enterButton.addEventListener("click", (event) => {
        event.preventDefault();
        enterButton.classList.add("is-launching");
        const box = enterButton.getBoundingClientRect();
        fireBlast(box.left + box.width / 2, box.top + box.height / 2, "#ffc94a", 3);
        setTimeout(() => (window.location.href = enterButton.href), 650);
    });
}
startLanding();
//# sourceMappingURL=script.js.map