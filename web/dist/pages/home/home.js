"use strict";
// Home page: all the interactive parts.
// (Cursor, click blasts, reveals and count-ups come from shared/shared.ts)
function startHome() {
    splitLetters();
    setupScrollEffects();
    setupHeroArt();
    setupSuitCards();
    setupReactor();
    setupFlipCards();
    setupSuitLab();
    setupLaunch();
}
// Split headings marked data-split into single letters so each one can animate
function splitLetters() {
    let index = 0;
    document.querySelectorAll("[data-split]").forEach((element) => {
        const text = element.textContent ?? "";
        element.textContent = "";
        for (const char of text) {
            const letter = document.createElement("span");
            letter.className = "letter";
            letter.textContent = char === " " ? " " : char;
            letter.style.setProperty("--i", String(index++));
            element.append(letter);
        }
    });
}
// ---------------------------------------------------------------------------
// Everything that reacts to scrolling
// ---------------------------------------------------------------------------
function setupScrollEffects() {
    const nav = document.getElementById("nav");
    const powerFill = document.getElementById("scroll-power");
    const timeline = document.getElementById("timeline");
    const parallaxImages = document.querySelectorAll("[data-parallax]");
    const navLinks = document.querySelectorAll(".nav-links a");
    function onScroll() {
        const scrollTop = window.scrollY;
        const pageHeight = document.documentElement.scrollHeight - window.innerHeight;
        // nav turns solid after scrolling a little
        nav.classList.toggle("is-solid", scrollTop > 40);
        // power bar at the top fills from 0% to 100% over the whole page
        powerFill.style.transform = `scaleX(${scrollTop / pageHeight})`;
        // images drift at different speeds for a 3D feel
        parallaxImages.forEach((image) => {
            const speed = Number(image.dataset.parallax);
            const box = image.getBoundingClientRect();
            const offset = box.top + box.height / 2 - window.innerHeight / 2;
            image.style.transform = `translateY(${offset * speed}px)`;
        });
        // timeline line grows as the timeline scrolls through the screen
        const box = timeline.getBoundingClientRect();
        const progress = (window.innerHeight * 0.75 - box.top) / box.height;
        timeline.style.setProperty("--line-fill", `${Math.min(Math.max(progress, 0), 1) * 100}%`);
        // highlight the nav link for the section on screen
        navLinks.forEach((link) => {
            const section = document.querySelector(link.hash);
            if (!section)
                return;
            const sectionBox = section.getBoundingClientRect();
            link.classList.toggle("is-active", sectionBox.top < 200 && sectionBox.bottom > 200);
        });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
}
// ---------------------------------------------------------------------------
// Hero photo leans toward the mouse; the repulsor charge flickers
// ---------------------------------------------------------------------------
function setupHeroArt() {
    const art = document.getElementById("hero-art");
    const charge = document.getElementById("hero-charge");
    window.addEventListener("pointermove", (event) => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        art.style.setProperty("--ry", `${x * 18}deg`);
        art.style.setProperty("--rx", `${-y * 14}deg`);
    });
    setInterval(() => {
        charge.textContent = String(94 + Math.floor(Math.random() * 7));
    }, 400);
}
// ---------------------------------------------------------------------------
// Suit cards: 3D tilt + glare follow the mouse, click to scan
// ---------------------------------------------------------------------------
function setupSuitCards() {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
        card.addEventListener("pointermove", (event) => {
            const box = card.getBoundingClientRect();
            const x = (event.clientX - box.left) / box.width;
            const y = (event.clientY - box.top) / box.height;
            card.style.setProperty("--ry", `${(x - 0.5) * 20}deg`);
            card.style.setProperty("--rx", `${(0.5 - y) * 20}deg`);
            card.style.setProperty("--mx", `${x * 100}%`);
            card.style.setProperty("--my", `${y * 100}%`);
        });
        card.addEventListener("pointerleave", () => {
            card.style.setProperty("--ry", "0deg");
            card.style.setProperty("--rx", "0deg");
        });
        card.addEventListener("click", () => {
            // restart the scan animation even if it was already scanned
            card.classList.remove("is-scanning");
            void card.offsetWidth;
            card.classList.add("is-scanning", "is-scanned");
        });
    });
}
// ---------------------------------------------------------------------------
// Arc reactor: click to charge, it drains if you stop, 100% = OVERLOAD
// ---------------------------------------------------------------------------
function setupReactor() {
    const reactor = document.getElementById("reactor-button");
    const fill = document.getElementById("reactor-fill");
    const percentText = document.getElementById("reactor-percent");
    const message = document.getElementById("reactor-message");
    const rings = reactor.querySelectorAll(".ring");
    const messages = [
        { at: 25, text: "Warming up..." },
        { at: 50, text: "Halfway there! Faster!" },
        { at: 75, text: "Power surging!!" },
        { at: 90, text: "ALMOST THERE!!!" },
    ];
    let power = 0; // 0 to 100
    let overloaded = false;
    let lastMessage = "";
    let ringAngle = 0;
    function showMessage(text) {
        if (text === lastMessage)
            return;
        lastMessage = text;
        message.textContent = text || " ";
        message.classList.remove("pop");
        void message.offsetWidth;
        message.classList.add("pop");
    }
    reactor.addEventListener("click", () => {
        if (overloaded)
            return;
        power = Math.min(100, power + 7);
        if (power >= 100)
            overload();
    });
    function overload() {
        overloaded = true;
        showMessage("⚡ OVERLOAD! ⚡ You're a natural, Noah!");
        reactor.classList.add("is-overload");
        document.body.classList.add("flash");
        // a big ring of blasts around the reactor
        const box = reactor.getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        fireBlast(centerX, centerY, "#ffffff", 4);
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            setTimeout(() => {
                fireBlast(centerX + Math.cos(angle) * box.width * 0.7, centerY + Math.sin(angle) * box.width * 0.7, i % 2 ? "#ffc94a" : "#5ee7ff", 1.5);
            }, i * 60);
        }
        setTimeout(() => {
            reactor.classList.remove("is-overload");
            document.body.classList.remove("flash");
            overloaded = false;
            power = 0;
            showMessage("Recharged. Want to go again?");
        }, 2200);
    }
    // Every frame: drain power, spin the rings, update the display
    function tick() {
        if (!overloaded)
            power = Math.max(0, power - 0.18);
        const level = power / 100;
        ringAngle += 1 + level * 14;
        rings[0].style.transform = `rotate(${ringAngle}deg)`;
        rings[1].style.transform = `rotate(${-ringAngle * 0.6}deg)`;
        rings[2].style.transform = `rotate(${ringAngle * 1.6}deg)`;
        reactor.style.setProperty("--power", level.toFixed(3));
        fill.style.width = `${power}%`;
        percentText.textContent = String(Math.round(power));
        if (!overloaded) {
            const reached = messages.filter((m) => power >= m.at).pop();
            showMessage(reached ? reached.text : "");
        }
        requestAnimationFrame(tick);
    }
    tick();
}
// ---------------------------------------------------------------------------
// Power cards flip over and count up their number
// ---------------------------------------------------------------------------
function setupFlipCards() {
    document.querySelectorAll(".flip-card").forEach((card) => {
        card.addEventListener("click", () => {
            card.classList.toggle("is-flipped");
            const number = card.querySelector("[data-count-to]");
            if (number && card.classList.contains("is-flipped"))
                countUp(number);
        });
    });
}
// ---------------------------------------------------------------------------
// Suit lab: pick colors and a name for your own helmet
// ---------------------------------------------------------------------------
function setupSuitLab() {
    const helmet = document.querySelector(".helmet");
    const nameInput = document.getElementById("suit-name");
    const nameDisplay = document.getElementById("suit-name-display");
    const randomButton = document.getElementById("random-suit");
    const swatchGroups = document.querySelectorAll(".swatches");
    function celebrate() {
        helmet.classList.remove("is-updated");
        void helmet.getBoundingClientRect();
        helmet.classList.add("is-updated");
    }
    // part is "armor", "trim" or "eyes"; matches the CSS variables on the helmet
    function pick(group, button) {
        group.querySelectorAll("button").forEach((b) => b.classList.remove("is-picked"));
        button.classList.add("is-picked");
        helmet.style.setProperty(`--${group.dataset.part}`, button.dataset.color ?? "");
    }
    swatchGroups.forEach((group) => {
        pick(group, group.querySelector("button")); // start with the first color
        group.addEventListener("click", (event) => {
            const button = event.target.closest("button");
            if (!button)
                return;
            pick(group, button);
            celebrate();
        });
    });
    nameInput.addEventListener("input", () => {
        nameDisplay.textContent = nameInput.value.toUpperCase() || "MARK ???";
    });
    randomButton.addEventListener("click", () => {
        swatchGroups.forEach((group) => {
            const buttons = group.querySelectorAll("button");
            pick(group, buttons[Math.floor(Math.random() * buttons.length)]);
        });
        const number = Math.floor(Math.random() * 99) + 1;
        nameInput.value = `MARK NOAH-${number}`;
        nameDisplay.textContent = nameInput.value;
        celebrate();
    });
}
// ---------------------------------------------------------------------------
// Launch button: 3-2-1 countdown, then off to the game
// ---------------------------------------------------------------------------
function setupLaunch() {
    const button = document.getElementById("launch-button");
    const overlay = document.getElementById("countdown");
    const number = document.getElementById("countdown-number");
    button.addEventListener("click", () => {
        overlay.classList.add("is-on");
        let count = 3;
        function show(text) {
            number.textContent = text;
            number.classList.remove("tick");
            void number.offsetWidth;
            number.classList.add("tick");
            fireBlast(window.innerWidth / 2, window.innerHeight / 2, "#ffc94a", 2.5);
        }
        show(String(count));
        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                show(String(count));
            }
            else {
                clearInterval(timer);
                show("GO!");
                setTimeout(() => (window.location.href = "../game/game.html"), 600);
            }
        }, 800);
    });
}
startHome();
//# sourceMappingURL=home.js.map