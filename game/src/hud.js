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
    this.elWanted = document.getElementById('hud-wanted');
    this.elCash = document.getElementById('hud-cash');
    this.elHealthBar = document.getElementById('hud-health-bar');
    this.elMission = document.getElementById('hud-mission');
    this.elBanner = document.getElementById('hud-banner');
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
    // Mission prompt first (it owns the E key here), then the car prompt.
    const missionPrompt = state.mission ? state.mission.prompt : null;
    if (missionPrompt) {
      this.elPrompt.textContent = missionPrompt;
    } else if (state.nearCar) {
      this.elPrompt.textContent = state.nearCar.owned
        ? `Press E to enter your ${state.nearCar.name}`
        : `Press E to steal the ${state.nearCar.name}`;
    }
    // Mission objective line (Block C): what to do next, with the timer.
    if (state.mission) {
      this.elMission.textContent = `MISI: Kurir Panas — ${state.mission.objective}`;
    }
    // Transient banner (pickup / delivery / failure).
    this.elBanner.textContent = state.banner || '';
    // Wanted stars (Block B): filled for the current level, hollow above.
    const wanted = state.wanted || 0;
    this.elWanted.textContent = wanted > 0
      ? `WANTED ${'★'.repeat(wanted)}${'☆'.repeat(3 - wanted)}`
      : '';
    this.elWanted.style.color = wanted >= 3 ? '#ff4444' : '#ffd75e';
    this.elCash.textContent = `$${state.cash ?? 0}`;
    const health = state.health ?? 100;
    this.elHealthBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
    this.elHealthBar.style.background = health > 50 ? '#3aa655' : health > 25 ? '#e8c832' : '#c22f2f';
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

    // Traffic as small grey dots.
    if (state.traffic) {
      ctx.fillStyle = '#9aa5b1';
      for (const car of state.traffic) {
        ctx.fillRect(toX(car.x) - 1.5, toZ(car.z) - 1.5, 3, 3);
      }
    }

    // Pedestrians as faint dots.
    if (state.peds) {
      ctx.fillStyle = 'rgba(200, 210, 220, 0.55)';
      for (const ped of state.peds) {
        ctx.fillRect(toX(ped.x) - 1, toZ(ped.z) - 1, 2, 2);
      }
    }

    // Police as flashing blue/red dots (Block B) — the chase, on the map.
    if (state.police) {
      const phase = Math.floor((state.time || 0) * 2) % 2 === 0;
      ctx.fillStyle = phase ? '#3a86ff' : '#ff3333';
      for (const car of state.police) {
        ctx.beginPath();
        ctx.arc(toX(car.x), toZ(car.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Roadblock cars as white squares.
    if (state.roadblock) {
      ctx.fillStyle = '#ffffff';
      for (const car of state.roadblock) {
        ctx.fillRect(toX(car.x) - 2.5, toZ(car.z) - 2.5, 5, 5);
      }
    }

    // Mission markers: pickup (yellow) and delivery (green).
    if (state.mission && state.mission.markers) {
      for (const m of state.mission.markers) {
        ctx.fillStyle = m.kind === 'pickup' ? '#e8c832' : '#3aa655';
        ctx.fillRect(toX(m.x) - 3, toZ(m.z) - 3, 6, 6);
      }
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
