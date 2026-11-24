import * as THREE from 'three';
import type { Haze } from './atmosphere';

export interface Stars {
  /**
   * Draws the background. Call before the main scene, with the buffer already cleared. `eyeKm`: the
   * main camera's position relative to Earth's center (km), for the sky brightness (3D only).
   */
  render(renderer: THREE.WebGLRenderer, main: THREE.Camera, aspect: number, frameAngle: number, eyeKm?: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Brightness of the sky behind a star (luminance of the light the air scatters towards the camera,
 * linear, from atmosphere.ts) at which the star starts to fade and at which it is gone. Drawing
 * choice: in daylight the sky outshines the stars, which is why they are not seen. With the model's
 * exposure the zenith of the day sky at the pad is ~0.015 and the sky after sunset, or above ~40 km,
 * is below 0.001 (estimates from the atmosphere's numbers, checked in screenshots).
 */
const SKY_FADE_START = 0.002;
const SKY_FADE_END = 0.01;

/** Deterministic generator: the sky is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Background star field. It is decorative (random positions, not a real catalog).
 * Drawn with its own camera that only copies the main camera's orientation,
 * so it does not depend on the zoom or the floating origin. In the rotating frame the sky turns,
 * which is exactly what would be seen from that frame.
 * With `air` (the 3D view, from the atmosphere), each star fades with the brightness of the sky in
 * its direction, computed in the vertex shader with the atmosphere's own integral: the stars go
 * away in the day sky, come out at dusk and above the air, and stay behind the bright limb.
 */
export function createStars(color: string, count = 1600, air: Pick<Haze, 'uniforms' | 'head'> | null = null): Stars {
  const random = mulberry32(20260401);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    // Uniform point on the sphere.
    const z = 2 * random() - 1;
    const phi = 2 * Math.PI * random();
    const r = Math.sqrt(1 - z * z);
    positions.set([10 * r * Math.cos(phi), 10 * r * Math.sin(phi), 10 * z], i * 3);
    // Many faint stars and few bright ones.
    const brightness = 0.12 + 0.75 * Math.pow(random(), 3.2);
    colors.set([base.r * brightness, base.g * brightness, base.b * brightness], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, depthTest: false });
  const eye = new THREE.Vector3();
  const skyOn = { value: 0 };
  if (air) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, air.uniforms, { uEye: { value: eye }, uStarSky: skyOn });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${air.head}\nuniform vec3 uEye;\nuniform float uStarSky;`).replace(
        '#include <color_vertex>',
        /* glsl */ `#include <color_vertex>
        {
          // The star's direction in the main scene (its camera only copies the orientation).
          vec3 starDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          vec2 stAir = airSphere(uEye, starDir, AIR_R_TOP);
          float stT0 = max(stAir.x, 0.0);
          float stT1 = stAir.y;
          vec2 stGround = airSphere(uEye, starDir, AIR_R_E);
          if (stGround.x <= stGround.y && stGround.y > 0.0) stT1 = min(stT1, max(stGround.x, 0.0));
          if (uStarSky > 0.5 && stT1 > stT0) {
            vec3 sky = airScatter(uEye, starDir, stT0, stT1).rgb;
            vColor *= 1.0 - smoothstep(${SKY_FADE_START.toFixed(4)}, ${SKY_FADE_END.toFixed(4)}, dot(sky, vec3(0.2126, 0.7152, 0.0722)));
          }
        }`,
      );
    };
  }
  const points = new THREE.Points(geometry, material);
  const scene = new THREE.Scene();
  scene.add(points);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);

  return {
    render(renderer, main, aspect, frameAngle, eyeKm) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.quaternion.copy(main.quaternion);
      points.rotation.z = -frameAngle;
      if (eyeKm) eye.copy(eyeKm);
      skyOn.value = eyeKm ? 1 : 0;
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
