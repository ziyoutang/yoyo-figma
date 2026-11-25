import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import firebase from '../firebase.json';
import { steps } from './model';

const { rewrites, headers } = firebase.hosting;
// Hosting globs here use only `**` and `*`; regexes use syntax RE2 and JavaScript share, so they run as written.
const matcher = (rule: {source?: string; regex?: string}) => new RegExp(rule.regex ?? `^${rule.source!.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*?/g, star => star === '**' ? '.*' : '[^/]*')}$`);
const headerRules = headers.map(rule => ({ test: matcher(rule), values: Object.fromEntries(rule.headers.map(({ key, value }) => [key, value])) }));
const matching = (path: string) => headerRules.filter(rule => rule.test.test(path));
// What Hosting sends: every matching rule applies, and a later rule's value wins.
const sent = (path: string): Record<string, string> => Object.assign({}, ...matching(path).map(rule => rule.values));
const [embedRewrite, studioRewrite] = rewrites.map(matcher);
const framing = { 'Content-Security-Policy': 'frame-ancestors \'self\'' };
const studio = { 'Cache-Control': 'no-cache', ...framing }, embed = { 'Cache-Control': 'no-cache' };
// 392a580's page rule: any path without a dot, plus /index.html.
const before = /^\/([^.]*|index\.html)$/;
// A path inside one of public/'s folders that isn't a file still gets the studio page.
const folders = readdirSync('public', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

const embedPaths = ['/embed', '/embed/', '/embed/abcdefghij0123456789', '/embed/abcdefghij0123456789/', '/embed/x/y'];
const studioPaths = ['/', '/index.html', ...steps.map(step => `/${step}`), '/x/y', '/e', '/em', '/emb', '/embe', '/embedded', '/embeds/x', '/e/embed', '/Embed', '/layout/embed',
  ...folders.flatMap(folder => [`/${folder}`, `/${folder}/x`, `/${folder}/x/`, `/${folder}/a/b`])];
// No file has these paths, so the catch-all serves them the studio page as well.
const dottedStudioPaths = ['/complete.x', '/a/b.c', '/favicon.ico', '/embedx.y', '/x/embed.html', '/assets/gone-Cbd-1RwF.js', '/hdri/gone.hdr'];

describe('hosting', () => {
  it('serves every /embed path with the embed page, before the catch-all', () => {
    expect(rewrites.map(rule => rule.destination)).toEqual(['/embed.html', '/index.html']);
    for (const path of embedPaths) expect(embedRewrite.test(path), path).toBe(true);
    for (const path of [...studioPaths, ...dottedStudioPaths]) expect(embedRewrite.test(path), path).toBe(false);
    expect(studioRewrite.test('/anything')).toBe(true);
  });

  it('gives embed pages no-cache and no framing header, and studio pages no-cache with frame-ancestors self', () => {
    for (const path of embedPaths) expect(sent(path), path).toEqual(embed);
    for (const path of studioPaths) expect(sent(path), path).toEqual(studio);
  });

  it('keeps studio paths with a dot from being framed', () => {
    for (const path of dottedStudioPaths) expect(sent(path)['Content-Security-Policy'], path).toBe(framing['Content-Security-Policy']);
  });

  it('caches scripts for an hour and HDRIs for a day, and sets each header on a file from one rule', () => {
    expect(sent('/assets/embed-D05qyIh0.js')).toEqual({ 'Cache-Control': 'public,max-age=3600', ...framing });
    expect(sent('/hdri/soft.hdr')).toEqual({ 'Cache-Control': 'public,max-age=86400', ...framing });
    const files = readdirSync('public', { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `/${entry.parentPath.replace(/^public\/?/, '')}/${entry.name}`.replace('//', '/'));
    expect(files.length).toBeGreaterThan(10);
    for (const path of [...files, '/embed.html', '/assets/index-Cbd-1RwF.js']) {
      const keys = matching(path).flatMap(rule => Object.keys(rule.values));
      expect(keys.length, path).toBe(new Set(keys).size);
    }
    // Only /embed paths can be framed; the page's own file, which nothing links to, can't.
    expect(sent('/embed.html')).toEqual(framing);
  });

  it('frames every path except the embed pages, and keeps 392a580\'s pages no-cache', () => {
    const segments = ['', 'e', 'em', 'emb', 'embe', 'embed', 'embedx', 'embed.html', 'x', 'index.html', 'a.b', 'E', ...folders];
    const paths = new Set<string>([...embedPaths, ...studioPaths, ...dottedStudioPaths]);
    for (const a of segments) {
      paths.add(`/${a}`);
      for (const b of segments) {
        paths.add(`/${a}/${b}`);
        for (const c of segments) paths.add(`/${a}/${b}/${c}`);
      }
    }
    for (const path of paths) {
      expect(sent(path)['Content-Security-Policy'], path).toBe(embedRewrite.test(path) ? undefined : framing['Content-Security-Policy']);
      expect(sent(path)['Cache-Control'] === 'no-cache', path).toBe(before.test(path));
    }
    expect(paths.size).toBeGreaterThan(2500);
  });
});
