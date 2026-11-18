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
    game.stepWorld(STEP);
  }
  input.setSynthetic(0, 0, false);
  hud.update(game.getHudState());
  lights.follow(player.pos);
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);
}

export function runShot(game, shotName) {
  if (shotName === 'street') {
    runStreetShot(game, 360);
  } else if (shotName === 'chase') {
    runChaseShot(game);
  } else {
    throw new Error(`unknown shot: ${shotName}`);
  }
  window.__shotReady = true;
}

// Chase shot (cover): Raka steals the north-facing Sirocco on Marina Ave
// (avenue x = 42), rams a traffic car ahead on the same avenue — a real
// collision, real heat, wanted level 2 — then cruises north while two
// police cars close in from behind. Every step runs the real rules
// (game.stepWorld); nothing is staged. Camera sits off to the side-behind
// so the pursuing police cars are in the frame with the player's car,
// the wanted stars, and the minimap.
function runChaseShot(game) {
  const { player, input, hud, lights, camera, renderer, scene, traffic, police } = game;
  const avenueX = 42;

  // Steal target: the north-facing parked car on this avenue (seed 1:
  // Sirocco at x = 45.8, z = 60.4, heading PI). Stand behind it, press E.
  const stealCar = player.cars.find((c) => c.heading === Math.PI && Math.abs(c.x - (avenueX + 3.8)) < 1);
  if (!stealCar) throw new Error('chase shot: no north-facing parked car on the avenue');
  player.pos.set(stealCar.x, 0, stealCar.z + 2.0);
  player.heading = Math.PI;
  player.mode = 'foot';
  player.speed = 0;
  player.figure.visible = true;
  input.yaw = 0.7;
  input.pitch = 0.32;
  input.distance = 9;

  input._ePressed = true;
  game.stepWorld(STEP);
  if (player.mode !== 'car') throw new Error('chase shot: steal failed');

  // Phase 2: ram a traffic car ahead on the same avenue. Aim at the
  // nearest one (bang-bang steering toward its x), full throttle.
  // Exits when the ram raises wanted to level 2, or after 300 steps.
  let rammed = false;
  for (let i = 0; i < 300 && !rammed; i++) {
    if (police.level >= 2) { rammed = true; break; }
    const ahead = traffic.getState()
      .filter((c) => Math.abs(c.x - player.pos.x) < 4 && c.z < player.pos.z && player.pos.z - c.z < 80)
      .sort((a, b) => b.z - a.z)[0];
    const steer = ahead ? (ahead.x - player.pos.x > 1 ? 1 : ahead.x - player.pos.x < -1 ? -1 : 0) : 0;
    input.setSynthetic(1, steer, false);
    game.stepWorld(STEP);
  }
  if (police.level < 2) throw new Error(`chase shot: ram did not raise wanted to 2 (level ${police.level})`);

  // Phase 3: cruise north for 8 seconds while the police close in.
  // Pulsed throttle keeps the speed near 18 m/s so the pursuit (with
  // rubber-banding) sits 10-20 m behind; lane-keep holds the avenue.
  for (let i = 0; i < 480; i++) {
    const throttle = (i % 5 < 3) ? 1 : 0;
    const err = player.pos.x - avenueX;
    const steer = err > 2 ? -1 : err < -2 ? 1 : 0;
    input.setSynthetic(throttle, steer, false);
    game.stepWorld(STEP);
  }
  input.setSynthetic(0, 0, false);

  hud.update(game.getHudState());
  lights.follow(player.pos);
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);
}
