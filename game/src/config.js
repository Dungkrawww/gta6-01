// Solara City — shared constants: city layout, palette, names, tuning.
// One source of truth for every module; no magic numbers elsewhere.
export const STEP = 1 / 60;

// City grid: 8x8 blocks. Roads are 12 m wide, blocks 36 m, pitch 48 m.
// Road centre lines sit at -198 + i * 48 for i = 0..8, so the city spans
// -198 .. 198 on both axes. The beach lies east of x = 198.
export const GRID = 8;
export const BLOCK = 36;
export const ROAD = 12;
export const PITCH = BLOCK + ROAD;
export const CITY_HALF = (GRID * PITCH + ROAD) / 2; // 198
export const BEACH_START = CITY_HALF; // 198
export const SAND_END = 246;
export const WATER_END = 340;

// Playable bounds (city + beach strip; water is a wall).
export const BOUNDS = { minX: -210, maxX: 252, minZ: -210, maxZ: 210 };

// Avenue names run north-south (roads at fixed x), street names east-west.
export const AVENUES = [
  'Sunset Ave', 'Palm Ave', 'Marina Ave', 'Coral Ave', 'Harbor Ave',
  'Lagoon Ave', 'Solara Ave', 'Breeze Ave', 'Dune Ave',
];
export const STREETS = [
  '1st St', '2nd St', '3rd St', '4th St', '5th St',
  '6th St', '7th St', '8th St', '9th St',
];

// Sun-soaked palette (original art direction: warm plaster, terracotta, sand).
export const BUILDING_COLORS = [
  0xf2e3c6, 0xe8d3a8, 0xd9a86c, 0xc97e5a, 0xf6efdd,
  0xe6c9a0, 0xcf9a6b, 0xead9b0, 0xb98a68, 0xf0dcc0,
];
export const CAR_COLORS = [
  0xe8542f, 0x2f7fc2, 0xe8c832, 0x3aa655, 0xdfe3e6,
  0x8a5ec7, 0x22252a, 0xc22f4e, 0x2fb3a6,
];
export const CAR_NAMES = [
  'Comet', 'Marina', 'Palm', 'Citra', 'Breeze', 'Coral', 'Laguna', 'Sirocco',
];
export const TREE_GREENS = [0x4d7c3a, 0x5d8f43, 0x6fa04e, 0x3f6d33];

// Movement tuning (arcade, not simulation).
export const WALK_SPEED = 4.0;
export const RUN_SPEED = 7.0;
export const PLAYER_RADIUS = 0.45;
export const CAR_ACCEL = 9.0;
export const CAR_BRAKE = 16.0;
export const CAR_MAX_SPEED = 28.0;
export const CAR_MAX_REVERSE = 8.0;
export const CAR_STEER_MAX = 0.55;
export const CAR_RADIUS = 1.7;
// Drag caps the top speed: accel/drag = 9/0.35 ≈ 25.7 m/s, just under
// CAR_MAX_SPEED. (Block A had 0.6, which capped the car at 15 m/s —
// slower than the police pursuit speeds, so Raka could never escape.
// Fixed in Block B; verified by the combined playtest.)
export const CAR_DRAG = 0.35;

// Camera.
export const CAM_MIN_DIST = 4;
export const CAM_MAX_DIST = 14;
export const CAM_DEFAULT_DIST = 8;

// How many parked (stealable) cars the city holds.
export const PARKED_CAR_COUNT = 8;

// ---- Block B: traffic, peds, wanted / police (F6, F7, F8, F11). ----
// Traffic: simple road-following cars on the centre-line grid.
export const TRAFFIC_COUNT = 10;
export const TRAFFIC_SPEED_MIN = 6;
export const TRAFFIC_SPEED_MAX = 11;
export const TRAFFIC_TURN_CHANCE = 0.25; // at an intersection, turn instead of going straight
export const TRAFFIC_CAR_GAP = 8; // slow when a car ahead is closer than this
export const TRAFFIC_STOP_GAP = 5; // full stop when a car ahead is closer than this
export const LANE_OFFSET = 2.2; // right-hand lane offset from the road centre line

// Pedestrians: one model, sidewalk wanderers that flee chaos.
export const PED_COUNT = 20;
export const PED_WALK_SPEED = 1.2;
export const PED_FLEE_SPEED = 3.6;
export const PED_FLEE_RADIUS = 12; // flee when chaos is closer than this
export const PED_FLEE_TIME = 2.5;

// Wanted: heat 0..100 maps to levels 0..3.
export const HEAT_LEVEL_1 = 25;
export const HEAT_LEVEL_2 = 50;
export const HEAT_LEVEL_3 = 75;
export const HEAT_STEAL = 35; // stealing a parked car
export const HEAT_HIT_CAR = 15; // ramming another car
export const HEAT_HIT_PED = 25; // running a pedestrian over
export const HEAT_MELEE = 20; // punching a pedestrian (conditional feature)
export const HEAT_DECAY_PER_SEC = 3; // after HEAT_QUIET_SECONDS without a crime
export const HEAT_QUIET_SECONDS = 10;

// Police pursuit: base top speed per wanted level (player max 28).
export const POLICE_SPEED = { 1: 13, 2: 17, 3: 21 };
export const POLICE_RUBBER_BAND = 10; // extra speed when far behind the player
export const POLICE_SPAWN_DIST = 70; // spawn this far from the player, on a road
// Catch range must exceed the car-ram push distance (4.4 m): a police car
// grinding head-on into the player sits at ~4.4 m, so a smaller range
// could never trigger the catch. (Block B fix after the chase debug.)
export const POLICE_CATCH_DIST = 8; // within this for POLICE_CATCH_TIME = caught
// 8 m, not 5.5: a police car drives in its own lane, so a player parked on
// the far side of the street is ~6 m away laterally (lane offset 2.2 m
// each side) — the old 5.5 m range could never be reached and the police
// circled a stopped player forever.
export const POLICE_CATCH_TIME = 2.5;
export const POLICE_ROADBLOCK_DIST = 40; // roadblock placed this far ahead (level 3)

// Player economy / health (HUD + caught fine).
export const CASH_START = 120;
export const FINE_CAUGHT = 50;
export const HEALTH_START = 100;
export const HEALTH_HIT_BY_CAR = 10; // traffic car hits Raka on foot
export const HEALTH_HARD_CRASH = 5; // player car hits a wall hard
export const HEALTH_REGEN_PER_SEC = 2;

// ---- Block C: mission M1 "Kurir Panas" (F9), save/load (F13). ----
// Pickup and delivery are fixed road intersections, so the job is the
// same every run (seeded determinism is preserved: no RNG here).
export const MISSION_PICKUP = { x: -102, z: -102, name: 'Palm Ave & 3rd St' };
export const MISSION_DELIVERY = { x: 138, z: 138, name: 'Kantor Coral' };
export const MISSION_PICKUP_RADIUS = 8; // press E inside this to take the package
export const MISSION_DELIVER_RADIUS = 10; // press E inside this, from the car, to deliver
export const MISSION_TIME_LIMIT = 150; // seconds to deliver once carrying
export const MISSION_REWARD = 150; // paid exactly once, on delivery
export const MISSION_RETRY_RESPAWN = { x: -102, z: -96 }; // 6 m south of the pickup
export const SAVE_KEY = 'solara-city-save-v1';
export const SAVE_AUTOSAVE_STEPS = 300; // autosave every 5 sim-seconds

// Fixed seeds keep every shot and every fresh world identical.
export const DEFAULT_SEED = 1;
