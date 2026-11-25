import type { Look } from './materials';
import { choices } from './heroOptions';
import type { Draft } from './model';

// One source of truth for the 3D hero: the editor, the PNG export and later the embed all read it.
export const FOV = 30, DISTANCE = 6, PUSH_SECONDS = 1.5;
// Every model rests at the same three-quarter turn, facing toward the copy.
export const REST_TURN = -.5;

export type Motion = 'Still' | 'Float' | 'Hover Pop' | 'Slide' | 'Sway' | 'Cursor Tilt';
export type CameraMove = 'Static' | 'Push-in' | 'Cursor Follow' | 'Push-out';
export type Lighting = {hdri: string; environment: number; key: number; keyColor: string};
// `roomFor` is the motion and camera the user chose; the model is sized to stay inside the hero for them even while paused.
export type Scene = {modelPath: string; look: Look; motion: Motion; period: number; amount: number; reverse: boolean; camera: CameraMove; lighting: Lighting; animate: boolean; roomFor: {motion: Motion; camera: CameraMove}};
export type Box = {x: number; y: number; w: number; h: number};
export type Pointer = {x: number; y: number};

const motions: readonly Motion[] = choices.motion;
const moves: readonly CameraMove[] = choices.camera;
// Self-hosted CC0 studio HDRIs from Poly Haven; the key light carries the lighting colour.
const studios: Record<string, Omit<Lighting, 'keyColor'> & {metal?: {environment: number; roughness: number}}> = {
  Soft: { hdri: '/hdri/soft.hdr', environment: .8, key: .8 },
  Bright: { hdri: '/hdri/bright.hdr', environment: 1.3, key: 1.2 },
  // Most of this studio is black, so polished metal's flat faces would mirror only black; Metallic gets a brighter, softer reflection.
  Dramatic: { hdri: '/hdri/dramatic.hdr', environment: .7, key: 2.5, metal: { environment: 1.2, roughness: .5 } },
};

export function sceneFromDraft(draft: Draft, { playing = true, reducedMotion = false } = {}): Scene {
  const still = !playing || reducedMotion;
  const chosen = { motion: motions.find(m => m === draft.motion) ?? 'Still', camera: moves.find(m => m === draft.camera) ?? 'Static' };
  const motion = still ? 'Still' : chosen.motion;
  const camera = still ? 'Static' : chosen.camera;
  const { metal, ...studio } = studios[draft.lighting] ?? studios.Soft, metalTweak = draft.material === 'Metallic' ? metal : undefined;
  return {
    modelPath: draft.lookModelPath || draft.modelPath,
    look: { material: draft.material, color: draft.color, secondColor: draft.secondColor, textured: Boolean(draft.lookModelPath), ...(metalTweak && { roughness: metalTweak.roughness }) },
    motion, period: 4 / Math.max(draft.speed, .1), amount: draft.amount / 100, reverse: draft.direction === 'Reverse', camera,
    lighting: { ...studio, ...(metalTweak && { environment: metalTweak.environment }), keyColor: draft.lightingColor },
    // Cursor Follow redraws on each pointer move instead of every frame.
    animate: motion !== 'Still',
    roomFor: chosen,
  };
}

// Seconds of motion: 0 on the first frame that draws the placed model, then each frame's delta while something moves.
// It holds while paused or still, so a hero never starts mid-motion and doesn't jump after a pause.
export const motionTime = (previous: number | null, delta: number, moving: boolean) => previous === null ? 0 : moving ? previous + delta : previous;

// Where a model of the given size sits in a box (fractions of the hero). It fits the box's height; the ear's boxes are
// narrow, so wide models may spread to WIDE times the box width instead of shrinking to fit it.
const WIDE = 1.4;
export function fitInBox(box: Box, aspect: number, size: {w: number; h: number}) {
  const height = 2 * DISTANCE * Math.tan(FOV * Math.PI / 360), width = height * aspect;
  return { x: (box.x + box.w / 2 - .5) * width, y: (.5 - box.y - box.h / 2) * height, scale: Math.min(box.w * WIDE * width / size.w, box.h * height / size.h), boxHeight: box.h * height };
}

// The model's offset (in box heights), extra turn and tilt (radians) and scale at a moment; one swing takes `period` seconds.
export function pose({ motion, period, amount, reverse }: Pick<Scene, 'motion' | 'period' | 'amount' | 'reverse'>, seconds: number, pointer: Pointer = { x: 0, y: 0 }) {
  const swing = (1 - Math.cos(Math.PI * seconds / period)) / 2, p = reverse ? 1 - swing : swing;
  const rest = { x: 0, y: 0, turn: 0, tilt: 0, scale: 1 };
  if (motion === 'Float') return { ...rest, y: p * amount * .15 };
  if (motion === 'Slide') return { ...rest, x: p * amount * .25 };
  if (motion === 'Sway') return { ...rest, turn: (2 * p - 1) * amount * .6 };
  if (motion === 'Hover Pop') return { ...rest, scale: 1 + p * amount * .15 };
  if (motion === 'Cursor Tilt') return { ...rest, turn: pointer.x * amount * .8, tilt: pointer.y * amount * .4 };
  return rest;
}

// The camera's distance and sideways offset; Push-in and Push-out ease once over PUSH_SECONDS, then hold.
export function cameraAt(move: CameraMove, seconds: number, pointer: Pointer = { x: 0, y: 0 }) {
  const t = Math.min(1, seconds / PUSH_SECONDS), ease = 1 - (1 - t) ** 3;
  if (move === 'Push-in') return { distance: DISTANCE * (1 + (1 / 1.15 - 1) * ease), x: 0, y: 0 };
  if (move === 'Push-out') return { distance: DISTANCE * (1 + (1 / .8 - 1) * ease), x: 0, y: 0 };
  // Moving the camera against the pointer makes the scene lean toward it.
  if (move === 'Cursor Follow') return { distance: DISTANCE, x: -pointer.x * .4, y: pointer.y * .25 };
  return { distance: DISTANCE, x: 0, y: 0 };
}

export type Placement = ReturnType<typeof fitInBox>;
// How close the model may come to the hero's edge, as a fraction of its half-width or half-height.
const MARGIN = .02;
const widest = (from: number, to: number, size: (angle: number) => number) => Math.max(...Array.from({ length: 33 }, (_, i) => size(from + (to - from) * i / 32)));

// The placement shrunk toward the hero's centre just enough that the model's box stays inside the hero, perspective
// included, at every point of the chosen motion and camera move. `extent` is the model's unscaled size along x, y and z.
export function keepInside(placed: Placement, { motion, camera, amount }: {motion: Motion; camera: CameraMove; amount: number}, aspect: number, extent: {x: number; y: number; z: number}): Placement {
  // The motion's extremes: the ends of a swing, at each corner of the pointer's range.
  const poses = [0, .5, 1].flatMap(t => [-.5, 0, .5].flatMap(x => [-.5, 0, .5].map(y => pose({ motion, period: 1, amount, reverse: false }, t, { x, y }))));
  const most = (value: (p: typeof poses[number]) => number) => Math.max(...poses.map(value)), least = (value: (p: typeof poses[number]) => number) => Math.min(...poses.map(value));
  const turnFrom = REST_TURN + least(p => p.turn), turnTo = REST_TURN + most(p => p.turn), tilt = most(p => Math.abs(p.tilt)), pop = most(p => p.scale);
  // The model's widest and deepest while it turns, then its tallest and deepest while it tilts.
  const width = widest(turnFrom, turnTo, a => extent.x * Math.abs(Math.cos(a)) + extent.z * Math.abs(Math.sin(a)));
  const turnedDepth = widest(turnFrom, turnTo, a => extent.x * Math.abs(Math.sin(a)) + extent.z * Math.abs(Math.cos(a)));
  const height = widest(0, tilt, t => extent.y * Math.cos(t) + turnedDepth * Math.sin(t));
  const depth = widest(0, tilt, t => extent.y * Math.sin(t) + turnedDepth * Math.cos(t));
  const half = { x: width * placed.scale * pop / 2, y: height * placed.scale * pop / 2, z: depth * placed.scale * pop / 2 };
  // Push-in brings the camera closer; Cursor Follow shifts it sideways and up or down.
  const cameraZ = Math.min(DISTANCE, cameraAt(camera, PUSH_SECONDS).distance), shift = cameraAt(camera, 0, { x: .5, y: .5 });
  const tanY = Math.tan(FOV * Math.PI / 360), tanX = tanY * aspect, b = placed.boxHeight;
  // A corner `reach` from the view's centre, `half.z` toward the camera, stays inside while
  // f × reach + shift ≤ (1 − MARGIN) × tan × (cameraZ − f × half.z); this is the largest such f for one edge.
  const fit = (reach: number, offset: number, tan: number) => reach <= 0 ? Infinity : ((1 - MARGIN) * tan * cameraZ - Math.abs(offset)) / (reach + (1 - MARGIN) * tan * half.z);
  const f = Math.max(.1, Math.min(1,
    fit(placed.x + most(p => p.x) * b + half.x, shift.x, tanX), fit(-(placed.x + least(p => p.x) * b) + half.x, shift.x, tanX),
    fit(placed.y + most(p => p.y) * b + half.y, shift.y, tanY), fit(-(placed.y + least(p => p.y) * b) + half.y, shift.y, tanY)));
  return { x: placed.x * f, y: placed.y * f, scale: placed.scale * f, boxHeight: b * f };
}
