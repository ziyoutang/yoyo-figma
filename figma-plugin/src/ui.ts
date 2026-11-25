import { kindsOf, type FrameKind } from '../../src/figmaFrame';
import { heroIdFrom, loadHero, publicUrl } from './heroSource';
import { modelBox } from './images';
import type { Placement, ToCode, ToPanel } from './messages';

// The panel: it takes the hero's link, fetches hero.json and the posters, turns the WebP posters into PNGs (Figma's
// createImage refuses WebP, and only the panel has a canvas), and sends them to the plugin code to place.
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const link = element<HTMLTextAreaElement>('link'), placeButton = element<HTMLButtonElement>('place'), reason = element<HTMLParagraphElement>('reason');
const status = element<HTMLParagraphElement>('status'), notes = element<HTMLUListElement>('notes'), live = element<HTMLDivElement>('live'), liveLink = element<HTMLInputElement>('live-link');
let selection = { fillable: false, reason: '' }, busy = false;

const placement = () => document.querySelector<HTMLInputElement>('input[name=placement]:checked')!.value as Placement;
const send = (message: ToCode) => parent.postMessage({ pluginMessage: message }, '*');
function show(text: string, error = false, list: string[] = []) {
  status.textContent = text;
  status.className = error ? 'error' : '';
  notes.replaceChildren(...list.map(note => Object.assign(document.createElement('li'), { textContent: note })));
  notes.hidden = !list.length;
}
// Replace Selection waits for one frame or shape, and says why it can't place.
function refresh() {
  const replacing = placement() === 'Replace Selection';
  reason.hidden = !replacing || selection.fillable;
  reason.textContent = selection.reason;
  placeButton.disabled = busy || (replacing && !selection.fillable);
}

// A poster as PNG bytes, drawn at its own size; for Replace Selection, cropped to the model.
async function posterPng(heroId: string, file: string, crop: boolean) {
  const response = await fetch(publicUrl(`public/heroes/${heroId}/${file}`)).catch(() => null);
  if (response?.status === 403 || response?.status === 404) throw new Error('This hero isn’t published any more.');
  if (!response?.ok) throw new Error('Can’t reach Depth. Check your connection and try again.');
  const bitmap = await createImageBitmap(await response.blob());
  let canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [bitmap.width, bitmap.height];
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  if (crop) {
    const box = modelBox(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!box) throw new Error('The hero’s poster has no model in it.');
    const cropped = document.createElement('canvas');
    [cropped.width, cropped.height] = [box.width, box.height];
    cropped.getContext('2d')!.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    canvas = cropped;
  }
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('The poster couldn’t be turned into a PNG.');
  return new Uint8Array(await png.arrayBuffer());
}

async function place() {
  const heroId = heroIdFrom(link.value);
  if (!heroId) return show('Paste the hero’s link or embed code from Depth.', true);
  busy = true;
  refresh();
  show('Reading the hero…');
  live.hidden = true;
  try {
    const hero = await loadHero(heroId);
    if (placement() === 'New Frame') {
      if (!hero.layout) throw new Error('Update this hero on Depth’s Complete screen, then try again.');
      const pngs: Partial<Record<FrameKind, Uint8Array>> = {};
      for (const kind of kindsOf(hero.frame)) pngs[kind] = await posterPng(heroId, hero.posters[kind]!, false);
      show('Placing…');
      send({ type: 'place', heroId, hero, placement: 'New Frame', pngs });
    } else {
      // The desktop poster when there is one, for its resolution.
      const model = await posterPng(heroId, (hero.posters.desktop ?? hero.posters.mobile)!, true);
      show('Placing…');
      send({ type: 'place', heroId, hero, placement: 'Replace Selection', pngs: { model } });
    }
  } catch (error) {
    busy = false;
    refresh();
    show(error instanceof Error ? error.message : 'Placing didn’t finish. Try again.', true);
  }
}

window.onmessage = (event: MessageEvent) => {
  const message = event.data?.pluginMessage as ToPanel | undefined;
  if (message?.type === 'selection') selection = message;
  if (message?.type === 'placed') {
    busy = false;
    show(message.placement === 'New Frame' ? 'Placed. Every text stays editable; the Live hero link under each frame opens the moving hero.' : 'Filled the selection with the model.', false, message.notes);
    liveLink.value = message.link;
    live.hidden = false;
  }
  if (message?.type === 'failed') {
    busy = false;
    show(message.message, true);
  }
  refresh();
};
placeButton.onclick = place;
for (const input of document.querySelectorAll<HTMLInputElement>('input[name=placement]')) input.onchange = refresh;
liveLink.onfocus = () => liveLink.select();
element<HTMLButtonElement>('copy').onclick = () => {
  liveLink.select();
  // Figma's panel may not allow the async clipboard; the older command works there.
  navigator.clipboard?.writeText(liveLink.value).catch(() => document.execCommand('copy')) ?? document.execCommand('copy');
};
refresh();
