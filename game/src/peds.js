// Solara City — pedestrians (F7).
// Twenty walkers, one model, colour variants. They wander the sidewalks,
// cross roads to reach the next block, wait when a car is close on the
// road they are crossing, and flee when chaos (a fast car, a police
// chase) comes close. A pedestrian run over by the player's car is
// knocked down — a witnessed crime, reported to the wanted system.
import * as THREE from '../vendor/three.module.min.js';
import {
  PED_COUNT, PED_WALK_SPEED, PED_FLEE_SPEED, PED_FLEE_RADIUS, PED_FLEE_TIME,
} from './config.js';
import { mulberry32, range, int, pick, chance } from './random.js';
import { resolveCircleCollision } from './world.js';
import { buildFigureMesh } from './player.js';

const SHIRTS = [0x3a6ea5, 0x7a9e4d, 0xd8a03c, 0x8a5ec7, 0xc22f4e, 0x2fb3a6, 0xe8e2d4, 0x5a6b7d];

export class Peds {
  constructor(scene, city, seed) {
    this.city = city;
    this.rng = mulberry32((seed * 57 + 11) >>> 0);
    this.peds = [];
    for (let n = 0; n < PED_COUNT; n++) {
      const color = pick(this.rng, SHIRTS);
      const mesh = buildFigureMesh(color);
      scene.add(mesh);
      const spot = this._sidewalkSpot();
      const ped = {
        x: spot.x, z: spot.z, heading: range(this.rng, 0, Math.PI * 2),
        speed: 0, state: 'walk', walkPhase: range(this.rng, 0, 6),
        targetX: spot.x, targetZ: spot.z,
        fleeUntil: 0, downUntil: 0, hitCooldownUntil: 0,
        mesh,
      };
      this._pickTarget(ped);
      this.peds.push(ped);
    }
    this._syncMeshes();
  }

  // A random point on a block's sidewalk slab, clear of buildings.
  _sidewalkSpot() {
    const rng = this.rng;
    const centers = this.city.centers;
    for (let tries = 0; tries < 8; tries++) {
      const bx = int(rng, 0, 7);
      const bz = int(rng, 0, 7);
      const cx = centers[bx] + 24;
      const cz = centers[bz] + 24;
      const x = cx + range(rng, -15, 15);
      const z = cz + range(rng, -15, 15);
      let inside = false;
      for (const c of this.city.colliders) {
        if (x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1) {
          inside = true;
          break;
        }
      }
      if (!inside) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  _pickTarget(ped) {
    const spot = this._sidewalkSpot();
    ped.targetX = spot.x;
    ped.targetZ = spot.z;
  }

  // True when the point is on a road (within 6 m of a centre line).
  _onRoad(x, z) {
    for (const c of this.city.centers) {
      if (Math.abs(x - c) < 6 || Math.abs(z - c) < 6) return true;
    }
    return false;
  }

  // Knock a pedestrian down (player car hit). They get up and flee.
  knockDown(ped, now) {
    if (ped.state === 'down') return;
    ped.state = 'down';
    ped.downUntil = now + 3;
    ped.speed = 0;
    ped.hitCooldownUntil = now + 3;
  }

  // ctx: { now, chaos: [{x, z}], cars: [{x, z, speed, heading}] }
  step(dt, ctx) {
    for (const ped of this.peds) {
      const pos = { x: ped.x, z: ped.z };

      if (ped.state === 'down') {
        ped.speed = 0;
        if (ctx.now >= ped.downUntil) {
          ped.state = 'flee';
          ped.fleeUntil = ctx.now + 2;
        }
        continue;
      }

      // Chaos nearby: run away from the nearest threat.
      let threat = null;
      let threatDist = PED_FLEE_RADIUS;
      if (ctx.chaos) {
        for (const c of ctx.chaos) {
          const d = Math.hypot(c.x - ped.x, c.z - ped.z);
          if (d < threatDist) { threatDist = d; threat = c; }
        }
      }
      if (threat && ped.state !== 'flee') {
        ped.state = 'flee';
        ped.fleeUntil = ctx.now + PED_FLEE_TIME;
      }
      if (ped.state === 'flee') {
        if (ctx.now >= ped.fleeUntil) {
          ped.state = 'walk';
          this._pickTarget(ped);
        } else if (threat) {
          const dx = ped.x - threat.x;
          const dz = ped.z - threat.z;
          const len = Math.hypot(dx, dz) || 1;
          ped.heading = Math.atan2(dx / len, dz / len);
          ped.speed = PED_FLEE_SPEED;
          pos.x += (dx / len) * ped.speed * dt;
          pos.z += (dz / len) * ped.speed * dt;
          ped.walkPhase += ped.speed * dt * 2.4;
          resolveCircleCollision(pos, 0.45, this.city.colliders);
          ped.x = pos.x;
          ped.z = pos.z;
          continue;
        }
      }

      // Walk toward the target. On a road with a car close by, hurry
      // across instead of waiting: waiting forever while the car waits
      // for the pedestrian is a deadlock (both stop, neither moves).
      const dx = ped.targetX - ped.x;
      const dz = ped.targetZ - ped.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1) {
        this._pickTarget(ped);
        ped.speed = 0;
      } else {
        let hurry = false;
        if (this._onRoad(ped.x, ped.z) && ctx.cars) {
          for (const car of ctx.cars) {
            const cd = Math.hypot(car.x - ped.x, car.z - ped.z);
            if (cd < 8) { hurry = true; break; }
          }
        }
        ped.heading = Math.atan2(dx / dist, dz / dist);
        ped.speed = hurry ? PED_FLEE_SPEED : PED_WALK_SPEED;
        pos.x += (dx / dist) * ped.speed * dt;
        pos.z += (dz / dist) * ped.speed * dt;
        ped.walkPhase += ped.speed * dt * 2.4;
        resolveCircleCollision(pos, 0.45, this.city.colliders);
        ped.x = pos.x;
        ped.z = pos.z;
      }
    }
    this._syncMeshes();
  }

  _syncMeshes() {
    for (const ped of this.peds) {
      ped.mesh.position.set(ped.x, 0, ped.z);
      if (ped.state === 'down') {
        ped.mesh.rotation.set(-Math.PI / 2, 0, 0);
      } else {
        ped.mesh.rotation.set(0, ped.heading, 0);
        const swing = Math.sin(ped.walkPhase) * (ped.speed > 0.1 ? 0.5 : 0);
        const { legL, legR, armL, armR } = ped.mesh.userData;
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.8;
        armR.rotation.x = swing * 0.8;
      }
    }
  }

  getState() {
    return this.peds.map((p) => ({ x: p.x, z: p.z, heading: p.heading, state: p.state }));
  }
}
