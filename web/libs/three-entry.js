// The list of Three.js pieces the 3D game uses, bundled into one file: libs/three.min.js
//
// Why a bundle? The site has to work by double-clicking the .html files (no server), and
// browsers block JavaScript modules ("import ...") on pages opened that way. So esbuild packs
// Three.js and its add-ons into one plain script that puts everything on a global THREE.
//
// Rebuild after changing this list (or updating Three.js):  npm run build:three
// Keep libs/three-globals.d.ts in sync, so TypeScript knows about the same add-ons.

export * from "three";
export { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
export { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
export { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
export { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
export { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
