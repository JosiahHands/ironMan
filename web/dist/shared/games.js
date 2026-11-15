"use strict";
// The list of all games, shown on the All Games page (pages/games/).
//
// To add a game:
//   1. build it in its own folder, e.g. web/pages/<game-name>/<game-name>.html
//   2. record its preview:  node tools/capture-game.ts pages/<game-name>/<game-name>.html <game-name>
//   3. add an entry below
//
// All paths are relative to the web/ folder.
const GAMES = [
    {
        title: "Repulsor Rush",
        tagline: "Blast drone swarms above the clouds. Fill the meter, fire the MEGA BEAM!",
        page: "pages/game/game.html",
        preview: "media/images/games/repulsor-rush-preview.webp",
        still: "media/images/games/repulsor-rush.webp",
        bestScoreKey: "repulsor-rush-best",
    },
];
//# sourceMappingURL=games.js.map