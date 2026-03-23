const { execSync } = require('node:child_process');
const fs = require('node:fs');

const CHROME_DIR = '/home/container/chrome-linux64';
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

if (fs.existsSync(CHROME_PATH)) {
  console.log('✓ Chrome binary already exists, skipping download');
  process.exit(0);
}

console.log(`\n=== Downloading Chrome ${CHROME_VERSION} ===`);
try {
  fs.mkdirSync(CHROME_DIR, { recursive: true });
  execSync(
    `cd /home/container && ` +
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
