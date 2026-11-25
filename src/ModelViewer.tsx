import { Suspense, useLayoutEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Center, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import type { Material, Mesh } from 'three';
import { lookMaterial, type Look } from './materials';

function Model({ url, look }: {url: string; look: Look}) {
  const { scene } = useGLTF(url, false, true); // No Draco (CDN decoder); meshopt decodes locally.
  // The clone shares geometry and GLB materials with the cache; only the clone's meshes get new materials.
  const { model, meshes } = useMemo(() => { const meshes: [Mesh, Material][] = [], model = scene.clone(); model.traverse(object => { if ((object as Mesh).isMesh) meshes.push([object as Mesh, (object as Mesh).material as Material]); }); return { model, meshes }; }, [scene]);
  useLayoutEffect(() => {
    const made = meshes.map(([mesh, own]) => { const next = lookMaterial(own, look); mesh.material = next ?? own; return next; });
    return () => made.forEach(material => material?.dispose());
  }, [meshes, look.material, look.color, look.secondColor, look.textured]);
  return <primitive object={model} />;
}

export default function ModelViewer({ url, material = 'Original', color = '#9e8265', secondColor = '#fcffbc', textured = false }: {url: string; material?: string; color?: string; secondColor?: string; textured?: boolean}) {
  // offsetSize measures layout size: the studio's CSS zoom would otherwise push the model off-centre.
  return <Canvas className="gen-model-viewer" camera={{ position: [0, 0, 4], fov: 35 }} dpr={[1, 2]} resize={{ offsetSize: true }}>
    <hemisphereLight args={['#ffffff', '#8d8579', 1.4]} />
    <directionalLight position={[3, 5, 4]} intensity={2} />
    <directionalLight position={[-4, 1, -3]} intensity={.6} />
    {/* Reflections for metal and gloss, drawn from local light panels so nothing is downloaded. */}
    <Environment resolution={256}>
      <Lightformer intensity={2} rotation-x={Math.PI / 2} position={[0, 5, 0]} scale={[10, 10, 1]} />
      <Lightformer intensity={1.5} position={[0, 1, -6]} scale={[12, 4, 1]} />
      <Lightformer intensity={.8} position={[0, 1, 8]} scale={[10, 6, 1]} />
      <Lightformer intensity={1} rotation-y={Math.PI / 2} position={[-6, 1, 0]} scale={[8, 2, 1]} />
      <Lightformer intensity={1} rotation-y={-Math.PI / 2} position={[6, 1, 0]} scale={[8, 2, 1]} />
    </Environment>
    <Suspense fallback={null}><Bounds fit clip observe margin={1.2}><Center><Model url={url} look={{ material, color, secondColor, textured }} /></Center></Bounds></Suspense>
    <OrbitControls makeDefault />
  </Canvas>;
}
