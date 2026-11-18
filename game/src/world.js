// Solara City — procedural city generation (F1).
// Builds an 8x8-block coastal city from a seed: roads, sidewalks, buildings,
// streetlights, trees, beach + water, and parked cars. All geometry is
// instanced (a handful of draw calls) and all randomness flows from the
// seed, so the same seed always builds the same city.
import * as THREE from '../vendor/three.module.min.js';
import {
  GRID, BLOCK, ROAD, PITCH, CITY_HALF, BEACH_START, SAND_END, WATER_END,
  BOUNDS, BUILDING_COLORS, CAR_COLORS, CAR_NAMES, TREE_GREENS,
  PARKED_CAR_COUNT,
} from './config.js';
import { mulberry32, range, int, pick, chance } from './random.js';

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

function roadCenters() {
  const centers = [];
  for (let i = 0; i <= GRID; i++) centers.push(-CITY_HALF + i * PITCH);
  return centers;
}

function setInstance(mesh, index, x, y, z, sx, sy, sz, rotY, color) {
  _euler.set(0, rotY, 0);
  _quat.setFromEuler(_euler);
  _pos.set(x, y, z);
  _scale.set(sx, sy, sz);
  _matrix.compose(_pos, _quat, _scale);
  mesh.setMatrixAt(index, _matrix);
  if (color !== undefined) mesh.setColorAt(index, _color.setHex(color));
}

// AABB collision: push a circle (x, z, radius) out of every box it overlaps.
// Returns true when a push happened. Mutates pos in place.
export function resolveCircleCollision(pos, radius, colliders) {
  let pushed = false;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    pushed = true;
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const push = (radius - dist) / dist;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pushLeft = pos.x - c.minX + radius;
      const pushRight = c.maxX - pos.x + radius;
      const pushBack = pos.z - c.minZ + radius;
      const pushFront = c.maxZ - pos.z + radius;
      const min = Math.min(pushLeft, pushRight, pushBack, pushFront);
      if (min === pushLeft) pos.x = c.minX - radius;
      else if (min === pushRight) pos.x = c.maxX + radius;
      else if (min === pushBack) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  return pushed;
}

export function clampToBounds(pos) {
  pos.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, pos.x));
  pos.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, pos.z));
}

// Nearest road indices for a position (for the HUD street name).
export function nearestRoads(x, z) {
  const centers = roadCenters();
  let avenue = 0;
  let street = 0;
  let bestA = Infinity;
  let bestS = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const da = Math.abs(x - centers[i]);
    const ds = Math.abs(z - centers[i]);
    if (da < bestA) { bestA = da; avenue = i; }
    if (ds < bestS) { bestS = ds; street = i; }
  }
  return { avenue, street };
}

export function generateCity(scene, seed) {
  const rng = mulberry32(seed);
  const centers = roadCenters();
  const city = {
    seed,
    centers,
    buildings: [],
    colliders: [],
    parkedCars: [],
    bounds: BOUNDS,
  };

  // ---- Ground: dry warm earth under everything.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ color: 0xc9b183 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- Beach sand + water east of the city.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(SAND_END - BEACH_START, 2 * CITY_HALF + 24),
    new THREE.MeshLambertMaterial({ color: 0xe8d49a }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((BEACH_START + SAND_END) / 2, 0.02, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_END - SAND_END, 2 * CITY_HALF + 24),
    new THREE.MeshLambertMaterial({ color: 0x2f7fc2, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((SAND_END + WATER_END) / 2, -0.25, 0);
  scene.add(water);

  // ---- Roads: 9 vertical + 9 horizontal asphalt strips.
  const roadLength = 2 * CITY_HALF + ROAD;
  const roadGeo = new THREE.PlaneGeometry(1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  const roadMesh = new THREE.InstancedMesh(
    roadGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f45 }), 18,
  );
  let roadIndex = 0;
  for (const c of centers) {
    setInstance(roadMesh, roadIndex++, c, 0.03, 0, ROAD, 1, roadLength, 0);
    setInstance(roadMesh, roadIndex++, 0, 0.03, c, roadLength, 1, ROAD, 0);
  }
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  // ---- Centre dashes along every road, skipping intersections.
  const dashSpots = [];
  for (const c of centers) {
    for (let t = -CITY_HALF; t <= CITY_HALF; t += 6) {
      let nearCross = false;
      for (const cross of centers) {
        if (Math.abs(t - cross) < 9) { nearCross = true; break; }
      }
      if (!nearCross) dashSpots.push({ x: c, z: t, alongZ: true });
      if (!nearCross) dashSpots.push({ x: t, z: c, alongZ: false });
    }
  }
  const dashGeo = new THREE.PlaneGeometry(1, 1);
  dashGeo.rotateX(-Math.PI / 2);
  const dashMesh = new THREE.InstancedMesh(
    dashGeo, new THREE.MeshLambertMaterial({ color: 0xd8c25a }), dashSpots.length,
  );
  dashSpots.forEach((d, i) => {
    if (d.alongZ) setInstance(dashMesh, i, d.x, 0.05, d.z, 0.18, 1, 2.6, 0);
    else setInstance(dashMesh, i, d.x, 0.05, d.z, 2.6, 1, 0.18, 0);
  });
  scene.add(dashMesh);

  // ---- Sidewalks: one raised slab per block.
  const walkGeo = new THREE.BoxGeometry(1, 1, 1);
  const walkMesh = new THREE.InstancedMesh(
    walkGeo, new THREE.MeshLambertMaterial({ color: 0xb9ac93 }), GRID * GRID,
  );
  let walkIndex = 0;
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const cx = centers[bx] + PITCH / 2;
      const cz = centers[bz] + PITCH / 2;
      setInstance(walkMesh, walkIndex++, cx, 0.06, cz, BLOCK, 0.14, BLOCK, 0);
    }
  }
  walkMesh.receiveShadow = true;
  scene.add(walkMesh);

  // ---- Buildings: 1-3 per block, taller toward the centre.
  const buildingSpots = [];
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      const x0 = centers[bx] + ROAD / 2 + 3;
      const z0 = centers[bz] + ROAD / 2 + 3;
      const x1 = centers[bx + 1] - ROAD / 2 - 3;
      const z1 = centers[bz + 1] - ROAD / 2 - 3;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const centreDist = Math.sqrt(cx * cx + cz * cz);
      const heightScale = 1.5 - Math.min(1, centreDist / 320);
      const count = int(rng, 1, 3);
      const slots = [
        { x: x0 + 7, z: z0 + 7 }, { x: x1 - 7, z: z0 + 7 },
        { x: x0 + 7, z: z1 - 7 }, { x: x1 - 7, z: z1 - 7 },
      ];
      // Shuffle the four corner slots with the seeded rng.
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (let s = 0; s < count; s++) {
        const w = range(rng, 10, 14);
        const d = range(rng, 10, 14);
        const h = range(rng, 8, 26) * heightScale + 4;
        const color = pick(rng, BUILDING_COLORS);
        buildingSpots.push({ x: slots[s].x, z: slots[s].z, w, d, h, color });
      }
    }
  }
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMesh = new THREE.InstancedMesh(
    buildingGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), buildingSpots.length,
  );
  const roofMesh = new THREE.InstancedMesh(
    buildingGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), buildingSpots.length,
  );
  buildingSpots.forEach((b, i) => {
    setInstance(buildingMesh, i, b.x, b.h / 2, b.z, b.w, b.h, b.d, 0, b.color);
    _color.setHex(b.color).multiplyScalar(0.62);
    setInstance(roofMesh, i, b.x, b.h + 0.25, b.z, b.w + 0.8, 0.5, b.d + 0.8, 0, _color.getHex());
    city.buildings.push(b);
    city.colliders.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    });
  });
  buildingMesh.castShadow = true;
  buildingMesh.receiveShadow = true;
  roofMesh.castShadow = true;
  scene.add(buildingMesh);
  scene.add(roofMesh);

  // ---- Streetlights at every other intersection corner.
  const lightSpots = [];
  for (let ix = 0; ix < centers.length; ix++) {
    for (let iz = 0; iz < centers.length; iz++) {
      if ((ix + iz) % 2 !== 0) continue;
      lightSpots.push({ x: centers[ix] + 7, z: centers[iz] + 7 });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const poleMesh = new THREE.InstancedMesh(
    poleGeo, new THREE.MeshLambertMaterial({ color: 0x2c2f33 }), lightSpots.length,
  );
  const headGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const headMesh = new THREE.InstancedMesh(
    headGeo, new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffdf8a }), lightSpots.length,
  );
  lightSpots.forEach((p, i) => {
    setInstance(poleMesh, i, p.x, 3, p.z, 1, 1, 1, 0);
    setInstance(headMesh, i, p.x, 6.2, p.z, 1, 1, 1, 0);
  });
  scene.add(poleMesh);
  scene.add(headMesh);

  // ---- Trees along sidewalks, seeded.
  const treeSpots = [];
  for (let bx = 0; bx < GRID; bx++) {
    for (let bz = 0; bz < GRID; bz++) {
      if (!chance(rng, 0.55)) continue;
      const cx = centers[bx] + PITCH / 2 + range(rng, -14, 14);
      const cz = centers[bz] + PITCH / 2 + range(rng, -14, 14);
      treeSpots.push({ x: cx, z: cz, s: range(rng, 0.8, 1.4), green: pick(rng, TREE_GREENS) });
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6);
  const trunkMesh = new THREE.InstancedMesh(
    trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), treeSpots.length,
  );
  const canopyGeo = new THREE.IcosahedronGeometry(1.6, 0);
  const canopyMesh = new THREE.InstancedMesh(
    canopyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), treeSpots.length,
  );
  treeSpots.forEach((t, i) => {
    setInstance(trunkMesh, i, t.x, 1.1, t.z, t.s, t.s, t.s, 0);
    setInstance(canopyMesh, i, t.x, 3.4 * t.s, t.z, t.s, t.s, t.s, 0, t.green);
  });
  trunkMesh.castShadow = true;
  canopyMesh.castShadow = true;
  scene.add(trunkMesh);
  scene.add(canopyMesh);

  // ---- Parked cars: parallel-parked along road edges, stealable.
  for (let n = 0; n < PARKED_CAR_COUNT; n++) {
    const alongZ = chance(rng, 0.5);
    const road = pick(rng, centers);
    let t = range(rng, -CITY_HALF + 20, CITY_HALF - 20);
    // Keep clear of intersections.
    let clear = true;
    for (const cross of centers) {
      if (Math.abs(t - cross) < 12) { clear = false; break; }
    }
    if (!clear) t += 24;
    const side = chance(rng, 0.5) ? 1 : -1;
    const offset = ROAD / 2 - 2.2;
    const x = alongZ ? road + side * offset : t;
    const z = alongZ ? t : road + side * offset;
    const heading = alongZ ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    city.parkedCars.push({
      x, z, heading,
      color: pick(rng, CAR_COLORS),
      name: pick(rng, CAR_NAMES),
      taken: false,
    });
  }

  return city;
}
