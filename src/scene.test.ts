import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { initialDraft } from './model';
import { cameraAt, DISTANCE, fitInBox, FOV, keepInside, motionTime, pose, REST_TURN, sceneFromDraft, type Box, type CameraMove, type Motion, type Placement, type Pointer } from './scene';

const draft = { ...initialDraft, modelPath: 'models/u/shape/model.glb' };
const viewHeight = 2 * DISTANCE * Math.tan(FOV * Math.PI / 360);

describe('sceneFromDraft', () => {
  it('shows the look when there is one, otherwise the clay shape', () => {
    expect(sceneFromDraft(draft)).toMatchObject({ modelPath: 'models/u/shape/model.glb', look: { material: 'Original', textured: false } });
    const textured = sceneFromDraft({ ...draft, lookModelPath: 'models/u/look/model.glb', material: 'Metallic', color: '#123456', secondColor: '#ff0000' });
    expect(textured).toMatchObject({ modelPath: 'models/u/look/model.glb', look: { material: 'Metallic', color: '#123456', secondColor: '#ff0000', textured: true } });
  });

  it('maps the motion controls, with speed setting the time for one swing', () => {
    expect(sceneFromDraft({ ...draft, motion: 'Sway', speed: 2, amount: 50, direction: 'Reverse' })).toMatchObject({ motion: 'Sway', period: 2, amount: .5, reverse: true, animate: true });
    expect(sceneFromDraft(draft)).toMatchObject({ motion: 'Still', period: 5, amount: .42, reverse: false, animate: false });
  });

  it('holds still when paused or when reduced motion is on', () => {
    const moving = { ...draft, motion: 'Float', camera: 'Push-in' };
    expect(sceneFromDraft(moving, { playing: false })).toMatchObject({ motion: 'Still', camera: 'Static', animate: false });
    expect(sceneFromDraft(moving, { reducedMotion: true })).toMatchObject({ motion: 'Still', camera: 'Static', animate: false });
    // Cursor Follow redraws on pointer moves, so a still model with it draws nothing between them.
    expect(sceneFromDraft({ ...draft, camera: 'Cursor Follow' })).toMatchObject({ camera: 'Cursor Follow', animate: false });
    expect(sceneFromDraft({ ...draft, camera: 'Push-out' })).toMatchObject({ camera: 'Push-out', animate: false });
  });

  it('keeps the chosen motion and camera as the room to leave, even while paused', () => {
    const moving = { ...draft, motion: 'Slide', camera: 'Push-in' };
    expect(sceneFromDraft(moving, { playing: false })).toMatchObject({ motion: 'Still', camera: 'Static', roomFor: { motion: 'Slide', camera: 'Push-in' } });
    expect(sceneFromDraft(moving, { reducedMotion: true }).roomFor).toEqual({ motion: 'Slide', camera: 'Push-in' });
  });

  it('picks a studio for each lighting preset, tinted by the lighting colour', () => {
    const soft = sceneFromDraft(draft).lighting, bright = sceneFromDraft({ ...draft, lighting: 'Bright' }).lighting, dramatic = sceneFromDraft({ ...draft, lighting: 'Dramatic', lightingColor: '#ff8800' }).lighting;
    expect([soft.hdri, bright.hdri, dramatic.hdri]).toEqual(['/hdri/soft.hdr', '/hdri/bright.hdr', '/hdri/dramatic.hdr']);
    expect(bright.environment).toBeGreaterThan(soft.environment);
    expect(dramatic.environment).toBeLessThan(soft.environment);
    expect(dramatic.key).toBeGreaterThan(bright.key);
    expect([soft.keyColor, dramatic.keyColor]).toEqual(['#ffffff', '#ff8800']);
    expect(sceneFromDraft({ ...draft, lighting: 'Unknown' }).lighting.hdri).toBe('/hdri/soft.hdr');
  });

  it('gives Metallic a brighter, softer reflection under Dramatic and changes nothing else', () => {
    const at = (material: string, lighting: string) => sceneFromDraft({ ...draft, material, lighting });
    expect(at('Metallic', 'Dramatic')).toMatchObject({ look: { material: 'Metallic', roughness: .5 }, lighting: { hdri: '/hdri/dramatic.hdr', environment: 1.2, key: 2.5 } });
    const environments: Record<string, number> = { Soft: .8, Bright: 1.3, Dramatic: .7 };
    for (const lighting of Object.keys(environments)) for (const material of ['Original', 'Metallic', 'Rough Matte', 'Transparent']) {
      if (material === 'Metallic' && lighting === 'Dramatic') continue;
      const scene = at(material, lighting);
      expect(scene.look).not.toHaveProperty('roughness');
      expect(scene.lighting).toEqual({ hdri: `/hdri/${lighting.toLowerCase()}.hdr`, environment: environments[lighting], key: scene.lighting.key, keyColor: '#ffffff' });
    }
  });
});

describe('fitInBox', () => {
  it('centres a model that fills the whole hero', () => {
    expect(fitInBox({ x: 0, y: 0, w: 1, h: 1 }, 2, { w: 1, h: 1 })).toEqual({ x: 0, y: 0, scale: viewHeight, boxHeight: viewHeight });
  });

  it('puts the model where the ear box was, fitting its height and letting wide models spread to 1.4× the box width', () => {
    const placed = fitInBox({ x: .68, y: .26, w: .2, h: .52 }, 722 / 419, { w: 1, h: 2 });
    expect(placed.x).toBeCloseTo((.78 - .5) * viewHeight * 722 / 419);
    expect(placed.y).toBeCloseTo(-.02 * viewHeight);
    expect(placed.scale).toBeCloseTo(.26 * viewHeight);
    const wide = fitInBox({ x: .68, y: .26, w: .2, h: .52 }, 722 / 419, { w: 4, h: 1 });
    expect(wide.scale).toBeCloseTo(.2 * 1.4 / 4 * viewHeight * 722 / 419);
  });
});

describe('keepInside', () => {
  // The farthest a corner of the model's box gets from the view's centre, as a fraction of the half-width or half-height,
  // placed and moved exactly as Hero3D does it.
  function reach(placed: Placement, scene: {motion: Motion; camera: CameraMove; amount: number}, aspect: number, extent: {x: number; y: number; z: number}, seconds: number, pointer: Pointer) {
    const p = pose({ ...scene, period: 2, reverse: false }, seconds, pointer), view = cameraAt(scene.camera, seconds, pointer);
    const tan = Math.tan(FOV * Math.PI / 360);
    let most = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const v = new Vector3(sx * extent.x / 2, sy * extent.y / 2, sz * extent.z / 2).applyEuler(new Euler(p.tilt, REST_TURN + p.turn, 0))
        .multiplyScalar(placed.scale * p.scale).add(new Vector3(placed.x + p.x * placed.boxHeight, placed.y + p.y * placed.boxHeight, 0));
      const depth = view.distance - v.z;
      most = Math.max(most, Math.abs(v.x - view.x) / (depth * tan * aspect), Math.abs(v.y - view.y) / (depth * tan));
    }
    return most;
  }
  // Object Right on Motion and Scene, Object Right on Complete, Mobile 3D only and Desktop 3D only.
  const boxes: [Box, number][] = [[{ x: .707, y: .17, w: .22, h: .56 }, 799 / 482], [{ x: .68, y: .26, w: .2, h: .52 }, 722 / 419], [{ x: .15, y: .2, w: .7, h: .55 }, 390 / 844], [{ x: .37, y: .12, w: .26, h: .75 }, 1440 / 900]];
  const shapes = [{ x: 1.6, y: 1, z: 1 }, { x: .6, y: 2, z: .6 }, { x: 1, y: 1, z: 1 }];
  const motions: Motion[] = ['Still', 'Float', 'Hover Pop', 'Slide', 'Sway', 'Cursor Tilt'], cameras: CameraMove[] = ['Static', 'Push-in', 'Cursor Follow', 'Push-out'];
  const pointers = [{ x: 0, y: 0 }, { x: -.5, y: -.5 }, { x: .5, y: .5 }, { x: -.5, y: .5 }, { x: .5, y: -.5 }];

  it('keeps the model inside the hero at every motion, camera and amount', () => {
    for (const [box, aspect] of boxes) for (const extent of shapes) for (const motion of motions) for (const camera of cameras) for (const amount of [.42, 1]) {
      const scene = { motion, camera, amount };
      const placed = keepInside(fitInBox(box, aspect, { w: extent.x * Math.abs(Math.cos(REST_TURN)) + extent.z * Math.abs(Math.sin(REST_TURN)), h: extent.y }), scene, aspect, extent);
      for (const seconds of [0, .5, 1, 1.5, 2, 3]) for (const pointer of pointers) {
        expect(reach(placed, scene, aspect, extent, seconds, pointer), `${motion} ${camera} ${amount} ${JSON.stringify(box)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('changes nothing when the model already has room, and shrinks it toward the centre only when it would leave', () => {
    const [box, aspect] = boxes[1], extent = shapes[0], size = { w: extent.x * Math.abs(Math.cos(REST_TURN)) + extent.z * Math.abs(Math.sin(REST_TURN)), h: extent.y };
    const placed = fitInBox(box, aspect, size);
    expect(keepInside(placed, { motion: 'Still', camera: 'Static', amount: .42 }, aspect, extent)).toEqual(placed);
    // Mobile 3D only lets a wide model fill almost the whole width; Push-in needs a smaller one, shrunk toward the centre.
    const [mobile, tall] = boxes[2], wide = fitInBox(mobile, tall, size);
    const still = keepInside(wide, { motion: 'Still', camera: 'Static', amount: .42 }, tall, extent);
    const pushed = keepInside(wide, { motion: 'Still', camera: 'Push-in', amount: .42 }, tall, extent);
    expect(pushed.scale).toBeLessThan(still.scale);
    expect(pushed.scale / wide.scale).toBeCloseTo(pushed.y / wide.y);
  });
});

describe('pose', () => {
  const motion = (kind: string, amount = 1, reverse = false) => ({ motion: kind, period: 2, amount, reverse }) as Parameters<typeof pose>[0];

  it('rests at the start of each swing and peaks after one period', () => {
    expect(pose(motion('Still'), 1)).toEqual({ x: 0, y: 0, turn: 0, tilt: 0, scale: 1 });
    expect(pose(motion('Float'), 0).y).toBeCloseTo(0);
    expect(pose(motion('Float'), 2).y).toBeCloseTo(.15);
    expect(pose(motion('Float', .5), 2).y).toBeCloseTo(.075);
    expect(pose(motion('Float', 1, true), 0).y).toBeCloseTo(.15);
    expect(pose(motion('Slide'), 2).x).toBeCloseTo(.25);
    expect(pose(motion('Hover Pop'), 2).scale).toBeCloseTo(1.15);
  });

  it('turns the model in 3D for Sway and toward the pointer for Cursor Tilt', () => {
    expect(pose(motion('Sway'), 0).turn).toBeCloseTo(-.6);
    expect(pose(motion('Sway'), 2).turn).toBeCloseTo(.6);
    expect(pose(motion('Cursor Tilt'), 0, { x: .5, y: -.5 })).toMatchObject({ turn: .4, tilt: -.2 });
  });
});

describe('cameraAt', () => {
  it('eases Push-in and Push-out once, then holds', () => {
    expect(cameraAt('Push-in', 0).distance).toBeCloseTo(DISTANCE);
    expect(cameraAt('Push-in', 1.5).distance).toBeCloseTo(DISTANCE / 1.15);
    expect(cameraAt('Push-in', 10).distance).toBeCloseTo(DISTANCE / 1.15);
    expect(cameraAt('Push-out', 10).distance).toBeCloseTo(DISTANCE / .8);
    expect(cameraAt('Static', 10)).toEqual({ distance: DISTANCE, x: 0, y: 0 });
  });

  it('leans toward the pointer for Cursor Follow', () => {
    const lean = cameraAt('Cursor Follow', 0, { x: .5, y: .5 });
    expect(lean.distance).toBe(DISTANCE);
    expect(lean.x).toBeLessThan(0);
    expect(lean.y).toBeGreaterThan(0);
  });
});

describe('motionTime', () => {
  it('starts at 0 on the first placed frame, adds each delta while moving, and holds while paused or still', () => {
    // However long the model took to load, motion starts from its rest.
    let time = motionTime(null, 7.5, true);
    expect(time).toBe(0);
    time = motionTime(motionTime(time, .25, true), .5, true);
    expect(time).toBe(.75);
    expect(motionTime(time, 3, false)).toBe(.75);
    expect(motionTime(motionTime(time, 3, false), .25, true)).toBe(1);
  });
});
