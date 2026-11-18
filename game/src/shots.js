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
// (avenue x = 42), drives east along 42nd St, turns south and rams the
// parked Citra on Coral Ave — a real collision, real heat, wanted level 2
// — then keeps driving south past it while two police cars close in from
// behind. Every step runs the real rules (game.stepWorld); nothing is
// staged. The camera sits south-east of the player looking north-west,
// so the player's car is seen front-three-quarter speeding south with
// the pursuit visible behind it, plus the wanted stars and the minimap.
// (The route is short — the ram lands ~7 s after the steal, inside the
// 10 s quiet window, so heat is still 50 at the frame. A longer westward
// route was tried and dropped: the drive took 12 s, heat decayed below
// the level-2 threshold before the frame.)
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
  // 3/4 rear camera: south-east of the player (yaw 0.6) looking
  // north-west, so the car is seen front-three-quarter speeding west
  // with the pursuit behind it up the road.
  input.yaw = 0.6;
  input.pitch = 0.4;
  input.distance = 12;

  input._ePressed = true;
  game.stepWorld(STEP);
  if (player.mode !== 'car') throw new Error('chase shot: steal failed');

  // Phase 2: waypoint drive (real driving, real rules) — north on Marina
  // Ave to 42nd St, east along it to Coral Ave, south into the parked
  // Citra. The Citra sits 1.6 m off the southbound lane, so the player
  // cannot pass without hitting it: a real ram, real heat, wanted 2.
  // The route is short (the ram lands ~7 s after the steal), so heat has
  // not decayed below the level-2 threshold yet.
  const waypoints = [
    { x: 45.8, z: 42 },
    { x: 134.2, z: 42 },
    { x: 134.2, z: 58.5 },
  ];
  let wp = 0;
  const wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  for (let i = 0; i < 1500 && wp < waypoints.length; i++) {
    const target = waypoints[wp];
    const dx = target.x - player.pos.x;
    const dz = target.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) { wp += 1; continue; }
    const desired = Math.atan2(dx, dz);
    const err = wrapAngle(desired - player.heading);
    const steer = err > 0.05 ? -1 : err < -0.05 ? 1 : 0;
    let throttle = Math.abs(err) > 0.5 ? 0 : 1;
    // Follow, don't ram: if a traffic car is ahead in our lane going our
    // way, coast behind it instead of rear-ending it. Rear-ending adds
    // heat (level 3 + roadblock) and the bump can shove the car off the
    // road into a building. The Sirocco ram is the only ram we want.
    if (throttle > 0) {
      const fx = Math.sin(player.heading);
      const fz = Math.cos(player.heading);
      for (const t of traffic.getState()) {
        const rx = t.x - player.pos.x;
        const rz = t.z - player.pos.z;
        const along = rx * fx + rz * fz;
        if (along <= 0 || along > 12) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat > 3) continue;
        const tx2 = Math.sin(t.heading);
        const tz2 = Math.cos(t.heading);
        if (tx2 * fx + tz2 * fz < 0.2) continue;
        throttle = 0;
        break;
      }
    }
    input.setSynthetic(throttle, steer, false);
    game.stepWorld(STEP);
  }
  if (police.level < 2) throw new Error(`chase shot: ram did not raise wanted to 2 (level ${police.level})`);

  // Phase 3: keep driving south past the rammed Citra for 1 s, then the
  // frame. The east-biased target (x = 143 while still beside the Citra)
  // steers the car around the Citra's east side instead of pushing
  // through it; once past, it holds the avenue centre. 60 steps only:
  // a stopped traffic car waits further south on this avenue, and the
  // player rear-ends it around step 90 — the frame is taken while the
  // player is still moving and the nearest police car is right on its
  // tail.
  for (let i = 0; i < 60; i++) {
    const tx = player.pos.z < 64 ? 143 : 138;
    const tz = player.pos.z + 40;
    const desired = Math.atan2(tx - player.pos.x, tz - player.pos.z);
    const err = wrapAngle(desired - player.heading);
    const steer = err > 0.05 ? -1 : err < -0.05 ? 1 : 0;
    let throttle = 1;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    for (const t of traffic.getState()) {
      const rx = t.x - player.pos.x;
      const rz = t.z - player.pos.z;
      const along = rx * fx + rz * fz;
      if (along <= 0 || along > 12) continue;
      const lat = Math.abs(rx * fz - rz * fx);
      if (lat > 3) continue;
      const tx2 = Math.sin(t.heading);
      const tz2 = Math.cos(t.heading);
      if (tx2 * fx + tz2 * fz < 0.2) continue;
      throttle = 0;
      break;
    }
    input.setSynthetic(throttle, steer, false);
    game.stepWorld(STEP);
  }
  input.setSynthetic(0, 0, false);

  hud.update(game.getHudState());
  lights.follow(player.pos);
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);
}
