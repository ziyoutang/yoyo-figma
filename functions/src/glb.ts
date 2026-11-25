import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, textureCompress, weld } from '@gltf-transform/functions';

// Compresses geometry, and textures to WebP within 2048 px (never enlarged). Untextured GLBs skip the texture step.
export async function optimizeGlb(input: Uint8Array) {
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
  const { default: sharp } = await import('sharp');
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const document = await io.readBinary(input);
  await document.transform(dedup(), weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }), meshopt({ encoder: MeshoptEncoder }));
  return io.writeBinary(document);
}
