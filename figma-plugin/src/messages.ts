import type { HeroFile } from '../../src/figmaFrame';

// What the panel and the plugin code say to each other. Types only, so both builds can share it.
export type Placement = 'New Frame' | 'Replace Selection';
// The panel fetches everything; the plugin code makes no requests. `pngs` are the posters as PNG bytes, by frame kind,
// or the model alone, cropped, for Replace Selection.
export type PlaceMessage = {type: 'place'; heroId: string; hero: HeroFile; placement: 'New Frame'; pngs: {desktop?: Uint8Array; mobile?: Uint8Array}}
  | {type: 'place'; heroId: string; hero: HeroFile; placement: 'Replace Selection'; pngs: {model: Uint8Array}};
export type ToCode = PlaceMessage;
// `selection` says whether Replace Selection can fill the selection, and if not, why.
export type ToPanel = {type: 'selection'; fillable: boolean; reason: string}
  | {type: 'placed'; placement: Placement; notes: string[]; link: string}
  | {type: 'failed'; message: string};
