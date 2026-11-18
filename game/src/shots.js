// Solara City — deterministic screenshot scenes (F16, Block A: street only).
// Each shot plays the REAL rules forward from a fresh world for a fixed
// number of steps, then sets window.__shotReady. Same seed = same frame.
// Later blocks add chase / mission / city shots in this same file.
import { STEP, DEFAULT_SEED } from './config.js';
import { updateCamera } from './render.js';

export function getShotParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    shot: params.get('shot'),
    seed: Number(params.get('seed') || DEFAULT_SEED),
  };
}

// Street shot: Raka walks north along Palm Ave (avenue index 1) for 6
// seconds of real walking. Camera sits behind him; buildings line both
// sides, parked cars wait at the kerb, HUD + minimap visible.
function runStreetShot(game, steps) {
  const { player, input, hud, lights, camera, renderer, scene } = game;
  // Start mid-block on Palm Ave (avenue index 1) so the frame ends with
  // Raka mid-block: buildings on both sides, street receding ahead.
  // x = -148 keeps him off the centre dashes, on the right-hand lane.
  player.pos.set(-148, 0, 42);
  player.heading = Math.PI;
  player.mode = 'foot';
  player.speed = 0;
  player.figure.visible = true;
  input.yaw = 0;
  input.pitch = 0.28;
  input.distance = 6.5;
  input.setSynthetic(1, 0, false);
  for (let i = 0; i < steps; i++) {
    player.step(STEP, input);
  }
  input.setSynthetic(0, 0, false);
  hud.update(player.getState());
  lights.follow(player.pos);
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);
}

export function runShot(game, shotName) {
  if (shotName === 'street') {
    runStreetShot(game, 360);
  } else {
    throw new Error(`unknown shot: ${shotName}`);
  }
  window.__shotReady = true;
}
