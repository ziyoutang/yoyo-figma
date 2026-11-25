// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The live studio with agentAssist mocked: no network, no Claude and no Meshy call.
const mocks = vi.hoisted(() => {
  vi.stubEnv('VITE_JOB_PROVIDER', 'meshy');
  return { agent: vi.fn(), start: vi.fn(), usage: vi.fn() };
});
vi.mock('./firebase', () => ({ firebaseServices: { auth: { currentUser: { uid: 'user-a' } }, db: {}, functions: {}, storage: {} }, signOutUser: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string, options?: unknown) => (data: unknown) => name === 'agentAssist' ? mocks.agent(data, options) : mocks.start(name, data),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path, query: (path: string) => path, where: () => null,
  doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: mocks.usage, onSnapshot: () => () => {},
}));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => path, uploadBytes: vi.fn(), getDownloadURL: async (path: string) => `https://example.test/${path}` }));

import { Workflow } from './Workflow';
import { editable } from './heroOptions';
import { initialDraft, storageKey, type Draft } from './model';

function Route() { const location = useLocation(); return <output data-testid="route">{location.pathname}{location.search}</output>; }
const ready: Partial<Draft> = { connected: true, shapeReady: true, lookReady: true, prompt: 'A walnut chair' };
function seed(patch: Partial<Draft> = {}) { localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, ...ready, ...patch })); }
const saved = (): Draft => JSON.parse(localStorage.getItem(storageKey('user-a')) || '{}');
async function mount(route: string) { render(<MemoryRouter initialEntries={[route]}><Workflow uid="user-a"/><Route/></MemoryRouter>); await flush(); }
const flush = () => act(async () => {});
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const button = (name: string | RegExp) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const status = () => Array.from(document.querySelectorAll('.agent-status')).map(node => node.textContent).join('|');
const alert = () => screen.queryByRole('alert')?.textContent;
const ok = (result: object, left = 26) => ({ data: { status: 'ok', result, left } });
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Sends a call that the test answers later.
function pending() { const call = deferred(); mocks.agent.mockReturnValueOnce(call.promise); return { answer: (reply: unknown) => act(async () => call.resolve(reply)), fail: (error: unknown) => act(async () => call.reject(error)) }; }
function describeChange(request: string) {
  const field = screen.getByLabelText('Describe a change') as HTMLInputElement;
  fireEvent.change(field, { target: { value: request } });
  fireEvent.submit(field.closest('form')!);
  return field;
}
const sentCurrent = () => (mocks.agent.mock.calls.at(-1)![0] as {current: Record<string, unknown>}).current;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  mocks.usage.mockResolvedValue({ data: () => ({ agentDay: new Date().toISOString().slice(0, 10), agentCount: 3 }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Agent Mode on the Prompt screen', () => {
  it('polishes the prompt: Keep mine changes nothing, Use this replaces it in one undo step, and no job starts', async () => {
    seed();
    await mount('/prompt');
    expect(screen.getByText('Agent Mode · no credits · 27 of 30 left today')).toBeTruthy();
    expect(screen.getByText('Agent Mode sends what you type to Anthropic\'s Claude. Depth doesn\'t store it.')).toBeTruthy();
    mocks.agent.mockResolvedValue(ok({ prompt: 'A mid-century walnut lounge chair with tapered legs', note: 'Added the era, material and legs.' }));
    click('Polish prompt');
    await flush();
    expect(mocks.agent).toHaveBeenCalledWith({ job: 'polish', idea: 'A walnut chair' }, { timeout: 100_000 });
    expect(screen.getByText('Suggested prompt')).toBeTruthy();
    expect(screen.getByText('Added the era, material and legs.')).toBeTruthy();
    expect(screen.getByText('Agent Mode · no credits · 26 of 30 left today')).toBeTruthy();
    click('Keep mine');
    expect(screen.queryByText('Suggested prompt')).toBeNull();
    expect(saved().prompt).toBe('A walnut chair');
    click('Polish prompt');
    await flush();
    click('Use this');
    expect(saved().prompt).toBe('A mid-century walnut lounge chair with tapered legs');
    expect(status()).toContain('Prompt replaced');
    await flush();
    click('Undo');
    expect(saved().prompt).toBe('A walnut chair');
    expect(button('Undo')).toBeNull();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(screen.getByTestId('route').textContent).toBe('/prompt');
  });

  it('disables Polish while the description is empty and makes the description read-only while it works', async () => {
    seed({ prompt: '' });
    await mount('/prompt');
    expect(button('Polish prompt')!.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Describe your shape'), { target: { value: 'A lamp' } });
    const call = pending();
    click('Polish prompt');
    expect(button('Working…')!.disabled).toBe(true);
    expect((screen.getByLabelText('Describe your shape') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(document.querySelector('.agent-panel')!.getAttribute('aria-busy')).toBe('true');
    expect(button('Suggest a template')!.disabled).toBe(false);
    await call.answer({ data: { status: 'declined', left: 5 } });
    expect(alert()).toBe('Agent Mode can’t help with that request. Nothing was changed.');
    expect(screen.getByText('Agent Mode · no credits · 5 of 30 left today')).toBeTruthy();
    expect((screen.getByLabelText('Describe your shape') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('suggests a template, and says so when it is already the template', async () => {
    seed();
    await mount('/prompt');
    mocks.agent.mockResolvedValueOnce(ok({ template: 'Quiet Space', reason: 'Warm sand suits natural wood.' }));
    click('Suggest a template');
    await flush();
    expect(mocks.agent).toHaveBeenCalledWith({ job: 'template', idea: 'A walnut chair' }, { timeout: 100_000 });
    expect(screen.getByText('Suggested template: Quiet Space')).toBeTruthy();
    expect(screen.getByText('Warm sand suits natural wood.')).toBeTruthy();
    click('Use it');
    expect(saved().template).toBe('Quiet Space');
    expect(screen.getByText('Suggested template: Quiet Space. It’s already your template.')).toBeTruthy();
    mocks.agent.mockResolvedValueOnce(ok({ template: 'Quiet Space', reason: 'Still the calmest.' }));
    click('Suggest a template');
    await flush();
    expect(screen.getByText('Suggested template: Quiet Space. It’s already your template.')).toBeTruthy();
    expect(button('Use it')).toBeNull();
  });

  it('suggests a template from the upload in Quick Generate, without Polish', async () => {
    seed({ inputMode: 'quick' });
    await mount('/prompt');
    expect(button('Suggest a template')).toBeNull();
    cleanup();
    seed({ inputMode: 'quick', uploadName: 'chair.png', uploadPath: 'uploads/user-a/chair.png' });
    await mount('/prompt');
    expect(button('Polish prompt')).toBeNull();
    expect(screen.getByText('Agent Mode sends what you type and your uploaded image to Anthropic\'s Claude. Depth doesn\'t store it.')).toBeTruthy();
    mocks.agent.mockResolvedValueOnce(ok({ template: 'Soft Studio', reason: 'Pale lavender flatters the fabric.' }));
    click('Suggest a template');
    await flush();
    expect(mocks.agent).toHaveBeenCalledWith({ job: 'template', imagePath: 'uploads/user-a/chair.png' }, { timeout: 100_000 });
    expect(screen.getByText('Suggested template: Soft Studio')).toBeTruthy();
  });
});

describe('Agent Mode scene edit', () => {
  it('applies the patch in one undo step and lists old and new values', async () => {
    seed();
    await mount('/motion');
    mocks.agent.mockResolvedValueOnce(ok({ patch: { motion: 'Float', speed: 0.5, lightingColor: '#ffc98a' }, summary: 'Slower float with a warm amber light.', unsupported: '' }));
    const field = describeChange('Float slower, warmer light');
    expect(document.activeElement).toBe(field);
    await flush();
    expect(mocks.agent).toHaveBeenCalledWith({ job: 'edit', request: 'Float slower, warmer light', current: expect.any(Object) }, { timeout: 100_000 });
    expect(Object.keys(sentCurrent()).sort()).toEqual([...editable].sort());
    expect(sentCurrent()).toMatchObject({ motion: 'Still', speed: 0.8, lightingColor: '#ffffff' });
    expect(saved()).toMatchObject({ motion: 'Float', speed: 0.5, lightingColor: '#ffc98a' });
    expect(status()).toBe('Motion Still → Float, Speed 0.8× → 0.5×, Lighting colour #ffffff → #ffc98a. Slower float with a warm amber light.Undo');
    expect(mocks.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    expect(saved()).toMatchObject({ motion: 'Still', speed: 0.8, lightingColor: '#ffffff' });
  });

  it('applies only editable keys, and the same box works on Scene with Apply', async () => {
    seed();
    await mount('/scene');
    mocks.agent.mockResolvedValueOnce(ok({ patch: { lighting: 'Dramatic', modelPath: 'models/x', headline: 'Hello' }, summary: 'Moodier light.', unsupported: 'The headline is set on Layout.' }));
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'moody, and say Hello' } });
    click('Apply');
    expect(document.activeElement).toBe(screen.getByLabelText('Describe a change'));
    await flush();
    expect(saved()).toMatchObject({ lighting: 'Dramatic', modelPath: '', headline: initialDraft.headline });
    expect(status()).toBe('Lighting Soft → Dramatic. Moodier light. Not changed: The headline is set on Layout.Undo');
  });

  it('keeps and names a field the designer changed during the call', async () => {
    seed();
    await mount('/motion');
    const call = pending();
    describeChange('warmer light');
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '1.5' } });
    await call.answer(ok({ patch: { speed: 0.5, lightingColor: '#ffc98a' }, summary: 'Slower with a warm light.', unsupported: '' }));
    expect(saved()).toMatchObject({ speed: 1.5, lightingColor: '#ffc98a' });
    expect(status()).toBe('Lighting colour #ffffff → #ffc98a. Slower with a warm light. Left Speed as you set it.Undo');
  });

  it('drops the background colour and template with a background the designer changed', async () => {
    seed();
    await mount('/scene');
    const call = pending();
    describeChange('our brand teal behind it');
    click('Background');
    click('White');
    await call.answer(ok({ patch: { background: 'Custom', backgroundColor: '#0f766e' }, summary: 'Brand teal backdrop.', unsupported: '' }));
    expect(saved()).toMatchObject({ background: 'White', backgroundColor: '#ffffff' });
    expect(status()).toBe('Left Background as you set it. Left Background colour as you set it.');
  });

  it('drops an answer that arrives after leaving the step', async () => {
    seed();
    await mount('/motion');
    const call = pending();
    describeChange('a bit faster');
    click('Next');
    expect(screen.getByTestId('route').textContent).toBe('/scene');
    await call.answer(ok({ patch: { speed: 1.2 }, summary: 'Faster.', unsupported: '' }));
    expect(saved().speed).toBe(0.8);
    expect(status()).toBe('');
  });

  it('hides the inline Undo after a later change, and says when there is nothing to change', async () => {
    seed();
    await mount('/motion');
    mocks.agent.mockResolvedValueOnce(ok({ patch: { motion: 'Float' }, summary: 'Floating.', unsupported: '' }));
    describeChange('float');
    await flush();
    expect(button('Undo')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'Amount' }), { target: { value: '60' } });
    expect(button('Undo')).toBeNull();
    expect(saved()).toMatchObject({ motion: 'Float', amount: 60 });
    mocks.agent.mockResolvedValueOnce(ok({ patch: {}, summary: 'Already floating.', unsupported: '' }));
    describeChange('float');
    await flush();
    expect(status()).toBe('Nothing to change.');
    mocks.agent.mockResolvedValueOnce(ok({ patch: {}, summary: 'Nothing changed.', unsupported: 'A new shape is made on the Prompt screen.' }));
    describeChange('turn it into a dragon');
    await flush();
    expect(status()).toBe('Nothing changed. Not changed: A new shape is made on the Prompt screen.');
    expect(saved()).toMatchObject({ motion: 'Float', amount: 60 });
  });

  it('is busy for one call at a time, keeps the controls usable and says Still working… after 15 seconds', async () => {
    vi.useFakeTimers();
    seed();
    await mount('/motion');
    const call = pending();
    const field = describeChange('slower');
    expect(button('Working…')!.disabled).toBe(true);
    expect(field.readOnly).toBe(true);
    expect(field.closest('form')!.getAttribute('aria-busy')).toBe('true');
    expect(status()).toBe('Agent Mode is working…');
    fireEvent.submit(field.closest('form')!);
    expect(mocks.agent).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('slider', { name: 'Amount' }), { target: { value: '70' } });
    expect(saved().amount).toBe(70);
    act(() => vi.advanceTimersByTime(14_999));
    expect(status()).toBe('Agent Mode is working…');
    act(() => vi.advanceTimersByTime(1));
    expect(status()).toBe('Still working…');
    await call.answer(ok({ patch: { speed: 0.5 }, summary: 'Slower.', unsupported: '' }));
    expect(button('Apply')!.disabled).toBe(false);
    expect(field.readOnly).toBe(false);
    expect(field.closest('form')!.getAttribute('aria-busy')).toBe('false');
    expect(status()).toBe('Speed 0.8× → 0.5×. Slower.Undo');
  });

  it.each([
    ['declined', { data: { status: 'declined', left: 4 } }, 'Agent Mode can’t help with that request. Nothing was changed.'],
    ['unusable', { data: { status: 'unusable', left: 4 } }, 'Agent Mode couldn’t make a usable suggestion. Nothing was changed. Try rewording it.'],
    ['the daily cap', { code: 'functions/resource-exhausted', message: 'Daily limit', details: { cap: 'daily' } }, 'You’ve used today’s 30 Agent Mode requests. Try again after midnight UTC.'],
    ['the monthly cap', { code: 'functions/resource-exhausted', message: 'Monthly limit', details: { cap: 'monthly' } }, 'Agent Mode has reached Depth’s limit for this month. It resets on the 1st.'],
    ['a bad input', { code: 'functions/invalid-argument', message: 'request must be 1 to 300 characters.' }, 'request must be 1 to 300 characters.'],
    ['unavailable', { code: 'functions/unavailable', message: 'Claude failed' }, 'Agent Mode is unavailable right now. Try again in a minute.'],
    ['unauthenticated', { code: 'functions/unauthenticated', message: '' }, 'Reload the page and try again.'],
    ['permission-denied', { code: 'functions/permission-denied', message: '' }, 'Your account can’t use Agent Mode. Sign in again or ask the project owner.'],
    ['no connection', new Error('Failed to fetch'), 'Agent Mode is unavailable right now. Try again in a minute.'],
    ['an unknown error', { code: 'functions/internal', message: 'INTERNAL' }, 'Agent Mode is unavailable right now. Try again in a minute.'],
  ])('shows the message for %s and changes nothing', async (_name, outcome, message) => {
    seed();
    await mount('/motion');
    const before = saved();
    const call = pending();
    describeChange('slower');
    if ('data' in outcome) await call.answer(outcome); else await call.fail(outcome);
    expect(alert()).toBe(message);
    expect(saved()).toEqual(before);
    expect(button('Apply')!.disabled).toBe(false);
  });
});

describe('Agent Mode copy ideas', () => {
  const ideas = [{ headline: 'Sit with\nsomething real.', buttonLabel: 'Shop chairs' }, { headline: 'Built for\nthe long run', buttonLabel: 'See the build' }, { headline: 'Walnut, warmly.', buttonLabel: 'Explore' }];

  it('shows three ideas, and Use this writes the headline and button text only, in one undo step', async () => {
    seed({ buttonUrl: 'https://example.test/chairs' });
    await mount('/layout');
    fireEvent.change(screen.getByLabelText('Tone or audience'), { target: { value: 'Calm, for interior designers' } });
    mocks.agent.mockResolvedValueOnce(ok({ ideas }));
    click('Suggest copy');
    await flush();
    expect(mocks.agent).toHaveBeenCalledWith({ job: 'copy', idea: 'A walnut chair', direction: 'Calm, for interior designers', template: 'Studio Glow', layout: 'Object Right', current: { eyebrow: initialDraft.eyebrow, headline: initialDraft.headline, subtitle: initialDraft.subtitle, buttonLabel: initialDraft.buttonLabel } }, { timeout: 100_000 });
    expect(screen.getAllByRole('button', { name: /^Use idea \d: / })).toHaveLength(3);
    click('Use idea 2: Built for the long run');
    expect(saved()).toMatchObject({ headline: 'Built for\nthe long run', buttonLabel: 'See the build', eyebrow: initialDraft.eyebrow, subtitle: initialDraft.subtitle, buttonUrl: 'https://example.test/chairs' });
    expect(status()).toContain('Headline and button text replaced');
    await flush();
    click('Undo');
    expect(saved()).toMatchObject({ headline: initialDraft.headline, buttonLabel: initialDraft.buttonLabel });
  });

  it('sends no idea from Quick Generate', async () => {
    seed({ inputMode: 'quick' });
    await mount('/layout');
    mocks.agent.mockResolvedValueOnce(ok({ ideas: ideas.slice(0, 1) }));
    click('Suggest copy');
    await flush();
    expect(mocks.agent.mock.calls[0][0]).toMatchObject({ job: 'copy', idea: '', direction: '' });
    expect(screen.getAllByRole('button', { name: /^Use idea \d: / })).toHaveLength(1);
  });
});
