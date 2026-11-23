/*
 * Splitting the soft transparent things (the launch cloud, the exhaust wake) between the two passes
 * of the 3D view (scene.ts), so they sort right against the pad and the spacecraft.
 *
 * The pad and the spacecraft are drawn in a pass of their own after the scene, with a far plane
 * close to the camera (depth precise to millimeters) and the depth buffer cleared. Something
 * transparent drawn in the main pass is therefore painted over by the pad even where it stands in
 * front of it (the tower hid the smoke, session 44). Drawn only in the precise pass, the parts of it
 * beyond that pass's far plane would be clipped, and Earth would not hide them behind its limb.
 *
 * So each fragment is drawn once, in the pass whose depth covers it: the part nearer than the
 * precise pass's far plane in that pass (after the opaque pad and spacecraft, tested against their
 * depth), and the rest in the main pass (tested against Earth and the ground). The split goes by the
 * fragment's view depth, which both passes compute the same way (same camera, only the far plane differs).
 */

/** 'all': draw every fragment; 'far': only those at or beyond the split; 'near': only those before it. */
export type SplitMode = 'all' | 'far' | 'near';

export interface SplitUniforms {
  uSplit: { value: number };
  uSplitMode: { value: number };
}

export function splitUniforms(): SplitUniforms {
  return { uSplit: { value: 0 }, uSplitMode: { value: 0 } };
}

/** Sets the split: `depth` is the view depth (scene units) between the two passes. */
export function setSplit(u: SplitUniforms, mode: SplitMode, depth: number): void {
  u.uSplitMode.value = mode === 'all' ? 0 : mode === 'far' ? 1 : 2;
  u.uSplit.value = depth;
}

/** Vertex shader: declarations, and the line that stores the view depth (needs the view-space position `mv`). */
export const SPLIT_PARS_VERTEX = /* glsl */ `varying float vSplitDepth;`;
export const SPLIT_VERTEX = /* glsl */ `vSplitDepth = -mv.z;`;

/** Fragment shader: declarations, and the test that drops the fragments of the other pass. */
export const SPLIT_PARS_FRAGMENT = /* glsl */ `
uniform float uSplit;
uniform float uSplitMode;
varying float vSplitDepth;
`;
export const SPLIT_FRAGMENT = /* glsl */ `
if (uSplitMode > 0.5 && uSplitMode < 1.5 && vSplitDepth < uSplit) discard;
if (uSplitMode > 1.5 && vSplitDepth >= uSplit) discard;
`;
