// Solara City — simple road traffic (F6).
// Ten cars drive the road grid on fixed routes: one car type, colour
// variants, right-hand lanes. At an intersection a car sometimes turns;
// at the city edge it respawns on another road. Cars slow for the car
// ahead (and for pedestrians in their lane), so they never pile up.
// All randomness flows from a seeded generator, so a fixed seed builds
// the same traffic every run.
import * as THREE from '../vendor/three.module.min.js';
import {
  CITY_HALF, TRAFFIC_COUNT, TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX,
  TRAFFIC_TURN_CHANCE, TRAFFIC_CAR_GAP, TRAFFIC_STOP_GAP, LANE_OFFSET,
} from './config.js';
import { mulberry32, range, int, pick, chance } from './random.js';
import { buildCarMesh } from './player.js';

// Right-hand lane offset for a direction of travel.
export function laneOffset(axis, dir) {
  if (axis === 'z') return dir > 0 ? -LANE_OFFSET : LANE_OFFSET;
  return dir > 0 ? LANE_OFFSET : -LANE_OFFSET;
}

// Mesh heading for a direction of travel (car forward is (sin h, cos h)).
export function headingFor(axis, dir) {
  if (axis === 'z') return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

// World position of a road-following car.
export function roadPos(axis, road, dir, t) {
  const off = laneOffset(axis, dir);
  if (axis === 'z') return { x: road + off, z: t };
  return { x: t, z: road + off };
}

export class Traffic {
  constructor(scene, city, seed) {
    this.city = city;
    this.rng = mulberry32((seed * 31 + 7) >>> 0);
    this.cars = [];
    const colors = [0xe8542f, 0x2f7fc2, 0xe8c832, 0x3aa655, 0xdfe3e6, 0x8a5ec7, 0x22252a, 0xc22f4e, 0x2fb3a6];
    for (let n = 0; n < TRAFFIC_COUNT; n++) {
      const car = this._spawnCar(colors[n % colors.length]);
      const mesh = buildCarMesh(car.color);
      scene.add(mesh);
      car.mesh = mesh;
      this.cars.push(car);
    }
    this._syncMeshes();
  }

  // A fresh car on a random road, away from intersections.
  _spawnCar(color) {
    const rng = this.rng;
    const centers = this.city.centers;
    const axis = chance(rng, 0.5) ? 'z' : 'x';
    const road = pick(rng, centers);
    const dir = chance(rng, 0.5) ? 1 : -1;
    let t = range(rng, -CITY_HALF + 24, CITY_HALF - 24);
    for (const cross of centers) {
      if (Math.abs(t - cross) < 14) { t += 28; break; }
    }
    t = Math.max(-CITY_HALF + 8, Math.min(CITY_HALF - 8, t));
    return {
      axis, road, dir, t,
      speed: range(rng, TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX),
      cruise: range(rng, TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX),
      color,
      turnCooldown: 0,
      blockedUntil: 0,
      mesh: null,
    };
  }

  // World position of a car (lane offset applied).
  posOf(car) {
    return roadPos(car.axis, car.road, car.dir, car.t);
  }

  // Distance along the car's road to the nearest intersection ahead.
  _nextCross(car) {
    let best = Infinity;
    for (const cross of this.city.centers) {
      const d = (cross - car.t) * car.dir;
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  // ctx: { now, obstacles: [{x, z, speed, heading}], peds: [{x, z}] }
  // obstacles = police cars + the player's driven car (anything a traffic
  // car must not rear-end). Peds in the lane ahead make a car wait.
  step(dt, ctx) {
    const rng = this.rng;
    for (const car of this.cars) {
      if (car.turnCooldown > 0) car.turnCooldown -= dt;
      let target = car.cruise;
      if (ctx.now < car.blockedUntil) target = 0;

      const pos = this.posOf(car);
      const fx = car.axis === 'z' ? 0 : car.dir;
      const fz = car.axis === 'z' ? car.dir : 0;

      // Slow for the car ahead in the same lane (traffic or obstacle).
      const ahead = this._carAhead(car, pos, fx, fz, ctx);
      if (ahead !== null) {
        if (ahead.gap < TRAFFIC_STOP_GAP) target = 0;
        else target = Math.min(target, ahead.speed);
      }

      // Wait for a pedestrian crossing the lane ahead.
      if (ctx.peds) {
        for (const ped of ctx.peds) {
          const rx = ped.x - pos.x;
          const rz = ped.z - pos.z;
          const along = rx * fx + rz * fz;
          const lat = Math.abs(rx * fz - rz * fx);
          if (along > 0 && along < 7 && lat < 2.2) { target = 0; break; }
        }
      }

      // Ease toward the target speed.
      const rate = target < car.speed ? 9 : 4;
      car.speed += Math.max(-rate * dt, Math.min(rate * dt, target - car.speed));
      car.t += car.dir * car.speed * dt;

      // Turn at an intersection sometimes; respawn at the city edge.
      const crossDist = this._nextCross(car);
      if (crossDist < 1.6 && car.turnCooldown <= 0 && chance(rng, TRAFFIC_TURN_CHANCE)) {
        const cross = car.t + car.dir * crossDist;
        const newAxis = car.axis === 'z' ? 'x' : 'z';
        const newRoad = cross;
        const newDir = chance(rng, 0.5) ? 1 : -1;
        // Position on the new road = the car's coordinate along that axis.
        car.axis = newAxis;
        car.road = newRoad;
        car.dir = newDir;
        car.t = newAxis === 'x' ? pos.x : pos.z;
        car.turnCooldown = 1.5;
      }
      if (Math.abs(car.t) > CITY_HALF + 6) {
        const fresh = this._spawnCar(car.color);
        fresh.mesh = car.mesh;
        fresh.speed = fresh.cruise;
        Object.assign(car, fresh);
        car.mesh = fresh.mesh;
      }
    }

    // Pairwise anti-pileup: two cars too close — the slower one waits.
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        const pa = this.posOf(a);
        const pb = this.posOf(b);
        const dx = pa.x - pb.x;
        const dz = pa.z - pb.z;
        if (dx * dx + dz * dz < 3.5 * 3.5) {
          const slower = a.speed <= b.speed ? a : b;
          slower.blockedUntil = ctx.now + 0.6;
        }
      }
    }
    this._syncMeshes();
  }

  // Nearest car ahead in the same lane: { gap, speed } or null.
  _carAhead(car, pos, fx, fz, ctx) {
    let best = null;
    const consider = (ox, oz, oSpeed, oHeading) => {
      const rx = ox - pos.x;
      const rz = oz - pos.z;
      const along = rx * fx + rz * fz;
      if (along <= 0 || along > TRAFFIC_CAR_GAP + 4) return;
      const lat = Math.abs(rx * fz - rz * fx);
      if (lat > 2.4) return;
      // Only count cars travelling the same way (or standing still).
      const oFx = Math.sin(oHeading);
      const oFz = Math.cos(oHeading);
      if (oFx * fx + oFz * fz < 0.2) return;
      if (best === null || along < best.gap) best = { gap: along, speed: oSpeed };
    };
    for (const other of this.cars) {
      if (other === car) continue;
      const p = this.posOf(other);
      consider(p.x, p.z, other.speed, headingFor(other.axis, other.dir));
    }
    if (ctx.obstacles) {
      for (const o of ctx.obstacles) consider(o.x, o.z, o.speed || 0, o.heading || 0);
    }
    return best;
  }

  _syncMeshes() {
    for (const car of this.cars) {
      const pos = this.posOf(car);
      car.mesh.position.set(pos.x, 0, pos.z);
      car.mesh.rotation.y = headingFor(car.axis, car.dir);
    }
  }

  // Flat state for the minimap and for collision checks in main.js.
  getState() {
    return this.cars.map((car) => {
      const pos = this.posOf(car);
      return { x: pos.x, z: pos.z, heading: headingFor(car.axis, car.dir), speed: car.speed };
    });
  }
}
