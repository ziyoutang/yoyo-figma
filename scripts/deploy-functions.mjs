import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = process.argv.slice(2);
const all = names.length === 1 && names[0] === '--all';
const filter = /^[A-Za-z_][A-Za-z0-9_-]*(?:[.:][A-Za-z_][A-Za-z0-9_-]*)*$/;
if (!all && (!names.length || names.some(name => !filter.test(name)))) {
  console.error('Usage: npm run deploy:functions -- firstFunction secondFunction\nFor all functions: npm run deploy:functions:all');
  process.exit(1);
}

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
if (!config.functions || (Array.isArray(config.functions) && !config.functions.length)) {
  console.error('No Cloud Functions are configured in this project. Nothing was deployed. Use npm run deploy:hosting or npm run deploy:rules for the existing services.');
  process.exit(1);
}

const targets = all ? 'functions' : names.map(name => `functions:${name}`).join(',');
const result = spawnSync('firebase', ['deploy', '--only', targets, '--project', 'depth-plugin-demo-20261006'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) console.error(`Could not run Firebase CLI: ${result.error.message}`);
process.exit(result.status ?? 1);
