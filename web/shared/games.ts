// The list of all games, shown on the All Games page (pages/games/).
//
// To add a game:
//   1. build it in its own folder, e.g. web/pages/<game-name>/<game-name>.html
//   2. record its preview:  node tools/capture-game.ts pages/<game-name>/<game-name>.html <game-name>
//   3. add an entry below
//
// All paths are relative to the web/ folder.

type GameInfo = {
  title: string;
  tagline: string; // one short, exciting line
  page: string; // the game's page
  preview: string; // animated preview (from tools/capture-game.ts)
  still: string; // still image, shown while the preview loads
  bestScoreKey?: string; // where the game saves its best score in the browser, if it does
};

const GAMES: GameInfo[] = [
  {
    title: "Repulsor Rush",
    tagline: "Blast drone swarms above the clouds. Fill the meter, fire the MEGA BEAM!",
    page: "pages/game/game.html",
    preview: "media/images/games/repulsor-rush-preview.webp",
    still: "media/images/games/repulsor-rush.webp",
    bestScoreKey: "repulsor-rush-best",
  },
];
