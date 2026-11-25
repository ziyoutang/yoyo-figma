// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const mocks = vi.hoisted(() => ({
  authListener: undefined as undefined | ((user: unknown) => void),
  snapshotListener: undefined as undefined | ((snapshot: unknown) => void),
  snapshotError: undefined as undefined | (() => void),
  signIn: vi.fn(), signOut: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('./firebase', () => ({
  firebaseServices: { auth: {}, db: {} }, signInWithGoogle: mocks.signIn, signOutUser: mocks.signOut,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, listener: (user: unknown) => void) => {
    mocks.authListener = listener;
    return vi.fn();
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: (_doc: unknown, _options: unknown, listener: (value: unknown) => void, error: () => void) => {
    mocks.snapshotListener = listener;
    mocks.snapshotError = error;
    return mocks.unsubscribe;
  },
}));

const user = { uid: 'user-a', email: 'member@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
const snapshot = (exists: boolean, enabled: boolean, fromCache = false) => ({ metadata: { fromCache }, exists: () => exists, data: () => ({ enabled }) });
function mount() {
  render(<AuthGate>{current => <div>Studio for {current.uid}</div>}</AuthGate>);
}
beforeEach(() => { vi.clearAllMocks(); mocks.snapshotListener = undefined; mocks.snapshotError = undefined; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Google access gate', () => {
  it('offers Google sign-in after session restoration', async () => {
    mount();
    act(() => mocks.authListener?.(null));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })); });
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });
  it('waits for server access confirmation, then opens the studio', () => {
    mount();
    act(() => mocks.authListener?.(user));
    act(() => mocks.snapshotListener?.(snapshot(true, true, true)));
    expect(screen.queryByText('Studio for user-a')).toBeNull();
    act(() => mocks.snapshotListener?.(snapshot(true, true)));
    expect(screen.getByText('Studio for user-a')).toBeTruthy();
  });
  it.each([[false, false], [true, false]])('denies missing/disabled access (%s, %s)', (exists, enabled) => {
    mount();
    act(() => mocks.authListener?.(user));
    act(() => mocks.snapshotListener?.(snapshot(exists, enabled)));
    expect(screen.getByText('This studio is invite-only')).toBeTruthy();
    expect(screen.queryByText('Studio for user-a')).toBeNull();
  });
  it('revokes open access when the server disables it', () => {
    mount();
    act(() => mocks.authListener?.(user));
    act(() => mocks.snapshotListener?.(snapshot(true, true)));
    act(() => mocks.snapshotListener?.(snapshot(true, false)));
    expect(screen.queryByText('Studio for user-a')).toBeNull();
  });
  it('closes access and times out if server confirmation is lost', () => {
    vi.useFakeTimers();
    mount();
    act(() => mocks.authListener?.(user));
    act(() => mocks.snapshotListener?.(snapshot(true, true)));
    expect(screen.getByText('Studio for user-a')).toBeTruthy();
    act(() => mocks.snapshotListener?.(snapshot(true, true, true)));
    expect(screen.queryByText('Studio for user-a')).toBeNull();
    expect(screen.getByText('Opening your studio')).toBeTruthy();
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByText('We couldn’t check access')).toBeTruthy();
  });
  it('shows a retry action on an access-check error', () => {
    mount();
    act(() => mocks.authListener?.(user));
    act(() => mocks.snapshotError?.());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Opening your studio')).toBeTruthy();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
  it('fails closed when access cannot be confirmed in time', () => {
    vi.useFakeTimers();
    mount();
    act(() => mocks.authListener?.(user));
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByText('We couldn’t check access')).toBeTruthy();
  });
  it('rejects unverified identities before reading access data', () => {
    mount();
    act(() => mocks.authListener?.({ ...user, emailVerified: false }));
    expect(screen.getByText('This studio is invite-only')).toBeTruthy();
    expect(mocks.snapshotListener).toBeUndefined();
  });
  it('unmounts the studio on sign-out and checks a new account separately', () => {
    mount();
    act(() => mocks.authListener?.(user));
    act(() => mocks.snapshotListener?.(snapshot(true, true)));
    act(() => mocks.authListener?.(null));
    expect(screen.queryByText('Studio for user-a')).toBeNull();
    act(() => mocks.authListener?.({ ...user, uid: 'user-b' }));
    expect(screen.queryByText('Studio for user-b')).toBeNull();
  });
});
