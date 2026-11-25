// Builds the Figma plugin: src/code.ts to dist/code.js, and src/ui.ts inlined into dist/ui.html. ES2020, as Figma's
// sandbox runs. --watch rebuilds on change (Figma restarts the plugin); --emulators reads from the Storage emulator.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

const plugin = dirname(fileURLToPath(import.meta.url)), root = join(plugin, '..'), dist = join(plugin, 'dist');
const watch = process.argv.includes('--watch'), emulators = process.argv.includes('--emulators');

// The plugin shares only pure code with the studio. Like embedGuard, this fails the build if anything it bundles is
// Firebase, React or three.js, or a studio module that reaches them, the DOM or localStorage.
const banned = [/(^|\/)node_modules\/(firebase|@firebase|react|react-dom|three)\//, /(^|\/)src\/(firebase|jobs|publishing|publish|model|measureLayout|HeroPreview|AuthGate|Workflow)\.tsx?$/];
function guard(name) {
  return {
    name: 'depth-plugin-guard',
    setup(build) {
      build.onEnd(result => {
        const found = result.metafile && Object.keys(result.metafile.inputs).find(input => banned.some(pattern => pattern.test(input)));
        if (found) return { errors: [{ text: `The plugin's ${name} reaches ${found}, which it must not bundle.` }] };
      });
    },
  };
}

// The panel is one HTML file with its script inlined, as Figma's `ui` expects.
const inlineUi = {
  name: 'depth-plugin-ui',
  setup(build) {
    build.onEnd(result => {
      if (result.errors.length) return;
      const script = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
      const html = readFileSync(join(plugin, 'src/ui.html'), 'utf8');
      if (!html.includes('<!-- ui.js -->')) return { errors: [{ text: 'src/ui.html has no <!-- ui.js --> marker.' }] };
      writeFileSync(join(dist, 'ui.html'), html.replace('<!-- ui.js -->', () => `<script>${script}</script>`));
    });
  },
};

const common = { absWorkingDir: root, bundle: true, format: 'iife', target: 'es2020', metafile: true, logLevel: 'info', define: { DEPTH_EMULATORS: String(emulators) } };
mkdirSync(dist, { recursive: true });
const builds = await Promise.all([
  context({ ...common, entryPoints: [relative(root, join(plugin, 'src/code.ts'))], outfile: relative(root, join(dist, 'code.js')), plugins: [guard('code')] }),
  context({ ...common, entryPoints: [relative(root, join(plugin, 'src/ui.ts'))], outfile: relative(root, join(dist, 'ui.js')), write: false, plugins: [guard('panel'), inlineUi] }),
]);
if (watch) await Promise.all(builds.map(build => build.watch()));
else {
  const results = await Promise.allSettled(builds.map(build => build.rebuild()));
  await Promise.all(builds.map(build => build.dispose()));
  if (results.some(result => result.status === 'rejected')) process.exit(1);
}
