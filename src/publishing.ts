import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebaseServices } from './firebase';
import type { FigmaLayout } from './figmaLayout';
import { uploadImage } from './jobs';
import type { Draft } from './model';
import type { Snapshot } from './publish';

// Studio only: the publish callables, the poster uploads and the user's live heroes. The embed page never loads this.
export type LiveHero = {heroId: string; headline: string; frame: Draft['frame']; publishedAt: Date | null};

function services() {
  if (!firebaseServices) throw new Error('Firebase is not configured.');
  return firebaseServices;
}

// The public viewer, on the project's Hosting site.
export const viewerUrl = (heroId: string) => `https://${import.meta.env.VITE_FIREBASE_PROJECT_ID}.web.app/embed/${heroId}`;

// Uploads the posters (single-use; publishHero deletes them), then publishes with the Figma layout. Returns the hero's id.
// publishHero takes only poster- uploads, and sweepJobs deletes the ones a failed call leaves behind.
export async function publishHero({ heroId, modelPath, snapshot, posters, layout }: {heroId: string; modelPath: string; snapshot: Snapshot; posters: Partial<Record<'desktop' | 'mobile', Blob>>; layout: FigmaLayout}) {
  const uploaded = Object.fromEntries(await Promise.all(Object.entries(posters).map(async ([kind, poster]) => [kind, await uploadImage(poster, 'poster-')])));
  const { data } = await httpsCallable<object, {heroId: string}>(services().functions, 'publishHero')({ ...(heroId && { heroId }), modelPath, snapshot, posters: uploaded, layout });
  return data.heroId;
}

export async function unpublishHero(heroId: string) {
  await httpsCallable(services().functions, 'unpublishHero')({ heroId });
}

// The user's live heroes, newest first. It filters on owner and status only, so it needs no composite index.
export function watchLiveHeroes(on: (heroes: LiveHero[]) => void) {
  const { auth, db } = services(), uid = auth.currentUser?.uid;
  if (!uid) return () => {};
  return onSnapshot(query(collection(db, 'heroes'), where('owner', '==', uid), where('status', '==', 'published')), snapshot => {
    const heroes = snapshot.docs.map(hero => ({ heroId: hero.id, headline: String(hero.get('snapshot.headline') ?? ''), frame: hero.get('snapshot.frame'), publishedAt: hero.get('publishedAt')?.toDate?.() ?? null }));
    on(heroes.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)));
  }, () => on([]));
}

export function publishMessage(error: unknown, action = 'Publishing') {
  const { code = '', message = '', details } = (error || {}) as {code?: string; message?: string; details?: {cap?: string}};
  const short = code.replace(/^functions\//, '');
  if (short === 'resource-exhausted') return details?.cap === 'daily' ? 'You’ve published 20 times today. Try again after midnight UTC.' : 'You have 10 published heroes. Unpublish one to publish another.';
  if (short === 'aborted') return 'This hero is already publishing. Try again in a minute.';
  if (short === 'unauthenticated') return 'Reload the page and try again.';
  if (short === 'invalid-argument' && message) return message;
  return `${action} didn’t finish. Check your connection and try again.`;
}
