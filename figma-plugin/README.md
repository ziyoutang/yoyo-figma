# Depth for Figma

The Depth plugin places a published Depth hero in a Figma file as editable frames: the backdrop, the 3D model as an image, and the eyebrow, headline, subtitle and button as text you can edit. It reads the hero's public files from Depth's Storage, so it needs only the hero's link.

## Once per computer

1. Install the Figma desktop app for macOS or Windows and sign in. Development plugins don't run in the browser.
2. Get the plugin folder.
   - Developers: in the repo, run `npm ci`, then `npm run build:plugin`.
   - Everyone else: unzip the `figma-plugin` folder a developer sends you (`manifest.json` plus `dist/`).
3. Open any design file. From the Figma menu, choose **Plugins › Development › Import plugin from manifest…** and pick `figma-plugin/manifest.json`. Depth now appears under **Plugins › Development**.

## Each time

1. In Depth, finish the hero and open Complete.
2. Click **Send to Figma**. If the hero isn't published yet, this publishes it: anyone with its link can then view it and download its 3D model. The hero's link is copied.
3. In Figma, run **Plugins › Development › Depth** and paste the link. An embed code works too.
4. Choose **Place as**, then click **Place**.
   - **New Frame** makes new frames to the right of your work, already selected: 1440 × 836 for desktop and 390 × 546 for mobile, both for a hero made for Both.
   - **Replace Selection** fills one frame or shape you have already selected with the 3D model, fitted, and changes nothing else about it. With anything else selected, Place stays off and the panel says why.

Every text layer stays editable. The 3D model is an image of the hero at rest. The **Live hero** link under each frame opens the moving version.

## Good to know

- If Google Sans Flex isn't in your fonts, the text uses Inter and may wrap differently; the plugin tells you which texts did. Adding Google Sans Flex from Google Fonts and placing again matches the hero.
- The link works until the hero is unpublished, so you can place it again any time. **Copy embed code** in Your published heroes gives any live hero's code, which the plugin also takes.
- Placing again makes new frames; it never changes frames placed earlier. After editing the hero, click **Send to Figma** again: it updates the published hero, and the same link then places the new version.
- If the browser won't copy the link, Complete says "Copy the link below and paste it in the Depth plugin." Copy it from the **Hero link** box.
- "Paste the hero's link or embed code from Depth" means the pasted text had no hero in it. "This hero isn't published any more" means someone unpublished it. "Update this hero on Depth's Complete screen, then try again" means it was published before the plugin existed: **Send to Figma** (or **Update published hero**) on Complete fixes it. "Can't reach Depth. Check your connection and try again." means the plugin couldn't load the hero's files.
- If Depth disappears from the menu, import the manifest again. A rebuilt plugin restarts by itself.
- Placing costs no Meshy credits.

## For developers

- `npm run build:plugin` type-checks the plugin code (ES2020, Figma's typings, no DOM) and the panel (with DOM), builds `dist/code.js` and `dist/ui.html` with esbuild, and checks the output like `check:build`. `npm run watch:plugin` rebuilds on change.
- `node figma-plugin/build.mjs --emulators` reads from the Storage emulator at `http://127.0.0.1:9199` instead.
- The build fails if the plugin bundles Firebase, React, three.js or the studio modules that reach them. It shares only `src/figmaFrame.ts` and `src/figmaLayout.ts` with the studio.
- `manifest.json` carries a placeholder `id`, `depth-development`. If Import from manifest refuses it, make the entry once with **Plugins › Development › New plugin…** and put the id Figma gives into `manifest.json`.
- The plugin may only reach `https://firebasestorage.googleapis.com` (and the Storage emulator while developing). It holds no secrets: only the bucket name and the Hosting origin, in `src/config.ts`.
- The plugin's tests run with the studio's, in `npm test`.
- To check the plugin end to end in Figma, follow part C of [VERIFICATION.md](../VERIFICATION.md).
