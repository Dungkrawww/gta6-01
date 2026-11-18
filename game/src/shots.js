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
  } else if (shotName === 'mission') {
    runMissionShot(game);
  } else if (shotName === 'city') {
    runCityShot(game);
  } else {
    throw new Error(`unknown shot: ${shotName}`);
  }
  window.__shotReady = true;
}

// Mission shot: a real M1 run — steal the Sirocco, drive to the pickup,
// take the package with E, then drive south toward Kantor Coral. The
// frame catches Raka mid-delivery with the objective and the timer in
// the HUD and the delivery marker ahead. Every step runs the real rules.
function runMissionShot(game) {
  const { player, input, hud, lights, camera, renderer, scene, traffic, police, mission } = game;
  const avenueX = 42;

  const stealCar = player.cars.find((c) => c.heading === Math.PI && Math.abs(c.x - (avenueX + 3.8)) < 1);
  if (!stealCar) throw new Error('mission shot: no north-facing parked car on the avenue');
  player.pos.set(stealCar.x, 0, stealCar.z + 2.0);
  player.heading = Math.PI;
  player.mode = 'foot';
  player.speed = 0;
  player.figure.visible = true;
  input.yaw = 0.6;
  input.pitch = 0.4;
  input.distance = 12;

  input._ePressed = true;
  game.stepWorld(STEP);
  if (player.mode !== 'car') throw new Error('mission shot: steal failed');

  const wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  // Waypoint driver with the chase shot's traffic check: coast behind a
  // same-direction car ahead instead of rear-ending it. Sharp turns cut
  // the throttle only while the car is already moving — from a
  // standstill the car cannot steer at all.
  const driveTo = (waypoints, maxSteps, onStep) => {
    let wp = 0;
    for (let i = 0; i < maxSteps && wp < waypoints.length; i++) {
      const target = waypoints[wp];
      const dx = target.x - player.pos.x;
      const dz = target.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3) { wp += 1; continue; }
      const desired = Math.atan2(dx, dz);
      const err = wrapAngle(desired - player.heading);
      const steer = err > 0.05 ? -1 : err < -0.05 ? 1 : 0;
      let throttle = Math.abs(err) > 0.5 && Math.abs(player.speed) > 3 ? 0 : 1;
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
      if (onStep) onStep();
      game.stepWorld(STEP);
    }
    return wp >= waypoints.length;
  };

  // Phase 1: north on Lagoon Ave, west on 3rd St to the pickup ring.
  // The pickup is an on-foot action: stop at the ring, get out (E),
  // take the package (E), get back in the same car (E), then keep
  // driving. The trigger fires inside 5 m so the exit (2.4 m to the
  // side) can never leave the player outside the 8 m pickup radius.
  let pickedUp = false;
  driveTo(
    [{ x: 42, z: -102 }, { x: -102, z: -102 }],
    2400,
    () => {
      if (pickedUp || mission.state !== 'idle') return;
      if (Math.hypot(-102 - player.pos.x, -102 - player.pos.z) >= 5) return;
      if (player.mode === 'car') {
        // Three E presses, one step each — exactly like a real player:
        // exit, pick up on foot, re-enter.
        input.setSynthetic(0, 0, false);
        input._ePressed = true; game.stepWorld(STEP); // exit
        input._ePressed = true; game.stepWorld(STEP); // pick up
        input._ePressed = true; game.stepWorld(STEP); // re-enter
      } else {
        // Already on foot near the ring (retry after a missed pickup):
        // take the package, then get back in.
        input._ePressed = true; game.stepWorld(STEP); // pick up
        input._ePressed = true; game.stepWorld(STEP); // re-enter
      }
      if (mission.state === 'active') pickedUp = true;
    },
  );
  if (mission.state !== 'active') throw new Error(`mission shot: pickup failed (state ${mission.state})`);

  // Phase 2: south on Palm Ave, east on 6th St, south on Breeze Ave
  // toward Kantor Coral. Frame partway there, still carrying.
  driveTo([{ x: -102, z: 42 }, { x: 138, z: 42 }, { x: 138, z: 100 }], 2400);
  if (mission.state !== 'active') throw new Error(`mission shot: mission lost on the way (state ${mission.state})`);
  if (mission.timeLeft <= 0) throw new Error('mission shot: timer expired');

  input.setSynthetic(0, 0, false);
  hud.update(game.getHudState());
  lights.follow(player.pos);
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);
}

// City shot: a wide vista from the west edge — Raka on foot on Sunset
// Ave, camera high above the rooftops and looking east across the
// skyline to the beach and the water. No driving, no mission progress:
// just the city. The camera sits high enough (about 40 m) to clear the
// tallest roofs, so the frame reads as a whole city, not one street.
function runCityShot(game) {
  const { player, input, hud, lights, camera, renderer, scene } = game;
  player.pos.set(-150, 0, -6);
  player.heading = Math.PI / 2; // facing east, toward the beach
  player.mode = 'foot';
  player.speed = 0;
  player.figure.visible = true;
  // Camera west of the player, high up, looking east: yaw -PI/2 puts
  // the camera on the -x side; pitch 0.7 lifts it above the roofs.
  input.yaw = -Math.PI / 2;
  input.pitch = 0.7;
  input.distance = 60;
  hud.update(game.getHudState());
  lights.follow(player.pos);
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);
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
  // Ave to 42nd St, east along it to Coral Ave, south past the parked
  // Citra. The Citra sits 1.6 m off the southbound lane, so the player
  // cannot pass without hitting it: a real ram, real heat, wanted 2.
  // The route is short (the ram lands ~7 s after the steal), so heat has
  // not decayed below the level-2 threshold yet. The third waypoint
  // clips the Citra's east side (x = 136, 1.8 m off its centre) and the
  // fourth pulls south past it: aiming AT the Citra wedged the car
  // against it for 9 s (and the police, who now correctly close in on a
  // stopped player, caught it mid-shot).
  const waypoints = [
    { x: 45.8, z: 42 },
    { x: 134.2, z: 42 },
    { x: 136, z: 58.5 },
    { x: 138, z: 70 },
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
    // Advance on arrival — or on the ram: once wanted hits 2 the car
    // has clipped the Citra, and the waypoint (on the Citra's east edge)
    // sits inside its collision zone, so the car can never get within
    // 3 m of it and would wedge there until the police catch it. Move
    // past the Citra instead.
    if (dist < 3 || (wp === 2 && police.level >= 2)) { wp += 1; continue; }
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

  // Phase 3: cruise south for 2 s, then the frame. Pulsed throttle holds
  // ~14 m/s (slower than the 27 m/s police top speed, so the pursuit
  // closes from ~30 m to ~5-10 m behind — right on the player's tail).
  // The east-biased target (x = 143 while still beside the Citra) steers
  // the car around the Citra's east side; once past, it holds the
  // avenue centre.
  for (let i = 0; i < 120; i++) {
    const tx = player.pos.z < 64 ? 143 : 138;
    const tz = player.pos.z + 40;
    const desired = Math.atan2(tx - player.pos.x, tz - player.pos.z);
    const err = wrapAngle(desired - player.heading);
    const steer = err > 0.05 ? -1 : err < -0.05 ? 1 : 0;
    let throttle = (i % 5 < 3) ? 1 : 0;
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
