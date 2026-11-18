// Solara City — minimal HUD + minimap (Block A).
// The street shot must show a game HUD, so Block A ships a small one:
// location, speed, mode, controls, context prompt, and a live minimap
// (roads, beach, parked cars, player arrow). Full HUD work lands in Block B.
import { AVENUES, STREETS, CITY_HALF } from './config.js';
import { nearestRoads } from './world.js';

export class Hud {
  constructor(city) {
    this.city = city;
    this.elLocation = document.getElementById('hud-location');
    this.elSpeed = document.getElementById('hud-speed');
    this.elPrompt = document.getElementById('hud-prompt');
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
  }

  locationName(x, z) {
    const { avenue, street } = nearestRoads(x, z);
    return `${AVENUES[avenue]} & ${STREETS[street]}`;
  }

  update(state) {
    this.elLocation.textContent = `SOLARA CITY — ${this.locationName(state.x, state.z)}`;
    if (state.mode === 'car') {
      this.elSpeed.textContent = `${Math.round(state.speedKmh)} km/h — Driving ${state.drivenName} (E to exit)`;
    } else {
      this.elSpeed.textContent = `${Math.round(state.speedKmh)} km/h — On foot (E to enter car)`;
    }
    this.elPrompt.textContent = state.nearCar
      ? `Press E to steal the ${state.nearCar.name}`
      : '';
    this._drawMinimap(state);
  }

  _drawMinimap(state) {
    const ctx = this.mapCtx;
    const size = 180;
    const span = 480; // world metres shown across the map
    const scale = size / span;
    const toX = (x) => (x + 210) * scale;
    const toZ = (z) => (z + 210) * scale;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8, 14, 22, 0.72)';
    ctx.fillRect(0, 0, size, size);

    // Beach sand + water on the east edge.
    ctx.fillStyle = '#e8d49a';
    ctx.fillRect(toX(CITY_HALF), 0, (246 - CITY_HALF) * scale, size);
    ctx.fillStyle = '#2f7fc2';
    ctx.fillRect(toX(246), 0, size - toX(246), size);

    // Roads.
    ctx.strokeStyle = '#8a929c';
    ctx.lineWidth = 2;
    for (const c of this.city.centers) {
      ctx.beginPath(); ctx.moveTo(toX(c), 0); ctx.lineTo(toX(c), size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toZ(c)); ctx.lineTo(size, toZ(c)); ctx.stroke();
    }

    // Parked cars as pale dots.
    ctx.fillStyle = '#dfe3e6';
    for (const car of this.city.parkedCars) {
      ctx.fillRect(toX(car.x) - 1.5, toZ(car.z) - 1.5, 3, 3);
    }

    // Player arrow, rotated by heading.
    const px = toX(state.x);
    const pz = toZ(state.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.PI - state.heading);
    ctx.fillStyle = '#ff7a2f';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', 6, 14);
  }
}
