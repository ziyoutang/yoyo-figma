/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_JOB_PROVIDER?: 'meshy' | 'demo'; readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string; }
// Set in dev builds so App Check prints a debug token for localhost.
declare var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
