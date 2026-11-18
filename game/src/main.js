// Solara City — game entry point: title screen, fixed-timestep loop, wiring.
// The simulation advances only in fixed STEPs, so a shot run of N steps is
// identical every time. Wall-clock time only decides how many steps run
// per animation frame; it never enters simulation state.
import { STEP, DEFAULT_SEED } from './config.js';
import { Input } from './input.js';
import { generateCity } from './world.js';
import {
  createRenderer, createScene, createLights, createCamera,
  updateCamera, resizeRenderer,
} from './render.js';
import { Player } from './player.js';
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
const hud = new Hud(city);

const game = { renderer, scene, camera, lights, city, player, input, hud, steps: 0 };
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
  let state = 'title';
  const titleEl = document.getElementById('title');
  const startGame = () => {
    if (state !== 'title') return;
    state = 'play';
    titleEl.classList.add('hidden');
    hud.update(player.getState());
  };
  titleEl.addEventListener('click', startGame);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Enter') startGame();
  });

  // Frame the player for the title backdrop.
  updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
  renderer.render(scene, camera);

  let last = 0;
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (state !== 'play') return;
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      player.step(STEP, input);
      acc -= STEP;
      steps += 1;
    }
    game.steps += steps;
    hud.update(player.getState());
    lights.follow(player.pos);
    updateCamera(camera, player.getCameraTarget(), input.yaw, input.pitch, input.distance);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => resizeRenderer(renderer, camera));
}
