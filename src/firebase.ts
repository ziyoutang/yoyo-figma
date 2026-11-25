import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseServices = Object.values(config).every(Boolean)
  ? (() => {
      // No bucket env var: the default bucket name follows the project id.
      const app = initializeApp({ ...config, storageBucket: `${config.projectId}.firebasestorage.app` });
      if (siteKey) {
        // Dev builds print a debug token in the console; register it once in App Check.
        if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
      }
      return { auth: getAuth(app), db: getFirestore(app), functions: getFunctions(app, 'us-west1'), storage: getStorage(app) };
    })()
  : null;

export async function signInWithGoogle() {
  if (!firebaseServices) throw new Error('Firebase is not configured.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(firebaseServices.auth, provider);
}

export async function signOutUser() {
  if (firebaseServices) await signOut(firebaseServices.auth);
}
