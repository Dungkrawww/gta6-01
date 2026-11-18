// Seeded randomness for Solara City. The simulation never uses
// Math.random() or Date.now(): every random choice flows from a mulberry32
// generator built from an explicit seed, so the same seed always builds
// the same city and the same shot always renders the same frame.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Float in [min, max).
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

// Integer in [min, max] inclusive.
export function int(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// One element of an array, uniformly.
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

// True with probability p (0..1).
export function chance(rng, p) {
  return rng() < p;
}
