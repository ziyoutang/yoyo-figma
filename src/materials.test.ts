import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Texture } from 'three';
import { lookMaterial } from './materials';

const look = { material: 'Original', color: '#117799', secondColor: '#fcffbc', textured: false };
function textured() { return new MeshStandardMaterial({ color: '#ffffff', map: new Texture(), normalMap: new Texture(), roughness: .5 }); }

describe('lookMaterial', () => {
  it('keeps clay for an untextured model and the GLB material for a textured one in Original', () => {
    const clay = lookMaterial(new MeshStandardMaterial(), look) as MeshStandardMaterial;
    expect(clay).toBeInstanceOf(MeshStandardMaterial);
    expect(clay).toMatchObject({ roughness: .85, metalness: 0 });
    expect(clay.color.getHexString()).toBe('e7e1d8');
    expect(clay.emissive.getHex()).toBe(0);
    expect(lookMaterial(textured(), { ...look, textured: true })).toBeNull();
    expect(lookMaterial(textured(), { ...look, textured: true, secondColor: '#FCFFBC' })).toBeNull();
  });

  it.each([
    ['Metallic', MeshStandardMaterial, { metalness: 1, roughness: .25 }],
    ['Rough Matte', MeshStandardMaterial, { metalness: 0, roughness: 1 }],
    // Transmission can't show the page behind the canvas, so Transparent fades with opacity instead.
    ['Transparent', MeshStandardMaterial, { transparent: true, opacity: .45, metalness: 0, roughness: .15 }],
  ])('paints %s in the primary colour and keeps the normal map', (material, type, values) => {
    const original = textured();
    const next = lookMaterial(original, { ...look, material, textured: true }) as MeshStandardMaterial;
    expect(next.constructor).toBe(type);
    expect(next).toMatchObject(values);
    expect(next.color.getHexString()).toBe('117799');
    expect(next.normalMap).toBe(original.normalMap);
    expect(next.map).toBeNull();
    expect(original).toMatchObject({ roughness: .5, metalness: 0 });
    expect(original.color.getHexString()).toBe('ffffff');
    expect(lookMaterial(new MeshStandardMaterial(), { ...look, material })).toMatchObject({ normalMap: null, ...values });
  });

  it('lets a lighting studio soften a preset’s roughness, but not the clay’s', () => {
    expect(lookMaterial(new MeshStandardMaterial(), { ...look, material: 'Metallic', roughness: .5 })).toMatchObject({ metalness: 1, roughness: .5 });
    expect(lookMaterial(new MeshStandardMaterial(), { ...look, roughness: .5 })).toMatchObject({ metalness: 0, roughness: .85 });
  });

  it('adds a faint glow for a non-default second colour without touching the GLB material', () => {
    const original = textured();
    const glowing = lookMaterial(original, { ...look, textured: true, secondColor: '#ff0000' }) as MeshStandardMaterial;
    expect(glowing).not.toBe(original);
    expect(glowing.map).toBe(original.map);
    expect(glowing.emissive.getHexString()).toBe('ff0000');
    expect(glowing.emissiveIntensity).toBe(.15);
    expect(original.emissive.getHex()).toBe(0);
    expect((lookMaterial(original, { ...look, material: 'Metallic', secondColor: '#ff0000' }) as MeshStandardMaterial).emissive.getHexString()).toBe('ff0000');
    expect((lookMaterial(original, { ...look, secondColor: '#ff0000' }) as MeshStandardMaterial).emissiveIntensity).toBe(.15);
  });
});
