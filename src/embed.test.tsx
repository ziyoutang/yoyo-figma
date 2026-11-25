// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialDraft } from './model';
import { snapshotFromDraft, type PublishedHero } from './publish';

vi.mock('./Hero3D', () => ({ default: ({ url, scene }: { url: string; scene: { motion: string } }) => {
  if (url.includes('broken')) throw new Error('WebGL unavailable');
  return <div data-testid="hero3d" data-url={url} data-motion={scene.motion}/>;
} }));

import { Embed, publicUrl } from './embed';

const heroId = 'abcdefghij0123456789';
const media = { portrait: false, reduced: false, listeners: [] as (() => void)[] };
const hero = (patch: object = {}, textured = true): PublishedHero => ({
  version: 2, model: 'v2/model.glb', posters: { desktop: 'v2/poster-desktop.webp', mobile: 'v2/poster-mobile.webp' },
  snapshot: { ...snapshotFromDraft({ ...initialDraft, motion: 'Float', headline: 'Design that\nmoves you.', buttonLabel: 'Shop', buttonUrl: 'https://example.test/shop', ...patch }), textured },
});
const respond = (body: unknown, status = 200) => vi.mocked(fetch).mockImplementation(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
async function open(path = `/embed/${heroId}`) {
  render(<Embed path={path}/>);
  await act(async () => { await vi.dynamicImportSettled(); });
}
const images = () => [...document.querySelectorAll('img')].map(image => image.getAttribute('src'));
const unavailable = () => screen.queryByText('This hero isn’t available');

beforeEach(() => {
  Object.assign(media, { portrait: false, reduced: false, listeners: [] });
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(orientation: portrait)' ? media.portrait : query === '(prefers-reduced-motion: reduce)' && media.reduced; },
    addEventListener: (_type: string, listener: () => void) => media.listeners.push(listener), removeEventListener: () => {},
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the embed page', () => {
  it('reads hero.json straight from public Storage, with no token', async () => {
    respond(hero());
    await open();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(publicUrl(`public/heroes/${heroId}/hero.json`));
    expect(publicUrl(`public/heroes/${heroId}/hero.json`)).toMatch(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/public%2Fheroes%2Fabcdefghij0123456789%2Fhero\.json\?alt=media$/);
    expect(screen.getByTestId('hero3d').dataset.url).toBe(publicUrl(`public/heroes/${heroId}/v2/model.glb`));
    expect(document.title).toBe('Design that moves you.');
  });

  it('shows the unavailable message for a bad id, a 403, a 404 and a broken hero.json', async () => {
    await open('/embed/not-an-id');
    expect(unavailable()).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    for (const [body, status] of [['', 403], ['', 404], ['{not json', 200], [{ snapshot: 'x' }, 200]] as const) {
      cleanup();
      respond(body, status);
      await open();
      expect(unavailable(), `${status} ${JSON.stringify(body)}`).toBeTruthy();
      expect(images()).toEqual([]);
    }
  });

  it('shows the poster first, inside the Complete screen\'s nesting, and never the sample artwork', async () => {
    respond(hero());
    await open();
    expect(images()).toEqual([publicUrl(`public/heroes/${heroId}/v2/poster-desktop.webp`)]);
    expect(document.querySelector('.step-complete > .preview-wrap > .hero-preview')).toBeTruthy();
    expect(document.querySelector('.hero-canvas')!.classList.contains('waiting')).toBe(true);
  });

  it('keeps the poster when the model can\'t be shown, as without WebGL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    respond({ ...hero(), model: 'v2/broken.glb' });
    await open();
    expect(screen.queryByTestId('hero3d')).toBeNull();
    expect(images()).toEqual([publicUrl(`public/heroes/${heroId}/v2/poster-desktop.webp`)]);
  });

  it('holds the hero still under reduced motion', async () => {
    respond(hero());
    await open();
    expect(screen.getByTestId('hero3d').dataset.motion).toBe('Float');
    cleanup();
    media.reduced = true;
    await open();
    expect(screen.getByTestId('hero3d').dataset.motion).toBe('Still');
  });

  it('shows a hero made for Both as mobile while the frame is portrait, and desktop otherwise', async () => {
    respond(hero({ frame: 'Both' }));
    media.portrait = true;
    await open();
    expect(document.querySelector('.preview-wrap')!.classList.contains('mobile-frame')).toBe(true);
    expect(images()).toEqual([publicUrl(`public/heroes/${heroId}/v2/poster-mobile.webp`)]);
    media.portrait = false;
    act(() => media.listeners.forEach(listener => listener()));
    expect(document.querySelector('.preview-wrap')!.classList.contains('mobile-frame')).toBe(false);
    expect(images()).toEqual([publicUrl(`public/heroes/${heroId}/v2/poster-desktop.webp`)]);
  });

  it('keeps Desktop and Mobile heroes to their own design', async () => {
    respond(hero({ frame: 'Mobile' }));
    await open();
    expect(document.querySelector('.preview-wrap')!.classList.contains('mobile-frame')).toBe(true);
    cleanup();
    respond(hero({ frame: 'Desktop' }));
    media.portrait = true;
    await open();
    expect(document.querySelector('.preview-wrap')!.classList.contains('mobile-frame')).toBe(false);
  });

  it('makes the button a link that opens in the host page, and plain text without one', async () => {
    respond(hero());
    await open();
    expect(screen.getByRole('link', { name: 'Shop' }).getAttribute('target')).toBe('_top');
    cleanup();
    respond(hero({ buttonUrl: '' }));
    await open();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Shop')).toBeTruthy();
  });
});
