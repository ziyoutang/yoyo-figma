/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The public embed page must never load Firebase, the access gate or the studio. This fails `vite build` if any chunk
// the embed reaches contains one of them. Vite's manifest lists chunks but not their modules, so it can't see this.
const banned = [/\/node_modules\/(@firebase|firebase)\//, /\/src\/(AuthGate|Workflow|firebase|jobs)\.tsx?(\?|$)/];
function embedGuard(): Plugin {
  return {
    name: 'embed-guard',
    apply: 'build',
    generateBundle(_, bundle) {
      const chunks = new Map(Object.values(bundle).flatMap(file => file.type === 'chunk' ? [[file.fileName, file] as const] : []));
      const entry = [...chunks.values()].find(chunk => chunk.isEntry && Object.keys(chunk.modules).some(id => id.endsWith('/src/embed.tsx')));
      if (!entry) return this.error('embedGuard: no chunk contains src/embed.tsx.');
      const seen = new Set<string>(), queue = [entry.fileName];
      while (queue.length) {
        const chunk = chunks.get(queue.pop()!);
        if (!chunk || seen.has(chunk.fileName)) continue;
        seen.add(chunk.fileName);
        const found = Object.keys(chunk.modules).find(id => banned.some(pattern => pattern.test(id)));
        if (found) return this.error(`embedGuard: the embed page reaches ${found} through ${chunk.fileName}.`);
        queue.push(...chunk.imports, ...chunk.dynamicImports);
      }
    },
  };
}

// Serves /embed paths with embed.html in dev and preview, as Hosting's rewrite does.
const toEmbed: Connect.NextHandleFunction = (request, _response, next) => {
  if (request.url && /^\/embed(\/|\?|$)/.test(request.url)) request.url = '/embed.html';
  next();
};
const embedRoutes = (): Plugin => ({ name: 'embed-routes', configureServer: server => { server.middlewares.use(toEmbed); }, configurePreviewServer: server => { server.middlewares.use(toEmbed); } });

// Frontend and Figma plugin tests; functions/ runs its own.
export default defineConfig({
  plugins: [react(), embedRoutes(), embedGuard()],
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), embed: fileURLToPath(new URL('embed.html', import.meta.url)) } } },
  test: { include: ['src/**/*.test.{ts,tsx}', 'figma-plugin/src/**/*.test.ts'] },
});
