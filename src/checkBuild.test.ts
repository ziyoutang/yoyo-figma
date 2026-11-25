import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/check-build.mjs');
const bucket = `${JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default}.firebasestorage.app`;
const folders: string[] = [];

// Runs check:build on a dist/ holding only an embed chunk with this text, and a Figma plugin build when `plugin` is given.
function checkBuild(embed: string | null, plugin?: string, args: string[] = []) {
  const folder = mkdtempSync(join(tmpdir(), 'check-build-'));
  folders.push(folder);
  copyFileSync('.firebaserc', join(folder, '.firebaserc'));
  if (embed !== null) {
    mkdirSync(join(folder, 'dist/assets'), { recursive: true });
    writeFileSync(join(folder, 'dist/assets/embed-Ab12Cd34.js'), embed);
  }
  if (plugin !== undefined) {
    mkdirSync(join(folder, 'figma-plugin/dist'), { recursive: true });
    writeFileSync(join(folder, 'figma-plugin/dist/code.js'), plugin);
    writeFileSync(join(folder, 'figma-plugin/dist/ui.html'), '<script></script>');
  }
  return execFileSync(process.execPath, [script, ...args], { cwd: folder, encoding: 'utf8', stdio: 'pipe' });
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true }); });

describe('check:build', () => {
  it('passes an embed page that reads from the project\'s bucket', () => {
    expect(checkBuild(`const b="${bucket}";`)).toMatch(/^Checked 1 production text assets/);
  });

  it('fails an embed page built without the project id, as a build without .env.local is', () => {
    expect(() => checkBuild('const b="undefined.firebasestorage.app";')).toThrow(bucket);
    expect(() => checkBuild('const b=`${void 0}.firebasestorage.app`;')).toThrow(bucket);
  });

  it('scans the Figma plugin\'s build too, when there is one', () => {
    expect(checkBuild(`const b="${bucket}";`, 'figma.showUI(__html__);')).toMatch(/^Checked 3 production text assets/);
    expect(() => checkBuild(`const b="${bucket}";`, 'const owner="someone@gmail.com";')).toThrow('figma-plugin/dist/code.js');
  });

  it('fails a bundle or plugin build that contains the Anthropic SDK or an Anthropic key', () => {
    for (const text of ['import "@anthropic-ai/sdk";', 'const key="sk-ant-api03-test";']) {
      expect(() => checkBuild(`const b="${bucket}";${text}`)).toThrow('dist/assets/embed-Ab12Cd34.js');
      expect(() => checkBuild(`const b="${bucket}";`, text)).toThrow('figma-plugin/dist/code.js');
    }
  });

  it('checks only the plugin with --plugin, as build:plugin does', () => {
    expect(checkBuild(null, 'figma.showUI(__html__);', ['--plugin'])).toMatch(/^Checked 2 Figma plugin text assets/);
    expect(() => checkBuild(null, '-----BEGIN PRIVATE KEY-----', ['--plugin'])).toThrow('figma-plugin/dist/code.js');
  });
});
