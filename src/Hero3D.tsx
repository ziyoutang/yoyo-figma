import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import { Box3, Vector2, Vector3, type Group, type Material, type Mesh } from 'three';
import type { Capture3D } from './exportHero';
import { lookMaterial, type Look } from './materials';
import { cameraAt, DISTANCE, fitInBox, FOV, keepInside, motionTime, pose, PUSH_SECONDS, REST_TURN, type Box, type Pointer, type Scene } from './scene';

// `paused` stops drawing (the motion holds); `onFirstFrame` runs once the placed model has drawn.
export type Hero3DProps = {url: string; scene: Scene; box: Box | null; ghosts: Box[]; faded: boolean; pointer: {current: Pointer}; capture?: {current: Capture3D | null}; paused?: boolean; onFirstFrame?: () => void};

// Lets the PNG export render this scene at full size: resize, draw, copy, then restore, all in one task.
function Capture({ capture }: {capture?: {current: Capture3D | null}}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (!capture) return;
    capture.current = (width, height) => {
      const size = gl.getSize(new Vector2()), ratio = gl.getPixelRatio();
      gl.setPixelRatio(1); gl.setSize(width, height, false); gl.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      out.getContext('2d')!.drawImage(gl.domElement, 0, 0);
      gl.setPixelRatio(ratio); gl.setSize(size.x, size.y, false); gl.render(scene, camera);
      return out;
    };
    return () => { capture.current = null; };
  }, [capture, gl, scene, camera]);
  return null;
}

// A centred clone of the cached GLB wearing the look; ghosts get faded copies. Materials made here are disposed.
function useModel(url: string, look: Look, opacity = 1) {
  const { scene } = useGLTF(url, false, true); // No Draco (CDN decoder); meshopt decodes locally.
  const { model, meshes, size, extent } = useMemo(() => {
    const model = scene.clone(), meshes: [Mesh, Material][] = [];
    model.traverse(object => { if ((object as Mesh).isMesh) meshes.push([object as Mesh, (object as Mesh).material as Material]); });
    const bounds = new Box3().setFromObject(model), extent = bounds.getSize(new Vector3());
    model.position.sub(bounds.getCenter(new Vector3()));
    // The width the camera sees at the resting three-quarter turn.
    return { model, meshes, extent: { x: extent.x, y: extent.y, z: extent.z }, size: { w: extent.x * Math.abs(Math.cos(REST_TURN)) + extent.z * Math.abs(Math.sin(REST_TURN)), h: extent.y } };
  }, [scene]);
  useLayoutEffect(() => {
    const made = meshes.map(([mesh, own]) => {
      const next = opacity < 1 ? Object.assign(lookMaterial(own, look) ?? own.clone(), { transparent: true, opacity, depthWrite: false }) : lookMaterial(own, look);
      mesh.material = next ?? own;
      return next;
    });
    return () => made.forEach(material => material?.dispose());
  }, [meshes, look.material, look.color, look.secondColor, look.textured, look.roughness, opacity]);
  return { model, size, extent };
}

function Ghost({ url, look, box, aspect, opacity }: {url: string; look: Look; box: Box; aspect: number; opacity: number}) {
  const { model, size } = useModel(url, look, opacity);
  const placed = fitInBox(box, aspect, size);
  return <group position={[placed.x, placed.y, 0]} scale={placed.scale} rotation={[0, REST_TURN, 0]}><primitive object={model} /></group>;
}

function Hero({ url, scene, box, ghosts, faded, pointer, onFirstFrame }: Omit<Hero3DProps, 'capture' | 'paused'>) {
  const { size: canvas, camera, invalidate } = useThree();
  const aspect = canvas.width / canvas.height || 1;
  const { model, size, extent } = useModel(url, scene.look);
  // The model's box, shrunk if the chosen motion or camera would carry it past the hero's edge.
  const placed = box && keepInside(fitInBox(box, aspect, size), { ...scene.roomFor, amount: scene.amount }, aspect, extent);
  const outer = useRef<Group>(null), inner = useRef<Group>(null);
  // Motion time, not r3f's clock: the clock runs while the model loads and restarts at 0 whenever the frame loop changes.
  const time = useRef<number | null>(null), cameraStart = useRef(-1), drawn = useRef(false);
  // Push-in and Push-out replay whenever the camera choice changes.
  useLayoutEffect(() => { cameraStart.current = -1; }, [scene.camera]);
  // Redraw on any change; a still hero renders only then.
  useEffect(() => { invalidate(); });
  // Priority -1 poses the model before ContactShadows draws its shadow in the same frame; a still hero draws only
  // one frame per change, so a later pose would leave the shadow where the model was.
  useFrame((_, delta) => {
    if (!placed || !outer.current || !inner.current) return;
    const pushing = scene.camera.startsWith('Push') && (cameraStart.current < 0 || time.current! - cameraStart.current < PUSH_SECONDS);
    const seconds = time.current = motionTime(time.current, delta, scene.animate || pushing);
    if (cameraStart.current < 0) cameraStart.current = seconds;
    const p = pose(scene, seconds, pointer.current);    outer.current.position.set(placed.x + p.x * placed.boxHeight, placed.y + p.y * placed.boxHeight, 0);
    outer.current.scale.setScalar(placed.scale * p.scale);
    inner.current.rotation.set(p.tilt, REST_TURN + p.turn, 0);
    const view = cameraAt(scene.camera, seconds - cameraStart.current, pointer.current);
    camera.position.set(view.x, view.y, view.distance);
    if (seconds - cameraStart.current < PUSH_SECONDS && scene.camera.startsWith('Push')) invalidate();
    if (!drawn.current) { drawn.current = true; onFirstFrame?.(); }
  }, -1);
  if (!placed) return null;
  return <>
    <group ref={outer}><group ref={inner}><primitive object={model} /></group></group>
    <ContactShadows position={[placed.x, placed.y - size.h * placed.scale / 2 - .02, 0]} scale={size.w * placed.scale * 1.8} far={size.h * placed.scale} blur={2.5} opacity={.35} resolution={256} />
    {ghosts.map((ghost, i) => <Ghost key={i} url={url} look={scene.look} box={ghost} aspect={aspect} opacity={faded ? .12 : .4} />)}
  </>;
}

export default function Hero3D(props: Hero3DProps) {
  const { lighting } = props.scene;
  // offsetSize measures layout size: the studio's CSS zoom would otherwise shrink the canvas inside the hero.
  return <Canvas camera={{ position: [0, 0, DISTANCE], fov: FOV }} dpr={[1, 2]} resize={{ offsetSize: true }} frameloop={props.paused ? 'never' : props.scene.animate ? 'always' : 'demand'}>
    <directionalLight position={[3, 5, 4]} intensity={lighting.key} color={lighting.keyColor} />
    {/* The preset's self-hosted studio HDRI lights the model and gives metal and gloss something to reflect. */}
    <Suspense fallback={null}>
      <Environment files={lighting.hdri} environmentIntensity={lighting.environment} />
      <Hero {...props} />
    </Suspense>
    <Capture capture={props.capture} />
  </Canvas>;
}
