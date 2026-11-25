// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The demo build: meshyProvider is fixed when jobs.ts loads, so this case has its own file.
const mocks = vi.hoisted(() => ({ callable: vi.fn() }));
vi.mock('./firebase', () => ({ firebaseServices: null, signOutUser: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.callable }));

import { Workflow } from './Workflow';
import { meshyProvider } from './jobs';
import { initialDraft, storageKey, type Draft } from './model';

function seed(patch: Partial<Draft>) { localStorage.setItem(storageKey('user-a'), JSON.stringify({ ...initialDraft, connected: true, shapeReady: true, lookReady: true, prompt: 'A walnut chair', ...patch })); }

beforeEach(() => { localStorage.clear(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Agent Mode in the demo build', () => {
  it.each([['/prompt', {}], ['/prompt', { inputMode: 'quick', uploadName: 'chair.png', uploadPath: 'uploads/user-a/chair.png' }], ['/motion', {}], ['/scene', {}], ['/layout', {}]] as const)('shows none of it on %s', (route, patch) => {
    expect(meshyProvider).toBe(false);
    seed(patch as Partial<Draft>);
    render(<MemoryRouter initialEntries={[route]}><Workflow uid="user-a"/></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    for (const name of ['Polish prompt', 'Suggest a template', 'Apply', 'Suggest copy']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByLabelText('Describe a change')).toBeNull();
    expect(screen.queryByLabelText('Tone or audience')).toBeNull();
    expect(screen.queryByText(/Anthropic|no credits/)).toBeNull();
    expect(document.querySelector('.agent-panel')).toBeNull();
    expect(mocks.callable).not.toHaveBeenCalled();
  });
});
