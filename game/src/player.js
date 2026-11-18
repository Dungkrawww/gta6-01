// Solara City — Raka on foot and behind the wheel (F4 + F5).
// Arcade controls: WASD moves relative to the camera, Shift runs, E enters
// or exits the nearest parked car. Car physics is deliberately simple
// (accelerate / brake / steer / bounce) — feel over simulation.
import * as THREE from '../vendor/three.module.min.js';
import {
  WALK_SPEED, RUN_SPEED, PLAYER_RADIUS,
  CAR_ACCEL, CAR_BRAKE, CAR_MAX_SPEED, CAR_MAX_REVERSE, CAR_STEER_MAX,
  CAR_RADIUS, CAR_DRAG,
} from './config.js';
import { clampToBounds, resolveCircleCollision } from './world.js';

const _target = new THREE.Vector3();

export function buildCarMesh(color) {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc4d8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 4.3), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.1), glass);
  cabin.position.set(0, 1.22, -0.25);
  cabin.castShadow = true;
  car.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.08, 2.12), paint);
  roof.position.set(0, 1.55, -0.25);
  car.add(roof);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]]) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.position.set(wx, 0.36, wz);
    wheel.castShadow = true;
    car.add(wheel);
  }

  const lightMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffe9a0 });
  for (const wx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.08), lightMat);
    head.position.set(wx, 0.66, 2.16);
    car.add(head);
  }
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xc22f2f, emissive: 0x881111 });
  for (const wx of [-0.6, 0.6]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), tailMat);
    tail.position.set(wx, 0.66, -2.16);
    car.add(tail);
  }
  return car;
}

export function buildFigureMesh(shirtColor = 0xe8542f) {
  const figure = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3a4d });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  figure.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  figure.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), shirt);
  cap.position.y = 1.82;
  figure.add(cap);

  const legGeo = new THREE.BoxGeometry(0.17, 0.82, 0.17);
  legGeo.translate(0, -0.41, 0);
  const legL = new THREE.Group();
  legL.position.set(-0.13, 0.82, 0);
  legL.add(new THREE.Mesh(legGeo, pants));
  const legR = new THREE.Group();
  legR.position.set(0.13, 0.82, 0);
  legR.add(new THREE.Mesh(legGeo, pants));
  figure.add(legL);
  figure.add(legR);

  const armGeo = new THREE.BoxGeometry(0.13, 0.66, 0.13);
  armGeo.translate(0, -0.33, 0);
  const armL = new THREE.Group();
  armL.position.set(-0.37, 1.46, 0);
  armL.add(new THREE.Mesh(armGeo, shirt));
  const armR = new THREE.Group();
  armR.position.set(0.37, 1.46, 0);
  armR.add(new THREE.Mesh(armGeo, shirt));
  figure.add(armL);
  figure.add(armR);

  figure.userData = { legL, legR, armL, armR };
  return figure;
}

export class Player {
  constructor(scene, city) {
    this.city = city;
    this.mode = 'foot';
    this.pos = new THREE.Vector3(-150, 0, 24);
    this.heading = 0; // facing south (+z), away from the default camera
    this.speed = 0;
    this.walkPhase = 0;
    this.drivenCar = null;
    // Hooks the world wires up (Block B): stealing and ramming are crimes.
    this.onSteal = null; // (car) => void
    this.onCarBump = null; // (otherCar, speed) => void

    this.figure = buildFigureMesh();
    scene.add(this.figure);

    // One mesh per parked car; the driven car is just one of them, moving.
    this.cars = city.parkedCars.map((data) => {
      const mesh = buildCarMesh(data.color);
      mesh.position.set(data.x, 0, data.z);
      mesh.rotation.y = data.heading;
      scene.add(mesh);
      return { ...data, speed: 0, mesh };
    });
  }

  getCameraTarget() {
    _target.copy(this.pos);
    _target.y = 1.2;
    return _target;
  }

  nearestCar(maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const car of this.cars) {
      if (car.taken && car !== this.drivenCar) continue;
      const dx = car.x - this.pos.x;
      const dz = car.z - this.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = car;
      }
    }
    return best;
  }

  // hooks: { now, onSteal, onCarBump } — optional; the shot runner and
  // the main loop pass them so crimes are reported to the wanted system.
  step(dt, input, hooks) {
    if (hooks) {
      this.onSteal = hooks.onSteal || null;
      this.onCarBump = hooks.onCarBump || null;
      this._now = hooks.now || 0;
    }
    if (input.consumeInteract()) this._toggleCar();
    if (this.mode === 'foot') this._stepFoot(dt, input);
    else this._stepCar(dt, input);
    this._updateMeshes();
  }

  _toggleCar() {
    if (this.mode === 'foot') {
      const car = this.nearestCar(3.4);
      if (!car) return;
      this.mode = 'car';
      this.drivenCar = car;
      car.taken = true;
      this.pos.set(car.x, 0, car.z);
      this.heading = car.heading;
      this.figure.visible = false;
      // Taking a parked car is a witnessed crime (Block B wanted system).
      if (this.onSteal) this.onSteal(car);
    } else {
      const car = this.drivenCar;
      // Step out on the car's right side.
      const sideX = Math.cos(car.heading);
      const sideZ = -Math.sin(car.heading);
      this.pos.set(car.x + sideX * 2.4, 0, car.z + sideZ * 2.4);
      clampToBounds(this.pos);
      car.speed = 0;
      this.drivenCar = null;
      this.mode = 'foot';
      this.figure.visible = true;
    }
  }

  _stepFoot(dt, input) {
    const yaw = input.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let mx = fx * input.moveForward + rx * input.moveStrafe;
    let mz = fz * input.moveForward + rz * input.moveStrafe;
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      this.speed = input.running ? RUN_SPEED : WALK_SPEED;
      this.pos.x += mx * this.speed * dt;
      this.pos.z += mz * this.speed * dt;
      this.heading = Math.atan2(mx, mz);
      this.walkPhase += this.speed * dt * 2.4;
    } else {
      this.speed = 0;
    }
    resolveCircleCollision(this.pos, PLAYER_RADIUS, this.city.colliders);
    clampToBounds(this.pos);
  }

  _stepCar(dt, input) {
    const car = this.drivenCar;
    const throttle = input.moveForward;
    if (throttle > 0) car.speed += CAR_ACCEL * dt;
    else if (throttle < 0) car.speed -= CAR_BRAKE * dt;
    // Rolling drag always pulls toward a stop.
    car.speed -= car.speed * CAR_DRAG * dt;
    if (throttle === 0 && Math.abs(car.speed) < 0.15) car.speed = 0;
    car.speed = Math.max(-CAR_MAX_REVERSE, Math.min(CAR_MAX_SPEED, car.speed));

    const speedFactor = 1 - Math.min(Math.abs(car.speed) / CAR_MAX_SPEED, 1) * 0.55;
    const steerAngle = CAR_STEER_MAX * input.moveStrafe * speedFactor;
    car.heading += (car.speed / 2.7) * Math.tan(steerAngle) * dt;

    this.pos.x += Math.sin(car.heading) * car.speed * dt;
    this.pos.z += Math.cos(car.heading) * car.speed * dt;
    this.heading = car.heading;
    this.speed = car.speed;

    const hitWall = resolveCircleCollision(this.pos, CAR_RADIUS, this.city.colliders);
    if (hitWall) car.speed *= 0.4;
    // Bump into other parked cars (circles, cheap and good enough).
    // A hard bump is a crime, reported at most once per car per 2 s.
    for (const other of this.cars) {
      if (other === car) continue;
      const dx = this.pos.x - other.x;
      const dz = this.pos.z - other.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 4.4 && dist > 0.01) {
        const push = (4.4 - dist) / dist;
        this.pos.x += dx * push * 0.5;
        this.pos.z += dz * push * 0.5;
        if (Math.abs(car.speed) > 5 && this.onCarBump
          && (this._now - (other._lastBumpAt || -99)) > 2) {
          other._lastBumpAt = this._now;
          this.onCarBump(other, car.speed);
        }
        car.speed *= 0.5;
      }
    }
    clampToBounds(this.pos);
    car.x = this.pos.x;
    car.z = this.pos.z;
  }

  _updateMeshes() {
    if (this.mode === 'foot') {
      this.figure.position.copy(this.pos);
      this.figure.rotation.y = this.heading;
      const swing = Math.sin(this.walkPhase) * (this.speed > 0.1 ? 0.55 : 0);
      const { legL, legR, armL, armR } = this.figure.userData;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
    }
    for (const car of this.cars) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
    }
  }

  getState() {
    return {
      mode: this.mode,
      speedKmh: Math.abs(this.speed) * 3.6,
      x: this.pos.x,
      z: this.pos.z,
      heading: this.heading,
      nearCar: this.mode === 'foot' ? this.nearestCar(3.4) : null,
      drivenName: this.drivenCar ? this.drivenCar.name : null,
    };
  }
}
