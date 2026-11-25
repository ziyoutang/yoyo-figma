import { Color, MeshStandardMaterial, type Material } from 'three';

// `roughness` overrides the preset's, for a lighting studio that needs softer reflections (see scene.ts).
export type Look = {material: string; color: string; secondColor: string; textured: boolean; roughness?: number};
// Transparent fades with opacity: transmission would only show the empty WebGL scene, not the page behind the canvas.
const presets: Record<string, {metalness: number; roughness: number; transparent?: boolean; opacity?: number}> = { Metallic: { metalness: 1, roughness: .25 }, 'Rough Matte': { metalness: 0, roughness: 1 }, Transparent: { metalness: 0, roughness: .15, transparent: true, opacity: .45 } };

// The material a mesh shows for a look, or null when it keeps its own GLB material. `original` is never changed.
export function lookMaterial(original: Material, { material, color, secondColor, textured, roughness }: Look): Material | null {
  const preset = presets[material], glow = secondColor.toLowerCase() !== '#fcffbc';
  if (!preset && textured && !glow) return null;
  const { normalMap, normalScale } = original as MeshStandardMaterial;
  const params = { color, ...preset, ...(roughness !== undefined && { roughness }), ...(normalMap && { normalMap, normalScale: normalScale.clone() }) };
  const next = preset ? new MeshStandardMaterial(params) : textured ? original.clone() : new MeshStandardMaterial({ color: '#e7e1d8', roughness: .85, metalness: 0 });
  if (glow) Object.assign(next, { emissive: new Color(secondColor), emissiveIntensity: .15 });
  return next;
}
