import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebaseServices, signInWithGoogle, signOutUser } from './firebase';
import { meshyProvider } from './jobs';

type Access = 'checking' | 'allowed' | 'denied' | 'error';

export function AuthGate({ children }: { children: (user: { uid: string }) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [access, setAccess] = useState<Access>('checking');
  const [checkedUid, setCheckedUid] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!firebaseServices) return;
    return onAuthStateChanged(firebaseServices.auth, next => {
      setAccess('checking');
      setCheckedUid(null);
      setUser(next);
      setInitializing(false);
      setMessage('');
    }, () => {
      setInitializing(false);
      setAccess('error');
      setMessage('We could not restore your session. Please refresh and try again.');
    });
  }, []);

  useEffect(() => {
    if (!user || !firebaseServices) return;
    setAccess('checking');
    setCheckedUid(null);
    if (!user.emailVerified || !user.email || !user.providerData.some(p => p.providerId === 'google.com')) {
      setAccess('denied');
      return;
    }
    let timeout: number | null = null;
    const waitForServer = () => {
      if (timeout !== null) return;
      setAccess('checking');
      setCheckedUid(null);
      timeout = window.setTimeout(() => setAccess('error'), 12000);
    };
    const clearTimeout = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    waitForServer();
    const offline = () => { setAccess('error'); setCheckedUid(null); };
    const online = () => setRetry(value => value + 1);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    const unsubscribe = onSnapshot(
      doc(firebaseServices.db, 'allowedUsers', user.email),
      { includeMetadataChanges: true },
      snapshot => {
        // Only a server-confirmed result can unlock the app, including after reload.
        if (snapshot.metadata.fromCache) { waitForServer(); return; }
        clearTimeout();
        setCheckedUid(user.uid);
        setAccess(snapshot.exists() && snapshot.data().enabled === true ? 'allowed' : 'denied');
      },
      () => { clearTimeout(); setAccess('error'); setCheckedUid(null); },
    );
    return () => {
      unsubscribe();
      clearTimeout();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [user, retry]);

  async function login() {
    setBusy(true);
    setMessage('');
    try { await signInWithGoogle(); }
    catch (error) {
      const code = (error as { code?: string }).code;
      setMessage(code === 'auth/popup-closed-by-user'
        ? 'Sign-in was cancelled. You can try again.'
        : code === 'auth/popup-blocked'
          ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
          : 'Google sign-in did not complete. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function switchAccount() {
    setBusy(true);
    setMessage('');
    try { await signOutUser(); }
    catch { setMessage('Sign-out failed. Please try again.'); }
    finally { setBusy(false); }
  }

  if (user && access === 'allowed' && checkedUid === user.uid) return children({ uid: user.uid });

  const missingConfig = !firebaseServices;
  const checking = !missingConfig && (initializing || (user && access === 'checking'));
  const title = missingConfig ? 'Your studio is almost ready'
    : checking ? 'Opening your studio'
      : user && access === 'denied' ? 'This studio is invite-only'
        : access === 'error' ? 'We couldn’t check access'
          : 'Bring a new dimension to your ideas.';
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-logo">depth<span>✳</span></div>
        <span className="auth-tag">DESIGN IN A NEW DIMENSION</span>
        <h1 id="auth-title">{title}</h1>
        <p>{missingConfig ? 'Firebase setup is pending. Once connected, sign in with Google to explore the Depth demo.'
          : checking ? 'Checking your Google account and studio access…'
            : user && access === 'denied' ? 'Your Google account does not currently have access. Ask the project owner for an invitation, or choose another account.'
              : access === 'error' ? 'Check your internet connection, then try again. Your draft is still saved on this device.'
                : meshyProvider ? 'Create, compose, and explore your next 3D hero. Sign in to enter Depth.'
                  : 'Create, compose, and explore your next 3D hero. Sign in to enter the Depth frontend demo.'}</p>
        {checking && <div role="status" className="auth-message">Loading…</div>}
        {!missingConfig && !initializing && !user && <button className="primary-button" disabled={busy} onClick={login}>{busy ? 'Connecting…' : 'Continue with Google'}</button>}
        {user && access === 'error' && <button className="primary-button" onClick={() => setRetry(value => value + 1)}>Try again</button>}
        {user && !checking && <button className="secondary-button" disabled={busy} onClick={switchAccount}>Use another account</button>}
        {message && <p className="auth-message" role="alert">{message}</p>}
        <small>{meshyProvider ? 'Shapes by Meshy · 20 credits each' : 'Demo experience · No model-generation charges'}</small>
      </section>
    </main>
  );
}
