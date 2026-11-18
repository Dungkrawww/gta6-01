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
export const CAR_DRAG = 0.6;

// Camera.
export const CAM_MIN_DIST = 4;
export const CAM_MAX_DIST = 14;
export const CAM_DEFAULT_DIST = 8;

// How many parked (stealable) cars the city holds.
export const PARKED_CAR_COUNT = 8;

// Fixed seeds keep every shot and every fresh world identical.
export const DEFAULT_SEED = 1;
