# Depth · yoyo-figma

A 3D hero design studio and companion Figma plugin by Ziyou (Yoyo) Tang.

Depth turns a text prompt or image into a 3D model, then brings model review, materials, motion, lighting, responsive layouts, export, and Figma handoff into one workflow. Its optional AI tools help refine prompts, suggest compositions and copy, and adjust scene settings.

[Portfolio](https://yoyo-personal-portfolio.web.app/#/project/depth) · [Studio](https://depth-plugin-demo-20261006.web.app/)

The hosted studio requires an invited Google account. Making this source public does not change access to that service.

## Project structure

- `src/`: React, TypeScript, Three.js, and React Three Fiber studio and embed viewer.
- `figma-plugin/`: plugin that places published heroes as editable Figma frames.
- `functions/`: Firebase Functions for Meshy generation, publishing, and AI assistance.
- `public/`: sample models, textures, icons, and fonts.

## Local development

Use Node.js 22 or newer.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with your own Firebase web-app configuration. The app shows a setup notice until Firebase is configured. The hosted service's access list still applies if you point a local build at it.

Use `VITE_JOB_PROVIDER=demo` for simulated generation without paid provider requests. Production uses Meshy; running real generation requires an authorized backend and spends provider credits. Backend secrets belong in Firebase Secret Manager, never in browser configuration or committed files.

## Checks and builds

```sh
npm test
npm run build
npm run build:plugin
```

For the backend tests:

```sh
npm --prefix functions ci
npm --prefix functions test
```

See [the plugin guide](figma-plugin/README.md) for installing and using the development plugin. Configure your own Firebase project and credentials before running deployment scripts.

## Public source copy

This is a source snapshot of the project's committed main branch. Private history, credentials, local environment files, and internal handoff documents are not included. No access to the hosted studio or its data is granted by this repository.
