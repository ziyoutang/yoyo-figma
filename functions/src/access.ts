import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';

// Server-side twin of AuthGate and firestore.rules: a verified Google account whose
// allowedUsers/{email} document has enabled: true. Every paid function must call this first.
export async function requireAllowedUser(auth: CallableRequest['auth']) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { email, email_verified: verified, firebase } = auth.token;
  if (!email || verified !== true || firebase.sign_in_provider !== 'google.com') throw new HttpsError('permission-denied', 'A verified Google account is required.');
  const access = await getFirestore().doc(`allowedUsers/${email}`).get();
  if (access.get('enabled') !== true) throw new HttpsError('permission-denied', 'This account does not have access.');
  return { uid: auth.uid, email };
}
