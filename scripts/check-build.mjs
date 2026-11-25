import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function files(directory) {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);
}
// The Anthropic SDK and its keys stay on the server: Agent Mode calls Claude only through agentAssist.
const forbidden=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /figma\.com\/api\/mcp\/asset/, /@gmail\.com/i, /visual-test/, /browser-check/, /\.design\/preview/, /@anthropic-ai/, /sk-ant-/];
// The Figma plugin's build too, when there is one: dist/ is git-ignored, and deploy:hosting never builds it.
// `--plugin` checks only the plugin, as build:plugin does.
const pluginOnly=process.argv.includes('--plugin');
const folders=[...(pluginOnly?[]:['dist']),...(existsSync('figma-plugin/dist')?['figma-plugin/dist']:[])];
const textFiles=folders.flatMap(files).filter(file=>/\.(js|css|html|json|map)$/.test(file));
for(const file of textFiles) {
  const text=readFileSync(file,'utf8');
  if(forbidden.some(pattern=>pattern.test(text)))throw new Error(`Unexpected private, temporary, or test-only content in ${file}`);
}
if(pluginOnly){
  console.log(`Checked ${textFiles.length} Figma plugin text assets: no private key headers, Anthropic SDK or keys, access-list addresses, temporary Figma URLs, or test preview content.`);
  process.exit(0);
}
// The embed page reads published heroes from the project's bucket. Built without .env.local, it names `undefined` instead.
const bucket=`${JSON.parse(readFileSync('.firebaserc','utf8')).projects.default}.firebasestorage.app`;
const embed=textFiles.find(file=>/^embed-.*\.js$/.test(file.split(/[\\/]/).pop()));
if(!embed||!readFileSync(embed,'utf8').includes(bucket))throw new Error(`The embed page doesn't read from ${bucket}. Build with .env.local, which sets VITE_FIREBASE_PROJECT_ID.`);
console.log(`Checked ${textFiles.length} production text assets: no private key headers, Anthropic SDK or keys, access-list addresses, temporary Figma URLs, or test preview content. The embed page reads from ${bucket}.`);
