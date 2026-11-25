// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workflow } from './Workflow';
import { initialDraft, storageKey, type Draft } from './model';

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('./firebase', () => ({ signOutUser: mocks.signOut }));
function HistoryControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <aside><output data-testid="route">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button><button onClick={() => navigate(1)}>Browser forward</button></aside>;
}
function mount(route = '/connect', uid = 'user-a') {
  return render(<MemoryRouter initialEntries={[route]}><Workflow key={uid} uid={uid}/><HistoryControls/></MemoryRouter>);
}
function seed(patch: Partial<Draft>, uid = 'user-a') {
  localStorage.setItem(storageKey(uid), JSON.stringify({ ...initialDraft, ...patch }));
}
function saved(uid = 'user-a'): Draft { return JSON.parse(localStorage.getItem(storageKey(uid)) || '{}'); }
function click(name: string | RegExp) { fireEvent.click(screen.getByRole('button', { name })); }
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function expectRoute(route: string) { expect(screen.getByTestId('route').textContent).toBe(route); }
function finishJob(review?: string) {
  act(() => vi.advanceTimersByTime(2300));
  if (review) click(review);
}
const ready: Partial<Draft> = { connected: true, shapeReady: true, lookReady: true, prompt: 'A sculpted ear' };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Depth workflow', () => {
  it('shows demo credits on keyboard focus or tap and dismisses the tooltip', () => {
    mount();
    const robot = screen.getByRole('button', { name: 'About demo credits' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent(robot, Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'mouse' }));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent(robot, Object.assign(new Event('pointerout', { bubbles: true }), { pointerType: 'mouse' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(robot);
    expect(screen.getByRole('tooltip').textContent).toContain('This demo uses 0 credits');
    expect(robot.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.blur(robot);
    fireEvent.pointerDown(robot);
    fireEvent.click(robot);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(robot);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(robot);
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Connect to Meshy' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(robot);
    fireEvent.blur(robot);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('traverses the complete demo from connection to completion without paid integrations', () => {
    mount();
    click('Continue with demo →');
    expectRoute('/prompt');
    expect((screen.getByRole('button', { name: 'Generate demo' }) as HTMLButtonElement).disabled).toBe(true);
    fill('Describe your shape', 'A sculpted ear with three piercings');
    click('Generate demo');
    expectRoute('/prompt?state=processing');
    expect(screen.getByRole('heading', { name: 'Shaping your idea…' })).toBeTruthy();
    finishJob('Review Shape');
    expectRoute('/shape');
    click('Looks Good, Continue!');
    fill('Describe the look', 'Warm sculpted bronze');
    click('Looks Good, Continue!');
    finishJob('Review Render');
    expectRoute('/render');
    click('Looks Good, Choose a Template!');
    click('Select');
    expectRoute('/motion');
    click('Float');
    click('Next');
    expectRoute('/scene');
    click('Next');
    expectRoute('/layout');
    fill('Headline', 'An ear for detail');
    fill('Button text', 'Explore');
    click('Next');
    expectRoute('/confirm');
    click('Simulate placement');
    finishJob();
    expectRoute('/complete');
    expect(screen.getByText('✓ Demo completed. No frame was added to Figma.')).toBeTruthy();
    expect(saved()).toMatchObject({ shapeReady: true, lookReady: true, placed: true, headline: 'An ear for detail', buttonLabel: 'Explore', motion: 'Float' });
    click('About GLB export');
    expect(screen.getByText(/No file has been generated or placed/)).toBeTruthy();
    click('Dismiss');
    click('Edit this Hero');
    expectRoute('/layout');
    expect((screen.getByLabelText('Headline') as HTMLTextAreaElement).value).toBe('An ear for detail');
  });

  it.each([
    { route: '/prompt', patch: { connected: true, prompt: 'A rounded ear' }, action: 'Generate demo', flag: 'shapeReady' },
    { route: '/appearance', patch: { connected: true, shapeReady: true }, action: 'Looks Good, Continue!', flag: 'lookReady' },
    { route: '/confirm', patch: ready, action: 'Simulate placement', flag: 'placed' },
  ])('cancels a simulated job started on $route without changing readiness', ({route, patch, action, flag}) => {
    seed(patch);
    mount(route);
    click(action);
    act(() => vi.advanceTimersByTime(600));
    click('Cancel');
    expectRoute(route);
    act(() => vi.advanceTimersByTime(5000));
    expectRoute(route);
    expect(saved()[flag as keyof Draft]).toBe(false);
    click(action);
    finishJob();
    expect(saved()[flag as keyof Draft]).toBe(true);
  });

  it('cancels processing on browser back and does not revive the job on forward', () => {
    seed({ connected: true, prompt: 'A rounded ear' });
    mount('/prompt');
    click('Generate demo');
    expectRoute('/prompt?state=processing');
    act(() => vi.advanceTimersByTime(500));
    click('Browser back');
    expectRoute('/prompt');
    act(() => vi.advanceTimersByTime(3000));
    expect(saved().shapeReady).toBe(false);
    click('Browser forward');
    expectRoute('/prompt');
    act(() => vi.advanceTimersByTime(3000));
    expect(saved().shapeReady).toBe(false);
  });

  it('returns to the first step from the logo without losing saved edits', () => {
    seed(ready);
    mount('/layout');
    fill('Headline', 'Keep my hero headline');
    click('Go to first step');
    expectRoute('/connect');
    expect(saved()).toMatchObject({ ...ready, headline: 'Keep my hero headline' });
    click(/Choose stage, current:/);
    click('Place in Figma');
    expectRoute('/layout');
    expect((screen.getByLabelText('Headline') as HTMLTextAreaElement).value).toBe('Keep my hero headline');
  });

  it.each([
    { route: '/prompt', patch: { connected: true, prompt: 'A rounded ear' }, action: 'Generate demo', flag: 'shapeReady' },
    { route: '/appearance', patch: { connected: true, shapeReady: true }, action: 'Looks Good, Continue!', flag: 'lookReady' },
    { route: '/confirm', patch: ready, action: 'Simulate placement', flag: 'placed' },
  ])('cancels the pending $route simulation when the logo is clicked', ({ route, patch, action, flag }) => {
    seed({ ...patch, headline: 'Keep my draft' });
    mount(route);
    click(action);
    act(() => vi.advanceTimersByTime(600));
    click('Go to first step');
    expectRoute('/connect');
    act(() => vi.advanceTimersByTime(5000));
    expectRoute('/connect');
    expect(saved()[flag as keyof Draft]).toBe(false);
    expect(saved().headline).toBe('Keep my draft');
    click('Browser back');
    expectRoute(route);
    act(() => vi.advanceTimersByTime(3000));
    expect(saved()[flag as keyof Draft]).toBe(false);
  });

  it('keeps fine-tune history and lets users restore a previous prompt', () => {
    seed({ connected: true, prompt: 'First ear' });
    mount('/prompt');
    click('Generate demo');
    finishJob('Review Shape');
    click('Good, But Fine Tune!');
    fill('Refine your shape description', 'Second ear with wider shape');
    click('Regenerate demo shape');
    finishJob('Review Shape');
    click('Good, But Fine Tune!');
    expect(saved().previousPrompts).toEqual(['Second ear with wider shape', 'First ear']);
    expect(screen.getByText('Previous prompt: Second ear with wider shape')).toBeTruthy();
    fireEvent.click(screen.getByText('Version history'));
    click('First ear');
    expect((screen.getByLabelText('Refine your shape description') as HTMLTextAreaElement).value).toBe('First ear');
    click('Back');
    expectRoute('/shape');
    click('Not at all… Edit Prompt');
    expect((screen.getByLabelText('Describe your shape') as HTMLTextAreaElement).value).toBe('First ear');
  });

  it('preserves material, motion, scene and layout edits through reversals and browser history', () => {
    seed(ready);
    mount('/materials');
    click('Metallic');
    fill('Primary material color', '#117799');
    fill('Secondary material color', '#ffeebb');
    expect(screen.queryByLabelText('Additional material description')).toBeNull();
    click('Back');
    click('Add Manual Options');
    expect(screen.getByRole('button', { name: 'Metallic' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Primary material color') as HTMLInputElement).value).toBe('#117799');
    click('Looks Good, Continue!');
    finishJob('Review Render');
    click('Looks Good, Choose a Template!');
    click('Next template');
    click('Select');
    click('Sway');
    fireEvent.change(screen.getByRole('slider', { name: /Speed/ }), { target: { value: '1.5' } });
    click('Next');
    click('Push-in');
    click('Lighting');
    click('Dramatic');
    click('Background');
    click('Mint');
    click('Next');
    click('Both');
    click('Centered');
    fill('Headline', 'Saved headline');
    click('Back to Scene');
    click('Back to Object Motion');
    expect(screen.getByRole('button', { name: 'Sway' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('slider', { name: /Speed/ }) as HTMLInputElement).value).toBe('1.5');
    click('Browser back');
    expectRoute('/scene');
    click('Browser forward');
    expectRoute('/motion');
    expect(saved()).toMatchObject({ material: 'Metallic', color: '#117799', secondColor: '#ffeebb', template: 'Quiet Space', motion: 'Sway', speed: 1.5, camera: 'Push-in', lighting: 'Dramatic', background: 'Mint', frame: 'Both', layout: 'Centered', headline: 'Saved headline' });
  });

  it.each([
    [{}, '/layout', '/connect'],
    [{ connected: true }, '/render', '/prompt'],
    [{ connected: true, shapeReady: true }, '/motion', '/appearance'],
    [ready, '/complete', '/confirm'],
    [ready, '/prompt?state=processing', '/prompt'],
    [{}, '/unknown', '/connect'],
  ] as [Partial<Draft>, string, string][])('guards unavailable or interrupted routes %#', (patch, requested, expected) => {
    seed(patch);
    mount(requested);
    expectRoute(expected);
    act(() => vi.advanceTimersByTime(5000));
    expectRoute(expected);
  });

  it('restores a local draft on remount and never loads another UID’s draft', () => {
    seed(ready);
    const first = mount('/layout');
    fill('Headline', 'User A’s private draft');
    first.unmount();
    const restored = mount('/layout');
    expect((screen.getByLabelText('Headline') as HTMLTextAreaElement).value).toBe('User A’s private draft');
    restored.unmount();
    const second = mount('/layout', 'user-b');
    expectRoute('/connect');
    expect(screen.queryByText('User A’s private draft')).toBeNull();
    click('Continue with demo →');
    fill('Describe your shape', 'User B’s shape');
    expect(saved('user-a').headline).toBe('User A’s private draft');
    expect(saved('user-b').prompt).toBe('User B’s shape');
    expect(saved('user-b').headline).toBe(initialDraft.headline);
    second.unmount();
    mount('/layout', 'user-a');
    expect((screen.getByLabelText('Headline') as HTMLTextAreaElement).value).toBe('User A’s private draft');
  });

  it('preserves quick-generation selection and supports the sample path', () => {
    seed({ connected: true });
    mount('/prompt');
    click('Quick Generate');
    click('Try tree sample');
    click('Agent Mode');
    expect((screen.getByLabelText('Describe your shape') as HTMLTextAreaElement).value).toBe('A detailed tree');
    click('Quick Generate');
    expect(screen.getByRole('button', { name: 'tree sample' })).toBeTruthy();
    click('Generate demo');
    finishJob('Review Shape');
    click('Looks Good, Continue!');
    click('Skip, use the template’s look');
    expectRoute('/templates');
    expect(saved().uploadName).toBe('tree sample');
    expect(saved().lookReady).toBe(true);
  });

  it('undoes and redoes composition edits, and clears redo after a new edit', () => {
    seed(ready);
    mount('/motion');
    expect((screen.getByRole('button', { name: 'Undo edit' }) as HTMLButtonElement).disabled).toBe(true);
    click('Float');
    click('Sway');
    click('Undo edit');
    expect(saved().motion).toBe('Float');
    click('Redo edit');
    expect(saved().motion).toBe('Sway');
    click('Undo edit');
    click('Slide');
    expect(saved().motion).toBe('Slide');
    expect((screen.getByRole('button', { name: 'Redo edit' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews a custom background immediately and preserves its color when switching presets', () => {
    seed(ready);
    mount('/scene');
    click('Background');
    click('Custom');
    fill('Background color', '#123abc');
    const preview = screen.getAllByLabelText('Illustrative hero composition')[0] as HTMLElement;
    expect(preview.classList.contains('bg-custom')).toBe(true);
    expect(preview.style.getPropertyValue('--background-color')).toBe('#123abc');
    expect(screen.getByText('#123ABC')).toBeTruthy();
    for (const preset of ['Template', 'White', 'Mint']) {
      click(preset);
      expect(preview.classList.contains(`bg-${preset.toLowerCase()}`)).toBe(true);
      expect(saved().backgroundColor).toBe('#123abc');
    }
    click('Custom');
    expect((screen.getByLabelText('Background color') as HTMLInputElement).value).toBe('#123abc');
    click('Undo edit');
    expect(saved().background).toBe('Mint');
    click('Redo edit');
    expect(saved().background).toBe('Custom');
    fill('Background color', '#fedcba');
    click('Undo edit');
    expect((screen.getByLabelText('Background color') as HTMLInputElement).value).toBe('#123abc');
    click('Redo edit');
    expect(preview.style.getPropertyValue('--background-color')).toBe('#fedcba');
  });

  it('combines lighting color with every lighting preset and supports neutral reset and undo', () => {
    seed(ready);
    mount('/scene');
    click('Lighting');
    const preview = screen.getAllByLabelText('Illustrative hero composition')[0] as HTMLElement;
    expect((screen.getByLabelText('Lighting color') as HTMLInputElement).value).toBe('#ffffff');
    expect(preview.style.getPropertyValue('--lighting-glow')).toBe('transparent');
    fill('Lighting color', '#cc4488');
    expect(screen.getByText('#CC4488')).toBeTruthy();
    for (const preset of ['Soft', 'Bright', 'Dramatic']) {
      click(preset);
      expect(screen.getByRole('button', { name: preset }).getAttribute('aria-pressed')).toBe('true');
      expect(preview.classList.contains(`light-${preset.toLowerCase()}`)).toBe(true);
      expect(preview.style.getPropertyValue('--lighting-glow')).toBe('#cc4488');
      expect(saved()).toMatchObject({ lighting: preset, lightingColor: '#cc4488' });
    }
    click('Reset to white');
    expect(saved()).toMatchObject({ lighting: 'Dramatic', lightingColor: '#ffffff' });
    expect(preview.style.getPropertyValue('--lighting-glow')).toBe('transparent');
    click('Undo edit');
    expect((screen.getByLabelText('Lighting color') as HTMLInputElement).value).toBe('#cc4488');
    click('Redo edit');
    expect(preview.style.getPropertyValue('--lighting-glow')).toBe('transparent');
  });

  it('retains scene colors in later and expanded previews, browser history, reload and separate user drafts', () => {
    seed(ready);
    const first = mount('/scene');
    click('Background');
    click('Custom');
    fill('Background color', '#223355');
    click('Lighting');
    fill('Lighting color', '#eeaa66');
    const expectColors = () => {
      for (const preview of screen.getAllByLabelText('Illustrative hero composition') as HTMLElement[]) {
        expect(preview.classList.contains('bg-custom')).toBe(true);
        expect(preview.style.getPropertyValue('--background-color')).toBe('#223355');
        expect(preview.style.getPropertyValue('--lighting-glow')).toBe('#eeaa66');
      }
    };
    expectColors();
    click('Next');
    expectRoute('/layout');
    click('Both');
    expectColors();
    click('Browser back');
    expectRoute('/scene');
    expectColors();
    click('Browser forward');
    expectRoute('/layout');
    click('Next');
    expectColors();
    click('Simulate placement');
    finishJob();
    expectRoute('/complete');
    expectColors();
    first.unmount();
    const restored = mount('/scene');
    expectColors();
    expect(saved()).toMatchObject({ background: 'Custom', backgroundColor: '#223355', lightingColor: '#eeaa66' });
    restored.unmount();
    seed(ready, 'user-b');
    mount('/scene', 'user-b');
    expect(saved('user-b')).toMatchObject({ background: 'Template', backgroundColor: '#ffffff', lightingColor: '#ffffff' });
    expect(saved('user-a')).toMatchObject({ background: 'Custom', backgroundColor: '#223355', lightingColor: '#eeaa66' });
  });

  it('loads older drafts with neutral scene colors while retaining their preset selections', () => {
    const oldDraft: Partial<Draft> = { ...initialDraft, ...ready, lighting: 'Dramatic', background: 'Mint' };
    delete oldDraft.backgroundColor;
    delete oldDraft.lightingColor;
    localStorage.setItem(storageKey('user-a'), JSON.stringify(oldDraft));
    mount('/scene');
    expect(saved()).toMatchObject({ lighting: 'Dramatic', background: 'Mint', backgroundColor: '#ffffff', lightingColor: '#ffffff' });
    click('Lighting');
    expect(screen.getByRole('button', { name: 'Dramatic' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Lighting color') as HTMLInputElement).value).toBe('#ffffff');
    click('Background');
    expect(screen.getByRole('button', { name: 'Mint' }).getAttribute('aria-pressed')).toBe('true');
    click('Custom');
    expect((screen.getByLabelText('Background color') as HTMLInputElement).value).toBe('#ffffff');
  });

  it('recovers malformed saved values while preserving valid draft fields', () => {
    localStorage.setItem(storageKey('user-a'), JSON.stringify({
      ...initialDraft, ...ready, prompt: { invalid: true }, headline: 'Keep this valid headline',
      previousPrompts: [null, 42], speed: 'fast', amount: 900, lookPrompt: null, placed: 'yes',
    }));
    const first = mount('/motion');
    expect((screen.getByRole('slider', { name: /Speed/ }) as HTMLInputElement).value).toBe('0.8');
    expect((screen.getByRole('slider', { name: /Amount/ }) as HTMLInputElement).value).toBe('100');
    expect(saved()).toMatchObject({ prompt: '', previousPrompts: [], speed: 0.8, amount: 100, lookPrompt: '', placed: false, headline: 'Keep this valid headline' });
    first.unmount();
    localStorage.setItem(storageKey('user-a'), '{broken JSON');
    mount('/layout');
    expectRoute('/connect');
    expect(saved().connected).toBe(false);
  });

  it('reports local saving failure accurately while leaving editing functional', () => {
    seed({ connected: true });
    mount('/prompt');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    fill('Describe your shape', 'Still editable');
    expect(screen.getByText('Not saved — device storage unavailable')).toBeTruthy();
    expect((screen.getByLabelText('Describe your shape') as HTMLTextAreaElement).value).toBe('Still editable');
  });

  it('calls sign-out and presents a retryable error if it fails', async () => {
    mocks.signOut.mockRejectedValueOnce(new Error('Network unavailable'));
    mount();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    click(/Choose stage, current:/);
    await act(async () => click('Sign out'));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toBe('Sign-out failed. Please try again.');
  });
});
