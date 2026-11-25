import { readHeroFile, type HeroFile } from '../../src/figmaFrame';
import { bucket, hostingOrigin, storageOrigin } from './config';

// A public file in the bucket, in the URL form the embed page uses (publicUrl in src/embed.tsx).
export const publicUrl = (path: string) => `${storageOrigin}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;

// The hero id in a viewer link, or in an embed code, which holds one: the 20 characters after /embed/ on Depth's own
// Hosting site, not inside another link. null for anything else.
const link = new RegExp(`(?<![\\w.:/?=&%#~+@-])${hostingOrigin.replace(/[.]/g, '\\.')}/embed/([A-Za-z0-9]{20})(?![A-Za-z0-9])`);
export const heroIdFrom = (text: string) => link.exec(text)?.[1] ?? null;

// hero.json as it is now, not as a cache kept it. Unpublish deletes it, so a 403 or 404 means the hero has gone.
export async function loadHero(heroId: string): Promise<HeroFile> {
  let response: Response;
  try {
    response = await fetch(publicUrl(`public/heroes/${heroId}/hero.json`), { cache: 'no-store' });
  } catch {
    throw new Error('Can’t reach Depth. Check your connection and try again.');
  }
  if (response.status === 403 || response.status === 404) throw new Error('This hero isn’t published any more.');
  if (!response.ok) throw new Error('Can’t reach Depth. Check your connection and try again.');
  return readHeroFile(await response.json().catch(() => null));
}
