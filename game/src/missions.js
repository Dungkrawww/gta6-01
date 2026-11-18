// Solara City — M1 "Kurir Panas" mission (F9, Block C).
// States: 'idle' (go to the pickup) -> 'active' (carrying, timer runs)
// -> 'completed' (delivered, reward paid once) | 'failed' (timeout or
// caught while carrying). Pickup and delivery are E-interactions: the
// main loop asks the mission first, and only falls through to the car
// toggle when the mission has nothing to do at this spot. The pickup is
// an ON-FOOT action — the player gets out and grabs the package (so E in
// a car near the pickup is an exit, never a pickup, and a parked car can
// never trap the player). The delivery is a drive-through: it works from
// behind the wheel, no need to get out. The reward is paid exactly once
// — deliver() only pays while the run is active, so a second call, a
// double event, or a reload after completion all return 0.
import * as THREE from '../vendor/three.module.min.js';
import {
  MISSION_PICKUP, MISSION_DELIVERY, MISSION_PICKUP_RADIUS,
  MISSION_DELIVER_RADIUS, MISSION_TIME_LIMIT, MISSION_REWARD,
} from './config.js';

export class Mission {
  constructor(scene) {
    this.scene = scene;
    this.state = 'idle';
    this.carried = false;
    this.checkpoint = 0; // 0 = to pickup, 1 = carrying, 2 = delivered
    this.timeLeft = MISSION_TIME_LIMIT;
    this.rewardPaid = false;
    this.failReason = null;
    this.onPickup = null; // () => void
    this.onDeliver = null; // (amount) => void
    this.onTimeout = null; // () => void
    this._bob = 0;
    this._lastPx = 0;
    this._lastPz = 0;
    this._lastMode = 'foot';
    this._buildMarkers(scene);
  }

  // A floating diamond + ground ring at each end of the run, so the
  // player can find the job without reading the HUD.
  _buildMarkers(scene) {
    const make = (x, z, color) => {
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color, emissive: color });
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), mat);
      diamond.position.y = 3.2;
      group.add(diamond);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.0, 32),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);
      group.position.set(x, 0, z);
      scene.add(group);
      return { group, diamond, ring, x, z };
    };
    this.pickupMarker = make(MISSION_PICKUP.x, MISSION_PICKUP.z, 0xe8c832);
    this.deliveryMarker = make(MISSION_DELIVERY.x, MISSION_DELIVERY.z, 0x3aa655);
  }

  _distTo(point, px, pz) {
    return Math.hypot(point.x - px, point.z - pz);
  }

  nearPickup(px, pz) {
    return this._distTo(MISSION_PICKUP, px, pz) <= MISSION_PICKUP_RADIUS;
  }

  nearDelivery(px, pz) {
    return this._distTo(MISSION_DELIVERY, px, pz) <= MISSION_DELIVER_RADIUS;
  }

  // The E-interaction. Returns true when the mission consumed the press
  // (so the caller must NOT toggle the car). A failed run restarts the
  // same way — fresh timer, no reward, no duplicate checkpoint.
  // inCar: true when the player pressed E from behind the wheel. The
  // pickup needs the player on foot — E in a car near the pickup is an
  // exit, not a pickup. The delivery works from the car (drive-through)
  // and on foot.
  tryInteract(px, pz, inCar) {
    if ((this.state === 'idle' || this.state === 'failed') && !inCar && this.nearPickup(px, pz)) {
      this._startCarrying();
      return true;
    }
    if (this.state === 'active' && this.nearDelivery(px, pz)) {
      this.deliver();
      return true;
    }
    return false;
  }

  _startCarrying() {
    this.state = 'active';
    this.carried = true;
    this.checkpoint = 1;
    this.timeLeft = MISSION_TIME_LIMIT;
    this.failReason = null;
    if (this.onPickup) this.onPickup();
  }

  // Pays the reward exactly once. Returns the amount paid (150 or 0).
  // A second call, a call after completion, or a call after a reload
  // that already paid all return 0 and change nothing.
  deliver() {
    if (this.state !== 'active' || !this.carried) return 0;
    this.state = 'completed';
    this.carried = false;
    this.checkpoint = 2;
    this.rewardPaid = true;
    if (this.onDeliver) this.onDeliver(MISSION_REWARD);
    return MISSION_REWARD;
  }

  // Fail the run: timer out or caught while carrying. Keeps the
  // checkpoint and the unpaid reward flag, so a reload shows the same
  // failed state instead of inventing a new one.
  fail(reason) {
    if (this.state === 'completed' || this.state === 'failed') return;
    this.state = 'failed';
    this.carried = false;
    this.failReason = reason;
  }

  // Back to the start (Retry button): no reward, no checkpoint, fresh.
  reset() {
    this.state = 'idle';
    this.carried = false;
    this.checkpoint = 0;
    this.timeLeft = MISSION_TIME_LIMIT;
    this.rewardPaid = false;
    this.failReason = null;
  }

  // One fixed step: countdown while carrying, marker animation.
  // ctx: { now, x, z, mode } — the player's position and mode, for the
  // HUD prompt (the pickup prompt only makes sense on foot).
  step(dt, ctx) {
    if (ctx) {
      this._lastPx = ctx.x;
      this._lastPz = ctx.z;
      this._lastMode = ctx.mode || 'foot';
    }
    this._bob += dt;
    this.pickupMarker.diamond.rotation.y += dt * 1.2;
    this.deliveryMarker.diamond.rotation.y += dt * (this.state === 'active' ? 3.0 : 1.2);
    const bob = Math.sin(this._bob * 2) * 0.3;
    this.pickupMarker.diamond.position.y = 3.2 + bob;
    this.deliveryMarker.diamond.position.y = 3.2 - bob;
    if (this.state === 'active') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.fail('Waktu habis');
        if (this.onTimeout) this.onTimeout();
      }
    }
  }

  // Test hook: set the clock so the timeout path can be exercised
  // without waiting the full 150 sim-seconds.
  debugSetTimeLeft(seconds) {
    this.timeLeft = seconds;
  }

  _formatTimeLeft() {
    const total = Math.max(0, Math.ceil(this.timeLeft));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  _objective() {
    if (this.state === 'idle') return `Ambil paket di ${MISSION_PICKUP.name}`;
    if (this.state === 'active') return `Antar paket ke ${MISSION_DELIVERY.name} — ${this._formatTimeLeft()}`;
    if (this.state === 'completed') return `SELESAI — Kurir Panas +$${MISSION_REWARD}`;
    return `GAGAL — Kurir Panas (${this.failReason || 'gagal'})`;
  }

  // The prompt the HUD shows. The pickup prompt only appears on foot —
  // in a car near the pickup the player has to get out first (the speed
  // line already says "E to exit").
  _prompt() {
    if (this._lastMode === 'foot' && (this.state === 'idle' || this.state === 'failed')
      && this.nearPickup(this._lastPx, this._lastPz)) {
      return this.state === 'failed' ? 'Tekan E untuk mulai lagi' : 'Tekan E untuk ambil paket';
    }
    if (this.state === 'active' && this.nearDelivery(this._lastPx, this._lastPz)) {
      return 'Tekan E untuk antar paket';
    }
    return null;
  }

  getState() {
    const markers = [];
    if (this.state === 'idle' || this.state === 'failed') {
      markers.push({ x: MISSION_PICKUP.x, z: MISSION_PICKUP.z, kind: 'pickup' });
    }
    if (this.state === 'active') {
      markers.push({ x: MISSION_DELIVERY.x, z: MISSION_DELIVERY.z, kind: 'delivery' });
    }
    return {
      state: this.state,
      carried: this.carried,
      checkpoint: this.checkpoint,
      timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
      rewardPaid: this.rewardPaid,
      failReason: this.failReason,
      objective: this._objective(),
      prompt: this._prompt(),
      markers,
    };
  }

  // Plain data for the save file (no meshes, no callbacks).
  toSave() {
    return {
      state: this.state,
      carried: this.carried,
      checkpoint: this.checkpoint,
      timeLeft: this.timeLeft,
      rewardPaid: this.rewardPaid,
      failReason: this.failReason,
    };
  }

  fromSave(data) {
    if (!data || typeof data !== 'object') return;
    this.state = data.state || 'idle';
    this.carried = data.carried === true;
    this.checkpoint = data.checkpoint || 0;
    this.timeLeft = typeof data.timeLeft === 'number' ? data.timeLeft : MISSION_TIME_LIMIT;
    this.rewardPaid = data.rewardPaid === true;
    this.failReason = data.failReason || null;
  }
}
