// Tells TypeScript about the global THREE that libs/three.min.js creates.
// It must list the same add-ons as libs/three-entry.js.

export * from "three";
export { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
export { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
export { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
export { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
export { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// "export as namespace" makes all of the above usable as THREE.Something in normal
// (non-module) scripts like the page scripts
export as namespace THREE;
