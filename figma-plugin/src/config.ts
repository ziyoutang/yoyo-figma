// Public values only: the project's Storage bucket, where published heroes live, and its Hosting site, whose
// /embed/{heroId} links the plugin takes. `build.mjs --emulators` reads from the Storage emulator instead.
declare const DEPTH_EMULATORS: boolean | undefined;
export const bucket = 'depth-plugin-demo-20261006.firebasestorage.app';
export const storageOrigin = typeof DEPTH_EMULATORS !== 'undefined' && DEPTH_EMULATORS ? 'http://127.0.0.1:9199' : 'https://firebasestorage.googleapis.com';
export const hostingOrigin = 'https://depth-plugin-demo-20261006.web.app';
