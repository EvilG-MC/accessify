import { execSync } from 'node:child_process';

const version = process.argv[2] ?? '133.0.6943.98';

console.log('=== Running setup-chrome.js ===\n');
try {
  execSync(`node setup-chrome.js ${version}`, { stdio: 'inherit' });
} catch {
  process.exit(1);
}

console.log('\n=== Running setup-libs.js ===\n');
try {
  execSync(`node setup-libs.js`, { stdio: 'inherit' });
} catch {
  process.exit(1);
}
