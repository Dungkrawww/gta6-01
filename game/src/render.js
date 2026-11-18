// Solara City — renderer, sun-soaked lighting, sky, third-person camera (F2).
// Shadow map type is set EXPLICITLY to THREE.PCFShadowMap: Chromium 159
// removed PCFSoftShadowMap, so leaving the type at its default would break.
import * as THREE from '../vendor/three.module.min.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  // Bright coastal sky; warm haze swallows the far edge of the city.
  scene.background = new THREE.Color(0x8ec8e8);
  scene.fog = new THREE.Fog(0xd8e8f0, 260, 780);
  return scene;
}

// Sun high in a clear sky + warm sky bounce. Returns the sun so the caller
// can keep its shadow frustum centred on the player.
export function createLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -140;
  sun.shadow.camera.right = 140;
  sun.shadow.camera.top = 140;
  sun.shadow.camera.bottom = -140;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0004;
  const sunDir = new THREE.Vector3(-0.45, -1, -0.35).normalize();
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0xe8c9a0, 0.85);
  scene.add(hemi);

  return {
    sun,
    sunDir,
    follow(target) {
      sun.position.copy(target).addScaledVector(sunDir, -180);
      sun.target.position.copy(target);
      sun.target.updateMatrixWorld();
    },
  };
}

export function createCamera() {
  return new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1400);
}

// Third-person orbit: camera sits behind/above the target at the input
// yaw/pitch/distance and looks slightly above the target's feet.
export function updateCamera(camera, target, yaw, pitch, distance) {
  const cx = target.x + Math.sin(yaw) * Math.cos(pitch) * distance;
  const cy = target.y + 1.4 + Math.sin(pitch) * distance;
  const cz = target.z + Math.cos(yaw) * Math.cos(pitch) * distance;
  camera.position.set(cx, Math.max(cy, 0.6), cz);
  camera.lookAt(target.x, target.y + 1.3, target.z);
}

export function resizeRenderer(renderer, camera) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
