// Solara City — game entry point: title screen, fixed-timestep loop, wiring.
// The simulation advances only in fixed STEPs, so a shot run of N steps is
// identical every time. Wall-clock time only decides how many steps run
// per animation frame; it never enters simulation state.
import { STEP, DEFAULT_SEED, CASH_START, HEALTH_START, FINE_CAUGHT,
  HEAT_STEAL, HEAT_HIT_CAR, HEAT_HIT_PED,
  HEALTH_HIT_BY_CAR, HEALTH_HARD_CRASH, HEALTH_REGEN_PER_SEC,
  MISSION_RETRY_RESPAWN, SAVE_AUTOSAVE_STEPS } from './config.js';
import { Input } from './input.js';
import { generateCity } from './world.js';
import {
  createRenderer, createScene, createLights, createCamera,
  updateCamera, resizeRenderer,
} from './render.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { Police } from './police.js';
import { Mission } from './missions.js';
import { writeSave, readSave, hasSave, clearSave } from './save.js';
import { Hud } from './hud.js';
import { runShot, getShotParams } from './shots.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
const { shot, seed } = getShotParams();
const city = generateCity(scene, seed);
const lights = createLights(scene);
const input = new Input(canvas);
const player = new Player(scene, city);
// Block B systems: traffic, pedestrians, wanted/police.
const traffic = new Traffic(scene, city, seed);
const peds = new Peds(scene, city, seed);
const police = new Police(scene, city, seed);
const hud = new Hud(city);
// Block C systems: the M1 mission and the save file.
const mission = new Mission(scene);

// Player economy + health (Block B HUD + caught fine).
let cash = CASH_START;
let health = HEALTH_START;
let lastDamageAt = -999;
let lastHardCrashAt = -999;
// Game flow: 'title' | 'play' | 'paused' | 'gameover'.
let gameState = 'title';
// Transient banner line (pickup / delivery / failure), in sim steps.
let bannerText = '';
let bannerUntilStep = 0;

function showBanner(text) {
  bannerText = text;
  bannerUntilStep = game.steps + 240; // ~4 sim-seconds
}

// Mission callbacks: pickup and delivery feed the HUD banner and the
// save file; the reward lands in cash exactly once, via deliver().
mission.onPickup = () => {
  showBanner('Paket diambil! Antar ke Kantor Coral');
  saveNow();
};
mission.onDeliver = (amount) => {
  cash += amount;
  showBanner(`+$${amount}! Misi selesai`);
  saveNow();
};
mission.onTimeout = () => {
  showGameOver('Waktu habis');
};

function damage(amount, now) {
  health = Math.max(0, health - amount);
  lastDamageAt = now;
}

// Caught by the police: respawn on foot at the start spot, pay the fine.
// Caught while carrying the package: the run fails too, game over.
function onCaught() {
  const car = player.drivenCar;
  if (car) {
    car.speed = 0;
    car.taken = false;
    player.drivenCar = null;
  }
  player.mode = 'foot';
  player.pos.set(-150, 0, 24);
  player.heading = 0;
  player.speed = 0;
  player.figure.visible = true;
  cash = Math.max(0, cash - FINE_CAUGHT);
  health = HEALTH_START;
  if (mission.state === 'active' && mission.carried) {
    mission.fail('Tertangkap');
    showBanner('Tertangkap! Denda $50');
    showGameOver('Tertangkap');
  } else {
    saveNow();
  }
}

// One fixed step of the whole world: player, traffic, peds, police, then
// the collision/crime checks that join them. The frame loop and the shot
// runner both call this, so a shot plays the real rules.
function stepWorld(dt) {
  const now = game.steps * STEP;
  const prevSpeed = Math.abs(player.speed);

  player.step(dt, input, {
    now,
    onSteal: () => police.addHeat(HEAT_STEAL, now),
    onCarBump: () => police.addHeat(HEAT_HIT_CAR, now),
    // The mission gets first refusal on E (pick up / deliver). Only
    // when it has nothing to do here does E toggle the car. The mission
    // needs to know whether the player is driving — the pickup is an
    // on-foot action, the delivery is a drive-through.
    onInteract: () => mission.tryInteract(player.pos.x, player.pos.z, player.mode === 'car'),
  });

  // Obstacles traffic must not rear-end: police cars, the player's car,
  // and the level-3 roadblock.
  const policeState = police.getState();
  const obstacles = [...policeState.cars];
  if (player.mode === 'car') {
    obstacles.push({ x: player.pos.x, z: player.pos.z, speed: Math.abs(player.speed), heading: player.heading });
  }
  for (const c of policeState.roadblock) obstacles.push({ ...c, speed: 0 });

  // Chaos peds flee from: a fast player car, or any pursuing police car.
  const chaos = [];
  if (player.mode === 'car' && Math.abs(player.speed) > 8) {
    chaos.push({ x: player.pos.x, z: player.pos.z });
  }
  for (const c of policeState.cars) chaos.push({ x: c.x, z: c.z });

  const trafficState = traffic.getState();
  const carsForPeds = [...trafficState, ...policeState.cars];
  if (player.mode === 'car') {
    carsForPeds.push({ x: player.pos.x, z: player.pos.z, speed: Math.abs(player.speed), heading: player.heading });
  }
  traffic.step(dt, { now, obstacles, peds: peds.getState() });
  peds.step(dt, { now, chaos, cars: carsForPeds });
  police.step(dt, {
    now,
    player: { x: player.pos.x, z: player.pos.z, mode: player.mode, speed: player.speed, heading: player.heading },
    traffic: traffic.getState(),
    onCaught,
  });

  // The mission clock and markers advance with the world — including in
  // shot mode, where the mission shot plays a real run.
  mission.step(dt, { now, x: player.pos.x, z: player.pos.z, mode: player.mode });

  checkCollisions(dt, now, prevSpeed);
  game.steps += 1;

  // Autosave every 5 sim-seconds during real play (never in shot mode:
  // a shot must not overwrite the player's save).
  if (!shot && gameState === 'play' && game.steps % SAVE_AUTOSAVE_STEPS === 0) saveNow();
}

// Collisions between the player and the world: running over a pedestrian
// (a crime), ramming traffic/police/roadblock cars (a crime for traffic),
// being hit by a traffic car on foot, and hard wall crashes.
function checkCollisions(dt, now, prevSpeed) {
  const px = player.pos.x;
  const pz = player.pos.z;

  if (player.mode === 'car') {
    const speed = Math.abs(player.speed);
    // Run over a pedestrian.
    for (const ped of peds.peds) {
      const d = Math.hypot(ped.x - px, ped.z - pz);
      if (d < 2.0 && speed > 3 && now > ped.hitCooldownUntil) {
        peds.knockDown(ped, now);
        police.addHeat(HEAT_HIT_PED, now);
      }
    }
    // Ram another car: bounce off it, lose speed; traffic rams are crimes.
    // Oriented (rectangle) check — see player.js: a 4.4 m circle falsely
    // "rams" cars passing in the adjacent lane (lanes are 4.4 m apart).
    const ram = (ox, oz, isTrafficCar, carObj) => {
      const fx = Math.sin(player.heading);
      const fz = Math.cos(player.heading);
      const rx = ox - px;
      const rz = oz - pz;
      const fwd = rx * fx + rz * fz;
      const lat = rx * fz - rz * fx;
      if (Math.abs(fwd) >= 4.2 || Math.abs(lat) >= 1.9) return;
      const fwdPush = (4.2 - Math.abs(fwd)) * 0.5 * (fwd > 0 ? -1 : 1);
      const latPush = (1.9 - Math.abs(lat)) * 0.5 * (lat > 0 ? 1 : -1);
      player.pos.x += fx * fwdPush + (-fz) * latPush;
      player.pos.z += fz * fwdPush + fx * latPush;
      if (speed > 5 && isTrafficCar && carObj
        && (now - (carObj._lastBumpAt || -99)) > 2) {
        carObj._lastBumpAt = now;
        police.addHeat(HEAT_HIT_CAR, now);
      }
      if (player.drivenCar) player.drivenCar.speed *= 0.5;
    };
    for (const car of traffic.cars) {
      const p = traffic.posOf(car);
      ram(p.x, p.z, true, car);
    }
    for (const car of police.cars) {
      const p = { x: car.mesh.position.x, z: car.mesh.position.z };
      ram(p.x, p.z, true, car);
    }
    for (const car of police.roadblock) ram(car.x, car.z, false, null);
    // Hard wall crash costs health.
    const driven = player.drivenCar;
    if (driven && driven._hitWall && prevSpeed > 18 && now - lastHardCrashAt > 1) {
      lastHardCrashAt = now;
      damage(HEALTH_HARD_CRASH, now);
    }
  } else {
    // On foot: a traffic car that touches Raka hurts.
    for (const car of traffic.cars) {
      const p = traffic.posOf(car);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < 1.8 && car.speed > 2 && now - lastDamageAt > 1) {
        damage(HEALTH_HIT_BY_CAR, now);
        const dx = px - p.x;
        const dz = pz - p.z;
        const len = Math.hypot(dx, dz) || 1;
        player.pos.x += (dx / len) * 1.5;
        player.pos.z += (dz / len) * 1.5;
      }
    }
  }

  // Health regenerates after 5 quiet seconds.
  if (health < HEALTH_START && now - lastDamageAt > 5) {
    health = Math.min(HEALTH_START, health + HEALTH_REGEN_PER_SEC * dt);
  }
}

// ---- Block C: save / load / game over / retry. ----
function buildSaveData() {
  return {
    version: 1,
    cash,
    health: Math.round(health),
    mission: mission.toSave(),
    player: { x: player.pos.x, z: player.pos.z, heading: player.heading, mode: player.mode },
    car: player.drivenCar ? {
      index: player.cars.indexOf(player.drivenCar),
      x: player.drivenCar.x,
      z: player.drivenCar.z,
      heading: player.drivenCar.heading,
      speed: player.drivenCar.speed,
    } : null,
    wanted: { heat: police.heat, level: police.level },
    steps: game.steps,
  };
}

// Write the current state to LocalStorage now (autosave, transitions,
// pause, game over). Called by the playtest as window.__game.saveNow().
function saveNow() {
  return writeSave(buildSaveData());
}

// Restore a save: cash, mission, player, car, wanted. Returns false
// when there is no save. A failed mission loads as failed (the status
// is preserved, not erased) and the game resumes in play — the player
// restarts the run with E at the pickup ring.
function loadSave() {
  const data = readSave();
  if (!data) return false;
  cash = typeof data.cash === 'number' ? data.cash : CASH_START;
  health = typeof data.health === 'number' ? data.health : HEALTH_START;
  mission.fromSave(data.mission);
  const p = data.player || {};
  player.pos.set(typeof p.x === 'number' ? p.x : -150, 0, typeof p.z === 'number' ? p.z : 24);
  player.heading = typeof p.heading === 'number' ? p.heading : 0;
  player.speed = 0;
  const carData = data.car;
  if (carData && Number.isInteger(carData.index) && player.cars[carData.index]) {
    const car = player.cars[carData.index];
    car.x = carData.x;
    car.z = carData.z;
    car.heading = carData.heading;
    car.speed = carData.speed || 0;
    car.taken = true;
    car.owned = true;
    player.drivenCar = car;
    player.mode = 'car';
    player.pos.set(car.x, 0, car.z);
    player.heading = car.heading;
    player.figure.visible = false;
  } else {
    player.drivenCar = null;
    player.mode = 'foot';
    player.figure.visible = true;
  }
  if (data.wanted) {
    police.heat = data.wanted.heat || 0;
    police.level = data.wanted.level || 0;
  }
  return true;
}

function showGameOver(reason) {
  gameState = 'gameover';
  document.getElementById('gameover-reason').textContent = reason;
  document.getElementById('gameover').classList.remove('hidden');
  saveNow();
}

// Retry from the game-over screen: the run resets, Raka respawns on
// foot 6 m from the pickup, wanted cleared, health restored. Cash is
// kept as-is (no second fine, no reward).
function retryMission() {
  mission.reset();
  police.heat = 0;
  police.level = 0;
  if (player.drivenCar) {
    player.drivenCar.speed = 0;
    player.drivenCar.taken = false;
    player.drivenCar = null;
  }
  player.mode = 'foot';
  player.pos.set(MISSION_RETRY_RESPAWN.x, 0, MISSION_RETRY_RESPAWN.z);
  player.heading = 0;
  player.speed = 0;
  player.figure.visible = true;
  health = HEALTH_START;
  document.getElementById('gameover').classList.add('hidden');
  gameState = 'play';
  saveNow();
}

function toTitle() {
  gameState = 'title';
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('title').classList.remove('hidden');
  if (hasSave()) document.getElementById('title-continue').classList.remove('hidden');
}

function getHudState() {
  const policeState = police.getState();
  return {
    ...player.getState(),
    wanted: policeState.wanted,
    cash,
    health: Math.round(health),
    time: game.steps * STEP,
    police: policeState.cars,
    roadblock: policeState.roadblock,
    traffic: traffic.getState(),
    peds: peds.getState(),
    mission: mission.getState(),
    banner: game.steps < bannerUntilStep ? bannerText : '',
  };
}

const game = { renderer, scene, camera, lights, city, player, input, hud, traffic, peds, police, mission, stepWorld, getHudState, saveNow, loadSave, retryMission, getSave: () => readSave(), get cash() { return cash; }, get health() { return health; }, get gameState() { return gameState; }, steps: 0 };
window.__game = game;
window.__shotReady = false;

if (shot) {
  // Shot mode: hide the title overlay, run the scripted scene
  // synchronously, render once, signal.
  document.getElementById('title').classList.add('hidden');
  try {
    runShot(game, shot);
  } catch (err) {
    window.__shotError = String(err);
    console.error(err);
  }
} else {
  // Normal play: title screen, then the loop.
  const titleEl = document.getElementById('title');
  const pauseEl = document.getElementById('pause');
  const gameoverEl = document.getElementById('gameover');
  const continueEl = document.getElementById('title-continue');

  const startGame = () => {
    if (gameState !== 'title') return;
    // A new game starts clean: the old save goes away, the mission
    // resets, cash and health restart.
    clearSave();
    mission.reset();
    cash = CASH_START;
    health = HEALTH_START;
    if (player.drivenCar) {
      player.drivenCar.speed = 0;
      player.drivenCar.taken = false;
      player.drivenCar = null;
    }
    player.mode = 'foot';
    player.pos.set(-150, 0, 24);
    player.heading = 0;
    player.speed = 0;
    player.figure.visible = true;
    police.heat = 0;
    police.level = 0;
    gameState = 'play';
    titleEl.classList.add('hidden');
    gameoverEl.classList.add('hidden');
    hud.update(getHudState());
  };
  const continueGame = () => {
    if (gameState !== 'title') return;
    if (!loadSave()) return;
    gameState = 'play';
    titleEl.classList.add('hidden');
    gameoverEl.classList.add('hidden');
    hud.update(getHudState());
  };
  const togglePause = () => {
    if (gameState === 'play') {
      gameState = 'paused';
      pauseEl.classList.remove('hidden');
      saveNow();
    } else if (gameState === 'paused') {
      gameState = 'play';
      pauseEl.classList.add('hidden');
    }
  };
  titleEl.addEventListener('click', startGame);
  continueEl.addEventListener('click', (event) => {
    // The Continue button sits inside the title overlay: stop the
    // click from bubbling up to the title's own (new game) handler.
    event.stopPropagation();
    continueGame();
  });
  document.getElementById('gameover-retry').addEventListener('click', retryMission);
  document.getElementById('gameover-title').addEventListener('click', toTitle);
  pauseEl.addEventListener('click', togglePause);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Enter' && gameState === 'title') startGame();
    if ((event.code === 'Escape' || event.code === 'KeyP') && (gameState === 'play' || gameState === 'paused')) togglePause();
  });

  // Continue is offered whenever a save exists.
  if (hasSave()) continueEl.classList.remove('hidden');

  // Frame the player for the title backdrop.
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);

  let last = 0;
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (gameState !== 'play') return;
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      stepWorld(STEP);
      acc -= STEP;
      steps += 1;
    }
    hud.update(getHudState());
    lights.follow(player.pos);
    updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => resizeRenderer(renderer, camera));
}
