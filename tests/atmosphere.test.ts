import { describe, expect, it } from 'vitest';
import { AIR_COLUMN_KM } from '../src/render/atmosphere';
import { ATMOSPHERE_LAYERS, ATMOSPHERE_TOP, SEA_LEVEL_DENSITY } from '../src/sim/atmosphere';
import { G0 } from '../src/sim/vehicle';

describe('Atmosphere drawn in 3D', () => {
  it('holds the air of the physics: the column of its layered table', () => {
    // Closed form: each layer is an exponential up to the next base (the last one up to the top).
    const L = ATMOSPHERE_LAYERS;
    const column = L.reduce((acc, [h0, rho, scale], i) => {
      const top = i + 1 < L.length ? L[i + 1][0] : ATMOSPHERE_TOP;
      return acc + rho * scale * (1 - Math.exp(-(top - h0) / scale));
    }, 0);
    expect(AIR_COLUMN_KM).toBeCloseTo(column / SEA_LEVEL_DENSITY, 3);
  });

  it('weighs 14 % less than the real air column (known limit of the table below 25 km)', () => {
    // The weight of the whole column is the standard sea-level pressure, 101,325 Pa
    // (U.S. Standard Atmosphere 1976): column = p0 / (g0 · ρ0) ≈ 8.43 km at sea-level density.
    // The table has one exponential from 0 to 25 km with a 7.25 km scale height, which falls
    // faster than the real troposphere (at 10 km it gives 0.31 kg/m³ against 0.41). If the
    // physics' atmosphere improves, this test has to change with it.
    const ratio = AIR_COLUMN_KM / (101325 / (G0 * SEA_LEVEL_DENSITY) / 1000);
    expect(ratio).toBeGreaterThan(0.84);
    expect(ratio).toBeLessThan(0.87);
  });
});
