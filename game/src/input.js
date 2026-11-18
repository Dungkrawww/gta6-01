// Keyboard + mouse input for Solara City.
// WASD/arrows move, Shift runs, E enters/exits a car (edge-triggered),
// mouse drag orbits the third-person camera, wheel zooms.
// No pointer lock: drag-orbit works in a plain browser tab and in capture.
import { CAM_MIN_DIST, CAM_MAX_DIST, CAM_DEFAULT_DIST } from './config.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.yaw = Math.PI; // camera looks north (-z) by default
    this.pitch = 0.32;
    this.distance = CAM_DEFAULT_DIST;
    this._ePressed = false;
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyE' && !event.repeat) this._ePressed = true;
      this.keys.add(event.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    canvas.addEventListener('mousedown', (event) => {
      this._dragging = true;
      this._lastX = event.clientX;
      this._lastY = event.clientY;
    });
    window.addEventListener('mouseup', () => {
      this._dragging = false;
    });
    window.addEventListener('mousemove', (event) => {
      if (!this._dragging) return;
      const dx = event.clientX - this._lastX;
      const dy = event.clientY - this._lastY;
      this._lastX = event.clientX;
      this._lastY = event.clientY;
      this.yaw -= dx * 0.005;
      this.pitch += dy * 0.004;
      this.pitch = Math.max(-0.1, Math.min(1.1, this.pitch));
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.distance += Math.sign(event.deltaY) * 1.5;
      this.distance = Math.max(CAM_MIN_DIST, Math.min(CAM_MAX_DIST, this.distance));
    }, { passive: false });
  }

  // -1..1 forward (W/up positive), -1..1 strafe (D/right positive).
  get moveForward() {
    let f = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    return f;
  }

  get moveStrafe() {
    let s = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    return s;
  }

  get running() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  // True once per E keypress; calling it consumes the press.
  consumeInteract() {
    const pressed = this._ePressed;
    this._ePressed = false;
    return pressed;
  }

  // Synthetic drive for the shot autopilot: pretend keys are held.
  setSynthetic(forward, strafe, running) {
    this.keys.delete('KeyW');
    this.keys.delete('KeyS');
    this.keys.delete('KeyA');
    this.keys.delete('KeyD');
    if (forward > 0) this.keys.add('KeyW');
    if (forward < 0) this.keys.add('KeyS');
    if (strafe > 0) this.keys.add('KeyD');
    if (strafe < 0) this.keys.add('KeyA');
    if (running) this.keys.add('ShiftLeft');
    else this.keys.delete('ShiftLeft');
  }
}
