import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2] ?? '133.0.6943.98';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const setupChromePath = resolve(scriptDir, 'setup-chrome.js');
const setupLibsPath = resolve(scriptDir, 'setup-libs.js');

console.log('=== Running setup-chrome.js ===\n');
try {
  execSync(`node "${setupChromePath}" ${version}`, { stdio: 'inherit' });
} catch {
  process.exit(1);
}

console.log('\n=== Running setup-libs.js ===\n');
try {
  execSync(`node "${setupLibsPath}"`, { stdio: 'inherit' });
} catch {
  process.exit(1);
}
