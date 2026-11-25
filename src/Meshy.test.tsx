// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  vi.stubEnv('VITE_JOB_PROVIDER', 'meshy');
  return {
    start: vi.fn(), cancel: vi.fn(), unsubscribe: vi.fn(), upload: vi.fn(), url: vi.fn(), png: vi.fn(), save: vi.fn(), usage: vi.fn(),
    listeners: new Map<string, (snapshot: unknown) => void>(),
  };
});
vi.mock('./firebase', () => ({ firebaseServices: { auth: { currentUser: { uid: 'user-a' } }, db: {}, functions: {}, storage: {} }, signOutUser: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string, options?: unknown) => (data: unknown) => name === 'startGeneration' ? mocks.start(data, options) : mocks.cancel(data),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path, query: (path: string) => path, where: () => null,
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: mocks.usage,
  onSnapshot: (path: string, next: (snapshot: unknown) => void) => { mocks.listeners.set(path, next); return mocks.unsubscribe; },
}));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => path, uploadBytes: mocks.upload, getDownloadURL: mocks.url }));
vi.mock('./ModelViewer', () => ({ default: ({ url, material, textured }: { url: string; material?: string; textured?: boolean }) => <div data-testid="viewer" data-material={material} data-textured={textured}>{url}</div> }));
vi.mock('./Hero3D', () => ({ default: ({ url, scene }: { url: string; scene: { motion: string; camera: string; look: { textured: boolean } } }) => {
  if (url.includes('broken')) throw new Error('WebGL unavailable');
  return <div data-testid="hero3d" data-url={url} data-motion={scene.motion} data-camera={scene.camera} data-textured={String(scene.look.textured)}/>;
} }));
vi.mock('./exportHero', () => ({ heroPng: mocks.png }));
vi.mock('./download', async importOriginal => ({ ...await importOriginal<typeof import('./download')>(), saveFile: mocks.save }));

import { Workflow } from './Workflow';
import { jobMessage, meshyJobs, meshyProvider } from './jobs';
import { initialDraft, readDraft, storageKey, type Draft } from './model';

function Route() { const location = useLocation(); return <output data-testid="route">{location.pathname}{location.search}</output>; }
function mount(route: string) { return render(<MemoryRouter initialEntries={[route]}><Workflow uid="user-a"/><Route/></MemoryRouter>); }
function seed(patch: Partial<Draft>) { localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, connected: true, ...patch })); }
function saved(): Draft { return JSON.parse(localStorage.getItem(storageKey('user-a')) || '{}'); }
function click(name: string | RegExp) { fireEvent.click(screen.getByRole('button', { name })); }
function expectRoute(route: string) { expect(screen.getByTestId('route').textContent).toBe(route); }
const flush = () => act(async () => {});
function emit(jobId: string, data?: object) { act(() => mocks.listeners.get(`jobs/${jobId}`)!({ data: () => data, metadata: { fromCache: false } })); }
const label = () => document.querySelector('.processing-label')?.textContent;
const modelPath = 'models/user-a/job-1/model.glb';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  localStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-1' as ReturnType<typeof crypto.randomUUID>);
  mocks.start.mockResolvedValue({ data: { jobId: 'job-1' } });
  mocks.cancel.mockResolvedValue({ data: { status: 'canceled', refunded: true } });
  mocks.upload.mockResolvedValue({});
  mocks.url.mockResolvedValue('https://example.test/model.glb');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Draft version 2', () => {
  it('migrates version 1 drafts with empty job fields and keeps sanitizing', () => {
    localStorage.setItem(storageKey('user-a'), JSON.stringify({ version: 1, connected: true, shapeReady: true, prompt: 'Old ear', speed: 9 }));
    expect(readDraft('user-a')).toEqual({ ...initialDraft, version: 2, connected: true, shapeReady: true, prompt: 'Old ear', speed: 2, shapeJobId: '', modelPath: '', uploadPath: '' });
    localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, shapeJobId: 42, modelPath: 'models/user-a/j/model.glb', uploadPath: null }));
    expect(readDraft('user-a')).toMatchObject({ shapeJobId: '', modelPath: 'models/user-a/j/model.glb', uploadPath: '' });
    localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, version: 3, connected: true }));
    expect(readDraft('user-a')).toEqual(initialDraft);
  });

  it('fills modelJobId from a Phase 1 model path so the shape can be textured', () => {
    const read = (patch: object) => { localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, ...patch })); return readDraft('user-a'); };
    expect(read({ modelPath: 'models/user-a/j/model.glb' })).toMatchObject({ modelJobId: 'j', lookJobId: '', lookModelPath: '' });
    expect(read({ modelPath: 'models/user-a/j/model.glb', modelJobId: 'kept' }).modelJobId).toBe('kept');
    expect(read({ modelPath: 'models/user-b/j/model.glb' }).modelJobId).toBe('');
    expect(read({ modelPath: 'models/user-a/j/other.glb' }).modelJobId).toBe('');
    expect(read({}).modelJobId).toBe('');
  });
});

describe('Meshy job service', () => {
  it('is selected by VITE_JOB_PROVIDER', () => { expect(meshyProvider).toBe(true); });

  it('starts with limited-use App Check tokens, reports the job id and progress, and finishes with the model path', async () => {
    const on = { progress: vi.fn(), done: vi.fn(), failed: vi.fn(), id: vi.fn() };
    meshyJobs.start('shape', { source: 'text', prompt: 'An ear' }, on);
    expect(on.progress).toHaveBeenCalledWith(0, 'starting');
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ source: 'text', prompt: 'An ear' }, { limitedUseAppCheckTokens: true });
    expect(on.id).toHaveBeenCalledWith('job-1');
    emit('job-1', { status: 'queued', progress: 0 });
    emit('job-1', { status: 'running', progress: 42.4 });
    emit('job-1', { status: 'ingesting', progress: 99 });
    expect(on.progress.mock.calls.slice(1)).toEqual([[0, 'queued'], [42, 'running'], [100, 'ingesting']]);
    emit('job-1', { status: 'ready', progress: 100, modelPath });
    expect(on.done).toHaveBeenCalledWith(modelPath);
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(on.failed).not.toHaveBeenCalled();
  });

  it('sends looks to startGeneration and keeps placement on the simulation', async () => {
    meshyJobs.start('look', { kind: 'look', shapeJobId: 'shape-1', prompt: 'Bronze' }, { progress: vi.fn(), done: vi.fn() });
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ kind: 'look', shapeJobId: 'shape-1', prompt: 'Bronze' }, { limitedUseAppCheckTokens: true });
    mocks.start.mockClear();
    vi.useFakeTimers();
    const on = { progress: vi.fn(), done: vi.fn() };
    meshyJobs.start('place', null, on);
    vi.advanceTimersByTime(2300);
    expect(on.done).toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels a job whose id arrives after Cancel, and cancels a known job directly', async () => {
    let resolve = (_value: unknown) => {};
    mocks.start.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const on = { progress: vi.fn(), done: vi.fn(), failed: vi.fn(), id: vi.fn() };
    meshyJobs.start('shape', { source: 'image', imagePath: 'uploads/user-a/uuid-1.png' }, on).cancel();
    resolve({ data: { jobId: 'job-2' } });
    await flush();
    expect(mocks.cancel).toHaveBeenCalledWith({ jobId: 'job-2' });
    expect(on.id).not.toHaveBeenCalled();
    meshyJobs.resume!('job-3', on).cancel();
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledWith({ jobId: 'job-3' });
    meshyJobs.resume!('job-4', on);
    emit('job-4', { status: 'canceled' });
    expect(on.failed).toHaveBeenLastCalledWith('This model was canceled.');
    meshyJobs.resume!('job-5', on);
    emit('job-5');
    expect(on.failed).toHaveBeenLastCalledWith('This model could not be found.');
  });

  it('maps HttpsError codes to short messages', async () => {
    expect(jobMessage({ code: 'functions/resource-exhausted', message: 'Daily limit reached.' })).toBe('You’ve reached today’s limit of 10 shapes and looks. Try again tomorrow.');
    expect(jobMessage({ code: 'functions/resource-exhausted', message: 'Monthly credit limit reached.' })).toBe('This month’s shape credits are used up. Try again next month.');
    expect(jobMessage({ code: 'functions/invalid-argument' })).toBe('Check the prompt (up to 600 characters) or the image, then try again.');
    expect(jobMessage({ code: 'functions/permission-denied' })).toMatch(/can’t generate shapes/);
    // App Check failures arrive as unauthenticated and say nothing about the account.
    expect(jobMessage({ code: 'functions/unauthenticated' })).toBe('Depth couldn’t verify this browser. Reload the page and try again.');
    expect(jobMessage({ code: 'functions/unavailable' })).toBe('Meshy couldn’t start this model. Try again in a moment.');
    expect(jobMessage({ code: 'functions/failed-precondition' })).toBe('Meshy can no longer texture this shape. Make the shape again.');
    expect(jobMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    mocks.start.mockRejectedValueOnce({ code: 'functions/unavailable' });
    const on = { progress: vi.fn(), done: vi.fn(), failed: vi.fn() };
    meshyJobs.start('shape', { source: 'text', prompt: 'An ear' }, on);
    await flush();
    expect(on.failed).toHaveBeenCalledWith('Meshy couldn’t start this model. Try again in a moment.');
  });
});

describe('Meshy workflow', () => {
  it('shows real progress, saves the model path and shows the model on Shape and Fine-tune', async () => {
    seed({ prompt: 'A sculpted ear' });
    mount('/prompt');
    expect(screen.queryByText(/Demo · 0 credits/)).toBeNull();
    click('Generate · 20 credits');
    expectRoute('/prompt?state=processing');
    expect(label()).toBe('Starting…');
    expect(screen.getByText(/canceling may not give them back/)).toBeTruthy();
    expect(screen.queryByText(/Demo only/)).toBeNull();
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ source: 'text', prompt: 'A sculpted ear' }, { limitedUseAppCheckTokens: true });
    expect(saved().shapeJobId).toBe('job-1');
    emit('job-1', { status: 'queued', progress: 0 });
    expect(label()).toBe('Queued…');
    emit('job-1', { status: 'running', progress: 42 });
    expect(label()).toBe('Shaping 42%');
    emit('job-1', { status: 'ingesting', progress: 100 });
    expect(label()).toBe('Saving the model…');
    emit('job-1', { status: 'ready', progress: 100, modelPath });
    expectRoute('/shape?state=ready');
    expect(saved()).toMatchObject({ shapeReady: true, modelPath, shapeJobId: '' });
    click('Review Shape');
    await flush();
    expect(mocks.url).toHaveBeenCalledWith(modelPath);
    expect(screen.getByTestId('viewer').textContent).toBe('https://example.test/model.glb');
    expect(screen.queryByAltText(/Sample sculpted ear/)).toBeNull();
    click('Good, But Fine Tune!');
    await flush();
    expect(screen.getByTestId('viewer')).toBeTruthy();
  });

  it('keeps the sample artwork when there is no model', () => {
    seed({ shapeReady: true });
    mount('/shape');
    expect(screen.getAllByAltText('Sample sculpted ear in white clay').length).toBeGreaterThan(0);
    expect(mocks.url).not.toHaveBeenCalled();
  });

  it('shows failures with Try again and Edit prompt', async () => {
    seed({ prompt: 'A sculpted ear' });
    mount('/prompt');
    click('Generate · 20 credits');
    await flush();
    emit('job-1', { status: 'failed', error: 'Meshy could not read that prompt.' });
    expect(screen.getByRole('alert').textContent).toBe('Meshy could not read that prompt.');
    expect(saved().shapeJobId).toBe('');
    mocks.start.mockRejectedValueOnce({ code: 'functions/resource-exhausted', message: 'Monthly limit reached' });
    click('Try again');
    await flush();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert').textContent).toBe('This month’s shape credits are used up. Try again next month.');
    click('Edit prompt');
    expectRoute('/prompt');
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('resumes a saved job after a refresh without starting another', async () => {
    seed({ prompt: 'A sculpted ear', shapeJobId: 'job-9' });
    const first = mount('/prompt?state=processing');
    expect(mocks.listeners.has('jobs/job-9')).toBe(true);
    emit('job-9', { status: 'running', progress: 10 });
    expect(label()).toBe('Shaping 10%');
    first.unmount();
    mocks.listeners.clear();
    mount('/connect');
    expectRoute('/prompt?state=processing');
    emit('job-9', { status: 'ready', progress: 100, modelPath });
    expectRoute('/shape?state=ready');
    expect(saved()).toMatchObject({ shapeJobId: '', modelPath, shapeReady: true });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('cancels through cancelGeneration and clears the job id', async () => {
    seed({ prompt: 'A sculpted ear' });
    mount('/prompt');
    click('Generate · 20 credits');
    await flush();
    emit('job-1', { status: 'running', progress: 30 });
    click('Cancel');
    expectRoute('/prompt');
    expect(mocks.cancel).toHaveBeenCalledWith({ jobId: 'job-1' });
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(saved()).toMatchObject({ shapeJobId: '', shapeReady: false });
  });

  it('validates and uploads a chosen image, then generates from its path', async () => {
    seed({});
    mount('/prompt');
    click('Quick Generate');
    const input = screen.getByLabelText('Choose a photo or sketch');
    fireEvent.change(input, { target: { files: [new File(['x'], 'ear.gif', { type: 'image/gif' })] } });
    expect(screen.getByRole('alert').textContent).toBe('Choose a JPG, PNG, or WebP image.');
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole('alert').textContent).toBe('Choose an image under 20 MB.');
    mocks.upload.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(input, { target: { files: [new File(['x'], 'ear.png', { type: 'image/png' })] } });
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Upload failed. Check your connection and try again.');
    const file = new File(['x'], 'ear.webp', { type: 'image/webp' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Generate · 20 credits' }) as HTMLButtonElement).disabled).toBe(true);
    await flush();
    expect(mocks.upload).toHaveBeenLastCalledWith('uploads/user-a/uuid-1.webp', file, { contentType: 'image/webp' });
    expect(saved()).toMatchObject({ uploadName: 'ear.webp', uploadPath: 'uploads/user-a/uuid-1.webp' });
    click('Generate · 20 credits');
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ source: 'image', imagePath: 'uploads/user-a/uuid-1.webp' }, { limitedUseAppCheckTokens: true });
  });

  it('uploads a chosen sample image the same way', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) } as Response);
    seed({});
    mount('/prompt');
    click('Quick Generate');
    click('Try tree sample');
    await flush();
    expect(fetch).toHaveBeenCalledWith('/assets/sample-tree.png');
    expect(mocks.upload).toHaveBeenCalledWith('uploads/user-a/uuid-1.png', expect.any(Blob), { contentType: 'image/png' });
    expect(saved()).toMatchObject({ uploadName: 'tree sample', prompt: 'A detailed tree', uploadPath: 'uploads/user-a/uuid-1.png' });
  });

  it('regenerates from the Fine-tune prompt as text', async () => {
    seed({ shapeReady: true, inputMode: 'quick', uploadPath: 'uploads/user-a/old.png', prompt: 'A wider ear' });
    mount('/fine-tune');
    click('Regenerate shape · 20 credits');
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ source: 'text', prompt: 'A wider ear' }, { limitedUseAppCheckTokens: true });
  });

  it('shows the real cost on Connect and no longer offers a demo key', () => {
    mount('/connect');
    expect(screen.queryByRole('button', { name: 'Continue with demo →' })).toBeNull();
    expect(screen.getByText('20 credits per shape, 10 per look.')).toBeTruthy();
    expect(screen.queryByText(/\b0 credits|no API key needed/)).toBeNull();
    click('Continue →');
    expectRoute('/prompt');
  });
});

describe('Meshy looks', () => {
  const shape: Partial<Draft> = { shapeReady: true, prompt: 'A sculpted ear', modelPath, modelJobId: 'job-1' };
  const lookPath = 'models/user-a/look-1/model.glb';
  beforeEach(() => { mocks.start.mockResolvedValue({ data: { jobId: 'look-1' } }); });

  it('textures a text shape with the trimmed look prompt, shows progress and opens the render', async () => {
    seed({ ...shape, lookPrompt: '  Warm bronze  ' });
    mount('/appearance');
    expect(screen.getByText('10 credits')).toBeTruthy();
    expect(screen.getByText('Leave it empty to use your shape description.')).toBeTruthy();
    click('Looks Good, Continue!');
    expectRoute('/appearance?state=processing');
    expect(label()).toBe('Starting…');
    expect(screen.getByText('10 credits per look. Once Meshy has started, canceling may not give them back.')).toBeTruthy();
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ kind: 'look', shapeJobId: 'job-1', prompt: 'Warm bronze' }, { limitedUseAppCheckTokens: true });
    expect(saved().lookJobId).toBe('look-1');
    emit('look-1', { status: 'queued', progress: 0 });
    expect(label()).toBe('Queued…');
    emit('look-1', { status: 'running', progress: 42 });
    expect(label()).toBe('Texturing 42%');
    emit('look-1', { status: 'ingesting', progress: 100 });
    expect(label()).toBe('Saving the model…');
    emit('look-1', { status: 'ready', progress: 100, modelPath: lookPath });
    expectRoute('/render?state=ready');
    expect(saved()).toMatchObject({ lookReady: true, lookModelPath: lookPath, lookJobId: '', modelPath, modelJobId: 'job-1' });
    expect(screen.getByText('Textured by Meshy · 10 credits used')).toBeTruthy();
    click('Review Render');
    await flush();
    expect(mocks.url).toHaveBeenLastCalledWith(lookPath);
    expect(screen.getByText('TEXTURED PREVIEW')).toBeTruthy();
    expect(screen.getByTestId('viewer').dataset).toMatchObject({ material: 'Original', textured: 'true' });
  });

  it('textures a photo shape with an empty prompt so Meshy uses the photo', async () => {
    seed({ ...shape, inputMode: 'quick', uploadPath: 'uploads/user-a/uuid-1.png', lookPrompt: '   ' });
    mount('/appearance');
    expect(screen.getByText('Leave it empty to use your photo.')).toBeTruthy();
    click('Looks Good, Continue!');
    await flush();
    expect(mocks.start).toHaveBeenCalledWith({ kind: 'look', shapeJobId: 'job-1', prompt: '' }, { limitedUseAppCheckTokens: true });
  });

  it('shows look failures with Try again and Edit look', async () => {
    seed(shape);
    mount('/appearance');
    click('Looks Good, Continue!');
    await flush();
    emit('look-1', { status: 'failed', error: 'Meshy could not generate this model.' });
    expect(screen.getByRole('heading', { name: 'That look didn’t work.' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Meshy could not generate this model.');
    expect(saved().lookJobId).toBe('');
    mocks.start.mockRejectedValueOnce({ code: 'functions/failed-precondition' });
    click('Try again');
    await flush();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start).toHaveBeenLastCalledWith({ kind: 'look', shapeJobId: 'job-1', prompt: '' }, { limitedUseAppCheckTokens: true });
    expect(screen.getByRole('alert').textContent).toBe('Meshy can no longer texture this shape. Make the shape again.');
    click('Edit look');
    expectRoute('/appearance');
    expect(saved().lookReady).toBe(false);
  });

  it('resumes a saved look after a refresh without starting another', () => {
    seed({ ...shape, lookJobId: 'look-9' });
    mount('/connect');
    expectRoute('/appearance?state=processing');
    emit('look-9', { status: 'running', progress: 10 });
    expect(label()).toBe('Texturing 10%');
    emit('look-9', { status: 'ready', progress: 100, modelPath: lookPath });
    expectRoute('/render?state=ready');
    expect(saved()).toMatchObject({ lookJobId: '', lookReady: true, lookModelPath: lookPath });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('cancels a look through cancelGeneration', async () => {
    seed(shape);
    mount('/appearance');
    click('Looks Good, Continue!');
    await flush();
    emit('look-1', { status: 'running', progress: 30 });
    click('Cancel');
    expectRoute('/appearance');
    expect(mocks.cancel).toHaveBeenCalledWith({ jobId: 'look-1' });
    expect(saved()).toMatchObject({ lookJobId: '', lookReady: false, lookModelPath: '' });
  });

  it('applies Manual Options to the real model for free', async () => {
    seed({ ...shape, lookModelPath: lookPath });
    mount('/materials');
    await flush();
    expect(screen.queryByLabelText('Additional material description')).toBeNull();
    expect(screen.getByText('Material changes are free and only affect this preview.')).toBeTruthy();
    expect(mocks.url).toHaveBeenLastCalledWith(lookPath);
    expect(screen.getByText('TEXTURED PREVIEW')).toBeTruthy();
    click('Metallic');
    expect(screen.getByText('MATERIAL PREVIEW')).toBeTruthy();
    expect(screen.getByTestId('viewer').dataset).toMatchObject({ material: 'Metallic', textured: 'true' });
    // Original brings back Meshy's own texture.
    click('Original');
    expect(screen.getByText('TEXTURED PREVIEW')).toBeTruthy();
    expect(screen.getByTestId('viewer').dataset).toMatchObject({ material: 'Original', textured: 'true' });
    click('Metallic');
    click('Looks Good, Continue!');
    expectRoute('/render');
    expect(saved().lookReady).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    await flush();
    expect(screen.getByTestId('viewer').dataset).toMatchObject({ material: 'Metallic', textured: 'true' });
  });

  it('shows the clay shape with the material on Render when there is no look yet', async () => {
    seed({ ...shape, lookReady: true, material: 'Rough Matte' });
    mount('/render');
    await flush();
    expect(mocks.url).toHaveBeenLastCalledWith(modelPath);
    expect(screen.getByText('MATERIAL PREVIEW')).toBeTruthy();
    expect(screen.getByTestId('viewer').dataset).toMatchObject({ material: 'Rough Matte', textured: 'false' });
  });

  it('shows the clay shape, not the sample ear, beside the look prompt', async () => {
    seed(shape);
    mount('/appearance');
    await flush();
    expect(mocks.url).toHaveBeenLastCalledWith(modelPath);
    expect(screen.getByTestId('viewer').textContent).toBe('https://example.test/model.glb');
    expect(screen.queryByAltText('Sample clay ear')).toBeNull();
  });

  it('keeps the sample ear beside the look prompt when there is no model', () => {
    seed({ shapeReady: true });
    mount('/appearance');
    expect(screen.getByAltText('Sample clay ear')).toBeTruthy();
    expect(mocks.url).not.toHaveBeenCalled();
  });

  // Nov 10 incident: the draft kept lookReady but lost lookJobId and lookModelPath.
  it('keeps a finished look when Undo is used afterwards', async () => {
    seed({ ...shape, lookReady: true });
    mount('/appearance');
    click('Looks Good, Continue!');
    await flush();
    emit('look-1', { status: 'ready', progress: 100, modelPath: lookPath });
    click('Review Render');
    click('Looks Good, Choose a Template!');
    click('Select');
    expectRoute('/motion');
    click('Float');
    click('Undo edit');
    expect(saved()).toMatchObject({ motion: 'Still', lookModelPath: lookPath });
    click('Undo edit');
    expect(saved()).toMatchObject({ lookReady: true, lookModelPath: lookPath, modelPath, modelJobId: 'job-1' });
  });

  it('keeps a look another tab finished when this older tab saves again', () => {
    seed({ ...shape, lookReady: true });
    mount('/motion');
    click('Float');
    // The other tab saves the finished look; the browser tells this tab with a storage event.
    localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...saved(), lookModelPath: lookPath }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: storageKey('user-a') })); });
    click('Sway');
    expect(saved()).toMatchObject({ motion: 'Sway', lookReady: true, lookModelPath: lookPath });
    click('Undo edit');
    click('Undo edit');
    expect(saved()).toMatchObject({ lookReady: true, lookModelPath: lookPath, modelPath, modelJobId: 'job-1' });
  });

  it('clears the old look, and starts a new published hero, when a new shape finishes', async () => {
    mocks.start.mockResolvedValue({ data: { jobId: 'job-2' } });
    seed({ ...shape, lookReady: true, lookModelPath: lookPath, heroId: 'abcdefghij0123456789', publishedKey: 'key' });
    mount('/prompt');
    click('Generate · 20 credits');
    await flush();
    emit('job-2', { status: 'ready', progress: 100, modelPath: 'models/user-a/job-2/model.glb' });
    expect(saved()).toMatchObject({ shapeReady: true, modelPath: 'models/user-a/job-2/model.glb', modelJobId: 'job-2', lookReady: false, lookModelPath: '', heroId: '', publishedKey: '' });
  });

  // Another tab shares this draft through the storage event and may be running its own job.
  function otherTabSaves(patch: Partial<Draft>) {
    localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...saved(), ...patch }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: storageKey('user-a') })); });
  }

  it('keeps another tab’s running shape job when this tab’s look finishes', async () => {
    seed(shape);
    mount('/appearance');
    click('Looks Good, Continue!');
    await flush();
    otherTabSaves({ shapeJobId: 'job-2' });
    emit('look-1', { status: 'ready', progress: 100, modelPath: lookPath });
    expect(saved()).toMatchObject({ shapeJobId: 'job-2', lookJobId: '', lookReady: true, lookModelPath: lookPath });
  });

  it('saves its own shape id when another tab clears the job ids', async () => {
    mocks.start.mockResolvedValue({ data: { jobId: 'job-2' } });
    seed(shape);
    mount('/prompt');
    click('Generate · 20 credits');
    await flush();
    otherTabSaves({ shapeJobId: '', lookJobId: '' });
    emit('job-2', { status: 'ready', progress: 100, modelPath: 'models/user-a/job-2/model.glb' });
    expect(saved()).toMatchObject({ modelJobId: 'job-2', modelPath: 'models/user-a/job-2/model.glb', shapeJobId: '' });
  });

  it('doesn’t apply a look made for a shape another tab has replaced', async () => {
    seed(shape);
    mount('/appearance');
    click('Looks Good, Continue!');
    await flush();
    otherTabSaves({ modelJobId: 'job-2', modelPath: 'models/user-a/job-2/model.glb', lookReady: false, lookModelPath: '' });
    emit('look-1', { status: 'ready', progress: 100, modelPath: lookPath });
    expect(saved()).toMatchObject({ modelJobId: 'job-2', lookReady: false, lookModelPath: '', lookJobId: '' });
    expect(screen.getByRole('alert').textContent).toBe('This look was made for an earlier shape, so it wasn’t applied.');
  });

  it('doesn’t resume a stale look after a newer shape finishes', async () => {
    seed(shape);
    const first = mount('/appearance');
    click('Looks Good, Continue!');
    await flush();
    otherTabSaves({ shapeJobId: 'job-2' });
    first.unmount();
    // A reload resumes only the shape, so look-1's id is left in the draft.
    const second = mount('/appearance');
    expectRoute('/prompt?state=processing');
    emit('job-2', { status: 'ready', progress: 100, modelPath: 'models/user-a/job-2/model.glb' });
    second.unmount();
    mount('/shape');
    expectRoute('/shape');
    expect(saved()).toMatchObject({ modelJobId: 'job-2', lookJobId: '', lookReady: false, lookModelPath: '' });
  });
});

describe('Meshy hero', () => {
  const lookPath = 'models/user-a/look-1/model.glb';
  const look: Partial<Draft> = { shapeReady: true, lookReady: true, modelPath, modelJobId: 'job-1', lookModelPath: lookPath };

  it('shows the look in the 3D hero and keeps the ear box only as a hidden anchor', async () => {
    seed({ ...look, motion: 'Float', camera: 'Push-in' });
    mount('/motion');
    const [hero] = await screen.findAllByTestId('hero3d');
    expect(mocks.url).toHaveBeenCalledWith(lookPath);
    expect(hero.dataset).toMatchObject({ url: 'https://example.test/model.glb', motion: 'Float', camera: 'Push-in', textured: 'true' });
    const anchor = document.querySelector('.hero-object')!;
    expect(anchor.classList.contains('hero-anchor')).toBe(true);
    expect(anchor.classList.contains('motion-float')).toBe(false);
    expect(document.querySelector('.hero-preview')!.classList.contains('playing')).toBe(false);
  });

  it('shows the clay shape when there is no look yet', async () => {
    seed({ ...look, lookModelPath: '' });
    mount('/motion');
    const [hero] = await screen.findAllByTestId('hero3d');
    expect(mocks.url).toHaveBeenCalledWith(modelPath);
    expect(hero.dataset.textured).toBe('false');
  });

  it('mounts the expanded preview’s 3D layer only while it is open', async () => {
    const { showModal, close } = HTMLDialogElement.prototype;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    try {
      seed(look);
      mount('/motion');
      expect(await screen.findAllByTestId('hero3d')).toHaveLength(1);
      click('Expand preview');
      await flush();
      expect(screen.getAllByTestId('hero3d')).toHaveLength(2);
      click('Close preview');
      await flush();
      expect(screen.getAllByTestId('hero3d')).toHaveLength(1);
    } finally { Object.assign(HTMLDialogElement.prototype, { showModal, close }); }
  });

  it('doesn’t call a real model’s confirm and complete screens a demo or sample', async () => {
    seed({ ...look, placed: true });
    const first = mount('/confirm');
    await screen.findAllByTestId('hero3d');
    expect(screen.getByText('Your scene is ready to go!')).toBeTruthy();
    first.unmount();
    mount('/complete');
    await screen.findAllByTestId('hero3d');
    expect(screen.getByRole('heading', { name: 'Your hero is ready.' })).toBeTruthy();
    expect(screen.getByText('✓ Done.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your Scene' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose stage, current: Complete/ })).toBeTruthy();
    expect(screen.queryByText(/demo|sample/i)).toBeNull();
    expect(screen.queryByLabelText('Illustrative hero composition')).toBeNull();
  });

  it('downloads the hero as a PNG at twice the frame width, and both frames for Both', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    mocks.png.mockResolvedValue(png);
    seed({ ...look, placed: true });
    const first = mount('/complete');
    await screen.findAllByTestId('hero3d');
    click('Download PNG');
    await flush();
    expect(mocks.png).toHaveBeenCalledTimes(1);
    expect(mocks.png.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
    expect(mocks.png.mock.calls[0][1]).toBe(2880);
    expect(mocks.save).toHaveBeenCalledWith(png, 'depth-hero-desktop.png');
    first.unmount();
    vi.clearAllMocks();
    mocks.png.mockResolvedValue(png);
    mocks.url.mockResolvedValue('https://example.test/model.glb');
    seed({ ...look, placed: true, frame: 'Both' });
    mount('/complete');
    await screen.findAllByTestId('hero3d');
    click('Download PNG');
    await flush();
    expect(mocks.png.mock.calls.map(call => call[1])).toEqual([2880, 780]);
    expect(mocks.save.mock.calls.map(call => call[1])).toEqual(['depth-hero-desktop.png', 'depth-hero-mobile.png']);
  });

  it('copies the hero PNG to the clipboard', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    mocks.png.mockResolvedValue(png);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Promise<Blob>>) {} });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    seed({ ...look, placed: true });
    mount('/complete');
    await screen.findAllByTestId('hero3d');
    click('Copy PNG');
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(await write.mock.calls[0][0][0].items['image/png']).toBe(png);
    expect(document.querySelector('.inline-notice')?.textContent).toContain('Copied the hero PNG.');
    vi.unstubAllGlobals();
  });

  it('downloads the look’s GLB file', async () => {
    const glb = new Blob(['glb']);
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => glb });
    vi.stubGlobal('fetch', fetch);
    seed({ ...look, placed: true });
    mount('/complete');
    click('Download GLB');
    await flush();
    await flush();
    expect(mocks.url).toHaveBeenCalledWith(lookPath);
    expect(fetch).toHaveBeenCalledWith('https://example.test/model.glb');
    expect(mocks.save).toHaveBeenCalledWith(glb, 'depth-model.glb');
    expect(screen.getByText('Your GLB is downloaded')).toBeTruthy();
    expect(document.querySelector('.glb-status')?.textContent).toBe('Your GLB is downloadedYour browser saved depth-model.glb.');
    expect(screen.queryByRole('button', { name: /Link into Figma/ })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows the GLB’s progress while it downloads, then the success panel', async () => {
    let finish!: () => void;
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const reader = { read: vi.fn()
      .mockResolvedValueOnce({ done: false, value: chunks[0] })
      .mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ done: false, value: chunks[1] }); }))
      .mockResolvedValue({ done: true }) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': '4' }), body: { getReader: () => reader } }));
    seed({ ...look, placed: true });
    mount('/complete');
    click('Download GLB');
    await flush();
    await flush();
    expect(document.querySelector('.glb-status')?.textContent).toContain('Preparing your GLB… 50%');
    // A real model's card has the publish panel, not the demo's placeholder.
    expect(screen.queryByText(/Live scene integration/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Download GLB' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await flush();
    expect(mocks.save.mock.calls[0][1]).toBe('depth-model.glb');
    expect((mocks.save.mock.calls[0][0] as Blob).size).toBe(4);
    expect(screen.getByText('Your GLB is downloaded')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('goes from the confirm step to complete with no simulated placement', async () => {
    seed({ ...look });
    mount('/confirm');
    expect(screen.getByRole('heading', { name: 'Ready to Finish?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simulate placement' })).toBeNull();
    expect(screen.queryByText('Place As')).toBeNull();
    expect(screen.queryByText(/Figma placement/)).toBeNull();
    click('Finish');
    expectRoute('/complete');
    expect(saved().placed).toBe(true);
    expect(screen.queryByText(/Simulating placement|Preparing your demo hero/)).toBeNull();
  });

  it('edits the hero’s eyebrow and subtitle, and hides one that is emptied', async () => {
    seed({ ...look });
    mount('/layout');
    await screen.findAllByTestId('hero3d');
    expect(document.querySelector('.hero-eyebrow')?.textContent).toBe('Made with Meshy');
    fireEvent.change(screen.getByLabelText('Eyebrow'), { target: { value: 'New drop' } });
    fireEvent.change(screen.getByLabelText('Subtitle'), { target: { value: 'Turn it around.' } });
    expect(document.querySelector('.hero-eyebrow')?.textContent).toBe('New drop');
    expect(document.querySelector('.hero-description')?.textContent).toBe('Turn it around.');
    expect(saved().eyebrow).toBe('New drop');
    fireEvent.change(screen.getByLabelText('Eyebrow'), { target: { value: '' } });
    expect(document.querySelector('.hero-eyebrow')).toBeNull();
  });

  it('shows how many shapes and looks are left today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.usage.mockResolvedValue({ data: () => ({ day: today, dayCount: 3 }) });
    seed({ prompt: 'A sculpted ear' });
    const first = mount('/prompt');
    await flush();
    expect(screen.getByText('20 credits · 7 of 10 left today')).toBeTruthy();
    first.unmount();
    mocks.usage.mockResolvedValue({ data: () => ({ day: '2020-01-01', dayCount: 9 }) });
    const second = mount('/prompt');
    await flush();
    expect(screen.getByText('20 credits · 10 of 10 left today')).toBeTruthy();
    second.unmount();
    // Quick Generate shows the same count under the upload.
    mocks.usage.mockResolvedValue({ data: () => ({ day: today, dayCount: 4 }) });
    seed({ inputMode: 'quick' });
    mount('/prompt');
    await flush();
    expect(screen.getByText('20 credits · 6 of 10 left today')).toBeTruthy();
  });

  it('falls back to the ear image when the 3D hero fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.url.mockResolvedValue('https://example.test/broken.glb');
    seed({ ...look, motion: 'Float' });
    mount('/motion');
    await flush();
    await flush();
    expect(screen.queryByTestId('hero3d')).toBeNull();
    expect(document.querySelector('.hero-object')!.classList.contains('motion-float')).toBe(true);
    expect(screen.getAllByAltText('Sample sculpted ear model').length).toBeGreaterThan(0);
  });
});
