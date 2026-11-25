import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroPreview } from './HeroPreview';
import type { Draft } from './model';
import { draftFromPublished, type PublishedHero } from './publish';
import './styles.css';
import './embed.css';

// The public /embed/{heroId} page. It loads no Firebase SDK, App Check or sign-in: published files are public in Storage,
// so a plain fetch reads them. The build fails if this page reaches the studio's modules (embedGuard in vite.config.ts).
const bucket = `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`;
export const publicUrl = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;

type Hero = {draft: Draft; posters: PublishedHero['posters']};

// Any response that isn't a readable hero.json, including a 404 after Unpublish and a 403 during the emergency stop, is unavailable.
async function loadHero(heroId: string): Promise<Hero | null> {
  try {
    const response = await fetch(publicUrl(`public/heroes/${heroId}/hero.json`));
    if (!response.ok) return null;
    const hero = await response.json();
    return { draft: draftFromPublished(heroId, hero), posters: hero.posters ?? {} };
  } catch {
    return null;
  }
}

function useMatches(query: string) {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setMatches(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return matches;
}

export function Embed({ path }: {path: string}) {
  const heroId = /^\/embed\/([A-Za-z0-9]{20})\/?$/.exec(path)?.[1];
  const [hero, setHero] = useState<Hero | null | 'unavailable'>(heroId ? null : 'unavailable');
  // The embed code makes the frame portrait at 600 px wide and below, so a hero made for Both follows the frame's shape.
  const portrait = useMatches('(orientation: portrait)');
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (heroId) loadHero(heroId).then(loaded => setHero(loaded ?? 'unavailable'));
  }, [heroId]);
  // Stops drawing while the hero is scrolled out of the host page's view.
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [hero]);
  useEffect(() => {
    if (hero && hero !== 'unavailable') document.title = hero.draft.headline.trim().split(/\s*\n\s*/).join(' ');
  }, [hero]);
  if (hero === 'unavailable') return <p className="embed-unavailable">This hero isn’t available</p>;
  if (!hero) return null;
  const { draft, posters } = hero, mobile = draft.frame === 'Mobile' || (draft.frame === 'Both' && portrait);
  const poster = posters[mobile ? 'mobile' : 'desktop'];
  // The Complete screen's nesting, so its text and layout rules apply unchanged.
  return <div ref={root} className="embed step-complete">
    <div className={`preview-wrap ${mobile ? 'mobile-frame' : ''}`}>
      <HeroPreview draft={draft} modelUrl={publicUrl(draft.lookModelPath || draft.modelPath)} poster={poster ? publicUrl(`public/heroes/${heroId}/${poster}`) : ''} paused={!visible} linked/>
    </div>
  </div>;
}

const element = document.getElementById('root');
if (element) createRoot(element).render(<StrictMode><Embed path={location.pathname}/></StrictMode>);
