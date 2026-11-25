import { afterEach, describe, expect, it, vi } from 'vitest';
import { layouts } from '../../src/figmaLayout.fixtures';
import { heroIdFrom, loadHero, publicUrl } from './heroSource';

const heroId = 'abcdefghij0123456789', viewer = `https://depth-plugin-demo-20261006.web.app/embed/${heroId}`;
const embedCode = `<div style="container-type:inline-size"><iframe class="depth-hero-${heroId}" src="${viewer}" title="Design that moves you." loading="lazy" style="display:block;width:100%;aspect-ratio:722/419;border:0"></iframe></div>`;

describe('heroIdFrom', () => {
  it('finds the id in a viewer link, an embed code and surrounding text', () => {
    for (const text of [viewer, `${viewer}/`, `${viewer}?utm=figma`, `  ${viewer}\n`, embedCode, `${embedCode}\n<style>@container (max-width:600px){.depth-hero-${heroId}{aspect-ratio:350/490!important}}</style>`, `Here it is: ${viewer}. Thanks!`, `(${viewer})`]) {
      expect(heroIdFrom(text), text).toBe(heroId);
    }
  });

  it('refuses other hosts\' links, ids of the wrong length and plain text', () => {
    for (const text of ['', 'Design that moves you.', heroId, `https://example.test/embed/${heroId}`, `https://depth-plugin-demo-20261006.web.app.example.test/embed/${heroId}`,
      `http://depth-plugin-demo-20261006.web.app/embed/${heroId}`, `https://example.test/?next=https://depth-plugin-demo-20261006.web.app/embed/${heroId}`,
      `${viewer.slice(0, -1)}`, `${viewer}0`, `https://depth-plugin-demo-20261006.web.app/complete/${heroId}`, `https://depth-plugin-demo-20261006.web.app/embed/abcdefghij012345678!`]) {
      expect(heroIdFrom(text), text).toBeNull();
    }
  });
});

describe('loadHero', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const file = { version: 2, model: 'v2/model.glb', posters: { desktop: 'v2/poster-desktop.webp' }, layout: { desktop: layouts.desktopObjectRight },
    snapshot: { frame: 'Desktop', eyebrow: 'Made with Meshy', headline: 'Design that\nmoves you.', subtitle: '', buttonLabel: 'Shop', buttonUrl: '', textured: true } };
  const respond = (status: number, body: unknown = file) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));

  it('reads hero.json fresh from the bucket, where the embed page reads it', async () => {
    respond(200);
    expect(await loadHero(heroId)).toMatchObject({ version: 2, frame: 'Desktop', headline: 'Design that\nmoves you.', layout: { desktop: layouts.desktopObjectRight } });
    expect(fetch).toHaveBeenCalledWith(`https://firebasestorage.googleapis.com/v0/b/depth-plugin-demo-20261006.firebasestorage.app/o/public%2Fheroes%2F${heroId}%2Fhero.json?alt=media`, { cache: 'no-store' });
    expect(publicUrl(`public/heroes/${heroId}/v2/poster-desktop.webp`)).toBe(`https://firebasestorage.googleapis.com/v0/b/depth-plugin-demo-20261006.firebasestorage.app/o/public%2Fheroes%2F${heroId}%2Fv2%2Fposter-desktop.webp?alt=media`);
  });

  it('says a hero that answers 403 or 404 isn\'t published any more', async () => {
    for (const status of [403, 404]) {
      respond(status, { error: { code: status } });
      await expect(loadHero(heroId)).rejects.toThrow('This hero isn’t published any more.');
    }
  });

  it('says it can\'t reach Depth when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(loadHero(heroId)).rejects.toThrow('Can’t reach Depth. Check your connection and try again.');
    respond(503, 'Service Unavailable');
    await expect(loadHero(heroId)).rejects.toThrow('Can’t reach Depth. Check your connection and try again.');
  });

  it('passes on readHeroFile\'s error for a file that isn\'t a hero', async () => {
    for (const body of ['not json', { ...file, snapshot: null }]) {
      respond(200, body);
      await expect(loadHero(heroId)).rejects.toThrow('This is not a published hero.');
    }
  });
});
