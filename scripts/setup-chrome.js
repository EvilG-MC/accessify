import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const defaultBaseDir = existsSync('/home/container') ? '/home/container' : projectRoot;
const baseDir = process.env.SETUP_BASE_DIR?.trim() || defaultBaseDir;

const CHROME_DIR = `${baseDir}/chrome-linux64`;
const CHROME_PATH = `${CHROME_DIR}/chrome`;
const CHROME_VERSION = process.argv[2] ?? '133.0.6943.98';

// Check required tools
for (const tool of ['curl', 'unzip']) {
  try {
    execSync(`which ${tool}`, { stdio: 'pipe' });
  } catch {
    console.error(`✗ Required tool not found: ${tool}`);
    process.exit(1);
  }
}

if (existsSync(CHROME_PATH)) {
  console.log('✓ Chrome binary already exists, skipping download');
  process.exit(0);
}

console.log(`\n=== Downloading Chrome ${CHROME_VERSION} ===`);
try {
  mkdirSync(CHROME_DIR, { recursive: true });
  execSync(
    `cd "${baseDir}" && ` +
    `curl -LO "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" && ` +
    `unzip -q chrome-linux64.zip && ` +
    `rm chrome-linux64.zip`,
    { stdio: 'inherit' }
  );
  console.log('✓ Chrome downloaded successfully');
  process.exit(0);
} catch (e) {
  console.error('✗ Failed to download Chrome:', e.message);
  process.exit(1);
}
