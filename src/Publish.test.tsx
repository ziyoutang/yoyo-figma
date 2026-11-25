// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  vi.stubEnv('VITE_JOB_PROVIDER', 'meshy');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'depth-test');
  return { publish: vi.fn(), unpublish: vi.fn(), upload: vi.fn(), layer: vi.fn(), measure: vi.fn(), live: null as null | ((snapshot: unknown) => void), query: [] as unknown[], loading: false };
});
vi.mock('./firebase', () => ({ firebaseServices: { auth: { currentUser: { uid: 'user-a' } }, db: {}, functions: {}, storage: {} }, signOutUser: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => name === 'publishHero' ? mocks.publish(data) : name === 'unpublishHero' ? mocks.unpublish(data) : Promise.reject(new Error(name)),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path, where: (...args: unknown[]) => args.join(' '), query: (...parts: unknown[]) => { mocks.query = parts; return parts; },
  doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: async () => ({ data: () => undefined }),
  onSnapshot: (_query: unknown, next: (snapshot: unknown) => void) => { mocks.live = next; return () => {}; },
}));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => path, uploadBytes: mocks.upload, getDownloadURL: async (path: string) => `https://example.test/${path}` }));
// The 3D layer reports its first frame, as Hero3D does once the model has drawn.
vi.mock('./Hero3D', async () => {
  const { useEffect } = await import('react');
  return { default: ({ onFirstFrame }: { onFirstFrame?: () => void }) => { useEffect(() => { if (!mocks.loading) onFirstFrame?.(); }, []); return <div data-testid="hero3d"/>; } };
});
vi.mock('./exportHero', () => ({ heroPng: vi.fn(), layerPng: mocks.layer }));
vi.mock('./measureLayout', () => ({ measureLayout: mocks.measure }));

import { Workflow } from './Workflow';
import { initialDraft, readDraft, storageKey, type Draft } from './model';
import { embedCode, publishedKey, snapshotFromDraft } from './publish';
import { layouts } from './figmaLayout.fixtures';

const heroId = 'abcdefghij0123456789', otherId = 'zyxwvutsrq9876543210';
const lookPath = 'models/user-a/look-1/model.glb';
const look: Partial<Draft> = { connected: true, shapeReady: true, lookReady: true, placed: true, modelPath: 'models/user-a/job-1/model.glb', modelJobId: 'job-1', lookModelPath: lookPath, headline: 'Design that\nmoves you.' };
function seed(patch: Partial<Draft> = {}) { localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, ...look, ...patch })); }
const saved = (): Draft => JSON.parse(localStorage.getItem(storageKey('user-a')) || '{}');
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
async function mount(route = '/complete') {
  render(<MemoryRouter initialEntries={[route]}><Workflow uid="user-a"/></MemoryRouter>);
  await screen.findAllByTestId('hero3d');
}
const record = (id: string, headline: string, frame: Draft['frame'], day: number) => ({ id, get: (field: string) => ({ 'snapshot.headline': headline, 'snapshot.frame': frame, publishedAt: { toDate: () => new Date(Date.UTC(2026, 10, day)) } } as Record<string, unknown>)[field] });
const emitLive = (...heroes: ReturnType<typeof record>[]) => act(() => mocks.live!({ docs: heroes }));
const notice = () => document.querySelector('.inline-notice')?.textContent ?? '';
const code = (id: string, frame: Draft['frame'], headline: string) => embedCode({ heroId: id, viewer: `https://depth-test.web.app/embed/${id}`, frame, headline });
const clipboard = (writeText = vi.fn().mockResolvedValue(undefined)) => { Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); return writeText; };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.live = null;
  mocks.loading = false;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('uuid-1' as never).mockReturnValueOnce('uuid-2' as never);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mocks.layer.mockImplementation(async (_node: unknown, width: number) => new Blob([String(width)], { type: 'image/png' }));
  // Each preview measures as the Complete screen draws it: the mobile one in .secondary-mobile or .mobile-frame.
  mocks.measure.mockImplementation((hero: Element) => hero.closest('.secondary-mobile, .mobile-frame') ? layouts.mobileObjectRight : layouts.desktopObjectRight);
  mocks.upload.mockResolvedValue({});
  mocks.publish.mockResolvedValue({ data: { heroId, version: 1, viewer: `https://depth-test.web.app/embed/${heroId}` } });
  mocks.unpublish.mockResolvedValue({ data: { heroId, status: 'unpublished' } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('publishing on Complete', () => {
  it('watches only this person\'s live heroes', async () => {
    seed();
    await mount();
    expect(mocks.query).toEqual(['heroes', 'owner == user-a', 'status == published']);
  });

  it('publishes the hero with its posters, saves the id without an undo entry, and shows the embed code', async () => {
    seed();
    await mount();
    emitLive();
    expect(screen.getByText('Anyone with the link can view this hero and download its 3D model.')).toBeTruthy();
    expect(screen.queryByText(/Live scene integration/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'About embed code' })).toBeNull();
    const draft = readDraft('user-a');
    click('Publish');
    expect(screen.getByText('Publishing…')).toBeTruthy();
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    expect(mocks.layer.mock.calls.map(call => call[1])).toEqual([2880]);
    expect(mocks.upload).toHaveBeenCalledWith('uploads/user-a/poster-uuid-1.png', expect.any(Blob), { contentType: 'image/png' });
    expect(mocks.publish).toHaveBeenCalledWith({ modelPath: lookPath, snapshot: snapshotFromDraft(draft), posters: { desktop: 'uploads/user-a/poster-uuid-1.png' }, layout: { desktop: layouts.desktopObjectRight } });
    await waitFor(() => expect(saved()).toMatchObject({ heroId, publishedKey: publishedKey(draft) }));
    emitLive(record(heroId, draft.headline, 'Desktop', 11));
    expect((screen.getByLabelText('Embed code') as HTMLTextAreaElement).value).toBe(code(heroId, 'Desktop', draft.headline));
    expect(screen.getByRole('link', { name: 'Open viewer' }).getAttribute('href')).toBe(`https://depth-test.web.app/embed/${heroId}`);
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update published hero' })).toBeNull();
  });

  it('waits for the 3D model to draw before it can publish', async () => {
    mocks.loading = true;
    seed();
    await mount();
    emitLive();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends both posters for a hero made for Both', async () => {
    seed({ frame: 'Both' });
    await mount();
    emitLive();
    click('Publish');
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    expect(mocks.layer.mock.calls.map(call => call[1])).toEqual([2880, 780]);
    expect(mocks.publish.mock.calls[0][0].posters).toEqual({ desktop: 'uploads/user-a/poster-uuid-1.png', mobile: 'uploads/user-a/poster-uuid-2.png' });
    expect(mocks.publish.mock.calls[0][0].layout).toEqual({ desktop: layouts.desktopObjectRight, mobile: layouts.mobileObjectRight });
    expect(mocks.measure.mock.calls.map(([hero]) => hero)).toEqual([...document.querySelectorAll('.hero-preview')]);
  });

  it('measures a Mobile hero\'s layout from its mobile preview', async () => {
    seed({ frame: 'Mobile' });
    await mount();
    emitLive();
    click('Publish');
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    expect(mocks.publish.mock.calls[0][0].layout).toEqual({ mobile: layouts.mobileObjectRight });
  });

  it('offers Update published hero once the hero has changed, and updates the same link', async () => {
    seed({ heroId, publishedKey: 'an older hero' });
    await mount();
    emitLive(record(heroId, 'Old headline', 'Desktop', 10));
    click('Update published hero');
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    expect(mocks.publish.mock.calls[0][0].heroId).toBe(heroId);
    await waitFor(() => expect(saved().publishedKey).toBe(publishedKey(readDraft('user-a'))));
  });

  it('unpublishes after a confirmation, then offers Publish again for the same link', async () => {
    seed();
    seed({ heroId, publishedKey: publishedKey(readDraft('user-a')) });
    await mount();
    emitLive(record(heroId, 'Design that\nmoves you.', 'Desktop', 11));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click('Unpublish');
    expect(mocks.unpublish).not.toHaveBeenCalled();
    click('Unpublish');
    expect(window.confirm).toHaveBeenLastCalledWith('Unpublish this hero? Websites that embed it will stop showing it within a minute.');
    await waitFor(() => expect(mocks.unpublish).toHaveBeenCalledWith({ heroId }));
    emitLive();
    click('Publish again');
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    expect(mocks.publish.mock.calls[0][0].heroId).toBe(heroId);
  });

  it('explains each refusal in plain words', async () => {
    seed();
    await mount();
    emitLive();
    for (const [error, message] of [
      [{ code: 'functions/resource-exhausted', details: { cap: 'live' } }, 'You have 10 published heroes. Unpublish one to publish another.'],
      [{ code: 'functions/resource-exhausted', details: { cap: 'daily' } }, 'You’ve published 20 times today. Try again after midnight UTC.'],
      [{ code: 'functions/aborted' }, 'This hero is already publishing. Try again in a minute.'],
      [{ code: 'functions/unauthenticated' }, 'Reload the page and try again.'],
      [{ code: 'functions/invalid-argument', message: 'buttonUrl must be a link that starts with https://.' }, 'buttonUrl must be a link that starts with https://.'],
      [{ code: 'functions/internal', message: 'INTERNAL' }, 'Publishing didn’t finish. Check your connection and try again.'],
    ] as const) {
      mocks.publish.mockRejectedValueOnce(error);
      click('Publish');
      await waitFor(() => expect(notice()).toContain(message));
      expect(saved().heroId).toBe('');
    }
  });

  it('lists the person\'s live heroes, newest first, marking this one', async () => {
    const writeText = clipboard();
    seed({ heroId, publishedKey: 'key' });
    await mount();
    emitLive(record(heroId, 'This one\nsecond line', 'Desktop', 3), record(otherId, 'Newer hero', 'Both', 9));
    const rows = [...document.querySelectorAll('.published-heroes li')];
    expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual(['Newer hero', 'This one']);
    expect(rows[1].querySelector('.this-hero')?.textContent).toBe('This hero');
    expect(rows[0].querySelector('.this-hero')).toBeNull();
    click('Copy embed code for Newer hero');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code(otherId, 'Both', 'Newer hero')));
    expect(notice()).toContain('Copied the embed code.');
    expect(screen.getByRole('link', { name: 'Open Newer hero' }).getAttribute('href')).toBe(`https://depth-test.web.app/embed/${otherId}`);
    click('Unpublish Newer hero');
    await waitFor(() => expect(mocks.unpublish).toHaveBeenCalledWith({ heroId: otherId }));
  });

  it('keeps the published hero through Undo, so the next publish updates the same link', async () => {
    seed({ placed: false });
    render(<MemoryRouter initialEntries={['/motion']}><Workflow uid="user-a"/></MemoryRouter>);
    click('Float');
    for (const next of ['Next', 'Next', 'Next', 'Finish']) click(next);
    await screen.findAllByTestId('hero3d');
    emitLive();
    click('Publish');
    await waitFor(() => expect(saved().heroId).toBe(heroId));
    click('Back to confirmation');
    fireEvent.change(screen.getByLabelText('Return to stage'), { target: { value: 'motion' } });
    click('Undo edit');
    click('Undo edit');
    expect(saved()).toMatchObject({ motion: 'Still', heroId, publishedKey: expect.any(String) });
    click('Redo edit');
    expect(saved()).toMatchObject({ heroId });
  });
});

describe('Send to Figma', () => {
  const linkCopied = 'Link copied. In Figma, run Plugins › Development › Depth and paste it.';
  const heroLink = () => (screen.getByLabelText('Hero link') as HTMLInputElement).value;

  it('publishes a hero that isn\'t live, with the disclosure beside it, then copies its link', async () => {
    const writeText = clipboard();
    seed();
    await mount();
    emitLive();
    expect(screen.getByText('Anyone with the link can view this hero and download its 3D model.')).toBeTruthy();
    expect(screen.queryByLabelText('Hero link')).toBeNull();
    click('Send to Figma');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://depth-test.web.app/embed/${heroId}`));
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0][0]).toMatchObject({ layout: { desktop: layouts.desktopObjectRight } });
    expect(mocks.publish.mock.calls[0][0].heroId).toBeUndefined();
    expect(notice()).toContain(linkCopied);
    expect(heroLink()).toBe(`https://depth-test.web.app/embed/${heroId}`);
    expect(saved()).toMatchObject({ heroId, publishedKey: publishedKey(readDraft('user-a')) });
  });

  it('updates a live hero that has changed, then copies the same link', async () => {
    const writeText = clipboard();
    seed({ heroId, publishedKey: 'an older hero' });
    await mount();
    emitLive(record(heroId, 'Old headline', 'Desktop', 10));
    click('Send to Figma');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://depth-test.web.app/embed/${heroId}`));
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0][0].heroId).toBe(heroId);
    expect(saved().publishedKey).toBe(publishedKey(readDraft('user-a')));
  });

  it('only copies the link of a live hero that hasn\'t changed, even before the model has drawn', async () => {
    const writeText = clipboard();
    mocks.loading = true;
    seed();
    seed({ heroId, publishedKey: publishedKey(readDraft('user-a')) });
    await mount();
    emitLive(record(heroId, 'Design that\nmoves you.', 'Desktop', 11));
    expect(screen.queryByRole('button', { name: 'Update published hero' })).toBeNull();
    click('Send to Figma');
    await waitFor(() => expect(notice()).toContain(linkCopied));
    expect(writeText).toHaveBeenCalledWith(`https://depth-test.web.app/embed/${heroId}`);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.layer).not.toHaveBeenCalled();
  });

  it('shows the link to copy when the browser refuses the late clipboard write', async () => {
    clipboard(vi.fn().mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError')));
    seed();
    await mount();
    emitLive();
    click('Send to Figma');
    await waitFor(() => expect(notice()).toContain('Copy the link below and paste it in the Depth plugin.'));
    const field = screen.getByLabelText('Hero link') as HTMLInputElement;
    expect([field.value, field.readOnly]).toEqual([`https://depth-test.web.app/embed/${heroId}`, true]);
  });

  it('keeps Phase 4\'s message when the publish fails, and copies nothing', async () => {
    const writeText = clipboard();
    mocks.publish.mockRejectedValueOnce({ code: 'functions/resource-exhausted', details: { cap: 'daily' } });
    seed();
    await mount();
    emitLive();
    click('Send to Figma');
    await waitFor(() => expect(notice()).toContain('You’ve published 20 times today. Try again after midnight UTC.'));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Hero link')).toBeNull();
  });

  it('clears the link when this hero is unpublished', async () => {
    clipboard();
    seed();
    seed({ heroId, publishedKey: publishedKey(readDraft('user-a')) });
    await mount();
    emitLive(record(heroId, 'Design that\nmoves you.', 'Desktop', 11));
    click('Send to Figma');
    await waitFor(() => expect(heroLink()).toBe(`https://depth-test.web.app/embed/${heroId}`));
    click('Unpublish');
    await waitFor(() => expect(screen.queryByLabelText('Hero link')).toBeNull());
  });

  it('says what Complete offers now, with no Figma placeholders', async () => {
    seed({ heroId, publishedKey: 'key' });
    await mount();
    emitLive(record(heroId, 'Design that\nmoves you.', 'Desktop', 11));
    expect(screen.getByText('✓ Done.')).toBeTruthy();
    expect(screen.getByText('Download it as a PNG, download the 3D model as a GLB, publish it to embed on a website, or send it to Figma.')).toBeTruthy();
    expect([...document.querySelectorAll('.publish-actions > *')].map(action => action.textContent)).toEqual(['Copy embed code', 'Send to Figma', 'Open viewer', 'Unpublish']);
    expect(screen.queryByRole('button', { name: 'About Figma placement' })).toBeNull();
    expect(screen.queryByText(/coming in a later update|coming later|isn’t available yet/)).toBeNull();
  });
});

describe('Layout for a real model', () => {
  it('adds an https-only button link and limits each text field', async () => {
    seed();
    await mount('/layout');
    const link = screen.getByLabelText('Button link') as HTMLInputElement;
    expect([link.type, link.maxLength]).toEqual(['url', 2048]);
    expect(['Eyebrow', 'Headline', 'Subtitle', 'Button text'].map(label => (screen.getByLabelText(label) as HTMLInputElement).maxLength)).toEqual([60, 120, 240, 40]);
    fireEvent.change(link, { target: { value: 'http://example.test' } });
    expect(screen.getByRole('alert').textContent).toBe('Use a link that starts with https://');
    fireEvent.change(link, { target: { value: 'https://example.test/shop' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saved().buttonUrl).toBe('https://example.test/shop');
  });
});

describe('Layout\'s frames', () => {
  it('are labelled with the sizes the Figma plugin makes', async () => {
    for (const [frame, labels] of [['Desktop', ['Desktop · 1440 × 836 px']], ['Mobile', ['Mobile · 390 × 546 px']], ['Both', ['Desktop · 1440 × 836 px', 'Mobile · 390 × 546 px']]] as const) {
      seed({ frame });
      await mount('/layout');
      expect([...document.querySelectorAll('.frame-dimensions > span')].map(label => label.textContent), frame).toEqual(labels);
      cleanup();
    }
  });

  // jsdom doesn't lay out, so this checks the rules: Layout's previews keep the hero's shape, as Complete, the embed and Figma do.
  it('take the hero\'s shape, not 1440 × 900 or 390 × 844', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).not.toMatch(/\.step-layout[^{]*\.hero-preview\{aspect-ratio/);
    expect(css).not.toMatch(/1440\/900|390\/844/);
    expect(css).toContain('.step-layout .composition-previews>.mobile-frame,.step-layout .composition-previews>.secondary-mobile{max-width:calc((100dvh - 250px)*350/490)}');
  });
});

describe('without a real model', () => {
  it('keeps the demo\'s embed note and offers no publishing or link field', async () => {
    seed({ modelPath: '', modelJobId: '', lookModelPath: '' });
    render(<MemoryRouter initialEntries={['/complete']}><Workflow uid="user-a"/></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'About embed code' })).toBeTruthy();
    expect(screen.getByText(/Live scene integration/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(mocks.live).toBeNull();
  });
});
