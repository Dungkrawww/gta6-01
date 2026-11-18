// Solara City — wanted levels + police pursuit (F8).
// Heat 0..100 maps to wanted levels 0..3. Crimes add heat; heat decays
// after a quiet spell with no crime. Police cars spawn on the road grid
// and drive it greedily toward the player: at each intersection they take
// the branch that gets them closer. Level 1: one slow patrol car.
// Level 2: two faster pursuit cars. Level 3: three aggressive cars plus
// a roadblock across the player's road. Caught = respawn at a safe spot
// with a fine (handled by main.js via onCaught).
import * as THREE from '../vendor/three.module.min.js';
import {
  CITY_HALF, HEAT_LEVEL_1, HEAT_LEVEL_2, HEAT_LEVEL_3,
  HEAT_DECAY_PER_SEC, HEAT_QUIET_SECONDS,
  POLICE_SPEED, POLICE_RUBBER_BAND, POLICE_SPAWN_DIST,
  POLICE_CATCH_DIST, POLICE_CATCH_TIME, POLICE_ROADBLOCK_DIST,
} from './config.js';
import { mulberry32, pick, chance } from './random.js';
import { buildCarMesh } from './player.js';
import { roadPos, headingFor } from './traffic.js';

function buildPoliceCarMesh() {
  const car = buildCarMesh(0xe9e9e9);
  const barBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.1, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x222222 }),
  );
  barBase.position.set(0, 1.62, -0.25);
  car.add(barBase);
  const lightGeo = new THREE.BoxGeometry(0.48, 0.12, 0.46);
  const matL = new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000 });
  const matR = new THREE.MeshLambertMaterial({ color: 0x2266ff, emissive: 0x0022aa });
  const lightL = new THREE.Mesh(lightGeo, matL);
  lightL.position.set(-0.28, 1.7, -0.25);
  const lightR = new THREE.Mesh(lightGeo, matR);
  lightR.position.set(0.28, 1.7, -0.25);
  car.add(lightL);
  car.add(lightR);
  car.userData.lightL = matL;
  car.userData.lightR = matR;
  return car;
}

function levelFromHeat(heat) {
  if (heat >= HEAT_LEVEL_3) return 3;
  if (heat >= HEAT_LEVEL_2) return 2;
  if (heat >= HEAT_LEVEL_1) return 1;
  return 0;
}

export class Police {
  constructor(scene, city, seed) {
    this.scene = scene;
    this.city = city;
    this.rng = mulberry32((seed * 91 + 13) >>> 0);
    this.heat = 0;
    this.level = 0;
    this.lastCrimeAt = -999;
    this.cars = [];
    this.roadblock = [];
    this.caughtCount = 0;
  }

  addHeat(amount, now) {
    this.heat = Math.min(100, this.heat + amount);
    this.lastCrimeAt = now;
    this.level = levelFromHeat(this.heat);
  }

  // Intersection closest to POLICE_SPAWN_DIST from the player.
  _spawnPoint(player) {
    let best = null;
    let bestScore = Infinity;
    for (const cx of this.city.centers) {
      for (const cz of this.city.centers) {
        const d = Math.hypot(cx - player.x, cz - player.z);
        const score = Math.abs(d - POLICE_SPAWN_DIST);
        if (score < bestScore) { bestScore = score; best = { x: cx, z: cz }; }
      }
    }
    return best;
  }

  _spawnCar(player) {
    const point = this._spawnPoint(player);
    const dx = player.x - point.x;
    const dz = player.z - point.z;
    let axis, road, dir, t;
    if (Math.abs(dx) > Math.abs(dz)) {
      axis = 'x'; road = point.z; t = point.x; dir = dx > 0 ? 1 : -1;
    } else {
      axis = 'z'; road = point.x; t = point.z; dir = dz > 0 ? 1 : -1;
    }
    const mesh = buildPoliceCarMesh();
    this.scene.add(mesh);
    const car = { axis, road, dir, t, speed: 0, turnCooldown: 0, catchTimer: 0, mesh };
    this.cars.push(car);
    return car;
  }

  _despawnCar(car) {
    this.scene.remove(car.mesh);
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  _despawnAll() {
    for (const car of [...this.cars]) this._despawnCar(car);
    this._clearRoadblock();
  }

  // Two static police cars across the player's road, ahead of the player.
  _makeRoadblock(player) {
    if (this.roadblock.length > 0) return;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const px = player.x + fx * POLICE_ROADBLOCK_DIST;
    const pz = player.z + fz * POLICE_ROADBLOCK_DIST;
    let avenue = 0;
    let street = 0;
    let bestA = Infinity;
    let bestS = Infinity;
    for (const c of this.city.centers) {
      const da = Math.abs(px - c);
      const ds = Math.abs(pz - c);
      if (da < bestA) { bestA = da; avenue = c; }
      if (ds < bestS) { bestS = ds; street = c; }
    }
    const onAvenue = bestA <= bestS;
    const along = onAvenue ? pz : px;
    for (const off of [-2.2, 2.2]) {
      const x = onAvenue ? avenue + off : along;
      const z = onAvenue ? along : street + off;
      const heading = onAvenue ? Math.PI / 2 : 0;
      const mesh = buildPoliceCarMesh();
      mesh.position.set(x, 0, z);
      mesh.rotation.y = heading;
      this.scene.add(mesh);
      this.roadblock.push({ x, z, heading, mesh });
    }
  }

  _clearRoadblock() {
    for (const car of this.roadblock) this.scene.remove(car.mesh);
    this.roadblock = [];
  }

  // Distance along the car's road to the next intersection ahead.
  _nextCross(car) {
    let best = Infinity;
    for (const cross of this.city.centers) {
      const d = (cross - car.t) * car.dir;
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  // Greedy routing: at an intersection, take the branch that gets the
  // car closest to the player after ~24 m. No U-turns.
  _routeAtIntersection(car, player) {
    const pos = roadPos(car.axis, car.road, car.dir, car.t);
    const crossDist = this._nextCross(car);
    const cross = car.t + car.dir * crossDist;
    const options = [];
    // Straight on.
    options.push({ axis: car.axis, road: car.road, dir: car.dir, t: car.t });
    // Turn onto the cross road, either direction.
    const newAxis = car.axis === 'z' ? 'x' : 'z';
    for (const dir of [1, -1]) {
      options.push({
        axis: newAxis, road: cross, dir,
        t: newAxis === 'x' ? pos.x : pos.z,
      });
    }
    let best = options[0];
    let bestDist = Infinity;
    for (const opt of options) {
      const p = roadPos(opt.axis, opt.road, opt.dir, opt.t + opt.dir * 24);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < bestDist) { bestDist = d; best = opt; }
    }
    if (best.axis !== car.axis || best.dir !== car.dir || best.road !== car.road) {
      car.axis = best.axis;
      car.road = best.road;
      car.dir = best.dir;
      car.t = best.t;
      car.turnCooldown = 1.5;
    }
  }

  // ctx: { now, player: {x, z, mode, speed, heading},
  //        traffic: [{x, z, speed, heading}], onCaught: () => void }
  step(dt, ctx) {
    const { now, player } = ctx;

    // Heat decays after a quiet spell; level follows heat.
    if (this.heat > 0 && now - this.lastCrimeAt > HEAT_QUIET_SECONDS) {
      this.heat = Math.max(0, this.heat - HEAT_DECAY_PER_SEC * dt);
      this.level = levelFromHeat(this.heat);
    }

    // Match the car count to the wanted level.
    while (this.cars.length < this.level) this._spawnCar(player);
    while (this.cars.length > this.level) {
      let furthest = this.cars[0];
      let furthestDist = -1;
      for (const car of this.cars) {
        const p = roadPos(car.axis, car.road, car.dir, car.t);
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        if (d > furthestDist) { furthestDist = d; furthest = car; }
      }
      this._despawnCar(furthest);
    }

    // Roadblock only at level 3, only while the player drives.
    if (this.level === 3 && player.mode === 'car') this._makeRoadblock(player);
    else this._clearRoadblock();

    const obstacles = [];
    if (ctx.traffic) obstacles.push(...ctx.traffic);
    if (player.mode === 'car') {
      obstacles.push({ x: player.x, z: player.z, speed: Math.abs(player.speed), heading: player.heading });
    }

    for (const car of this.cars) {
      if (car.turnCooldown > 0) car.turnCooldown -= dt;
      const pos = roadPos(car.axis, car.road, car.dir, car.t);
      const distToPlayer = Math.hypot(pos.x - player.x, pos.z - player.z);

      // Rubber-band: faster when far behind, so a chase always closes in.
      const base = POLICE_SPEED[this.level] || 0;
      const boost = Math.max(0, Math.min(POLICE_RUBBER_BAND, (distToPlayer - 25) * 0.25));
      let target = base + boost;

      // Tail, don't ram: when the player is driving, hold a gap instead
      // of grinding into them. A police car inside the ram radius halves
      // the player's speed every step and wedges them against whatever
      // they just hit — that is a bug, not a chase. When the player is
      // stopped, close in: that is how the catch happens.
      const playerSpeed = player.mode === 'car' ? Math.abs(player.speed) : 0;
      if (player.mode === 'car' && playerSpeed > 2) {
        if (distToPlayer < 5.5) target = 0;
        else if (distToPlayer < 10) target = Math.min(target, playerSpeed);
      }

      // Slow for the car ahead in the same lane.
      const fx = car.axis === 'z' ? 0 : car.dir;
      const fz = car.axis === 'z' ? car.dir : 0;
      for (const o of obstacles) {
        const rx = o.x - pos.x;
        const rz = o.z - pos.z;
        const along = rx * fx + rz * fz;
        if (along <= 0 || along > 12) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat > 2.4) continue;
        const oFx = Math.sin(o.heading);
        const oFz = Math.cos(o.heading);
        if (oFx * fx + oFz * fz < 0.2) continue;
        if (along < 5) target = 0;
        else target = Math.min(target, o.speed || 0);
      }

      const rate = target < car.speed ? 10 : 5;
      car.speed += Math.max(-rate * dt, Math.min(rate * dt, target - car.speed));
      car.t += car.dir * car.speed * dt;

      // Greedy routing at intersections; turn around at the city edge.
      if (this._nextCross(car) < 1.6 && car.turnCooldown <= 0) {
        this._routeAtIntersection(car, player);
      }
      if (Math.abs(car.t) > CITY_HALF + 6) {
        car.dir *= -1;
        car.t = Math.max(-CITY_HALF - 4, Math.min(CITY_HALF + 4, car.t));
      }

      // Caught: stay close to the player long enough.
      if (distToPlayer < POLICE_CATCH_DIST) {
        car.catchTimer += dt;
        if (car.catchTimer >= POLICE_CATCH_TIME) {
          this.caughtCount += 1;
          this.heat = 0;
          this.level = 0;
          this._despawnAll();
          if (ctx.onCaught) ctx.onCaught();
          return;
        }
      } else {
        car.catchTimer = 0;
      }
    }
    this._syncMeshes(now);
  }

  _syncMeshes(now) {
    const phase = Math.floor(now * 4) % 2;
    for (const car of this.cars) {
      const pos = roadPos(car.axis, car.road, car.dir, car.t);
      car.mesh.position.set(pos.x, 0, pos.z);
      car.mesh.rotation.y = headingFor(car.axis, car.dir);
      const { lightL, lightR } = car.mesh.userData;
      if (phase === 0) {
        lightL.color.setHex(0xff2222); lightL.emissive.setHex(0xcc0000);
        lightR.color.setHex(0x112255); lightR.emissive.setHex(0x000022);
      } else {
        lightL.color.setHex(0x551111); lightL.emissive.setHex(0x220000);
        lightR.color.setHex(0x2266ff); lightR.emissive.setHex(0x0033cc);
      }
    }
  }

  getState() {
    return {
      wanted: this.level,
      heat: Math.round(this.heat),
      caught: this.caughtCount,
      cars: this.cars.map((car) => {
        const pos = roadPos(car.axis, car.road, car.dir, car.t);
        return { x: pos.x, z: pos.z, heading: headingFor(car.axis, car.dir), speed: car.speed };
      }),
      roadblock: this.roadblock.map((c) => ({ x: c.x, z: c.z, heading: c.heading })),
    };
  }
}
