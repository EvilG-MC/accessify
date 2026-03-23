const { execSync } = require('node:child_process');
const fs = require('node:fs');

const LIBS_DIR = '/home/container/libs';
const CHROME_DIR = '/home/container/chrome-linux64';
const CHROME_PATH = `${CHROME_DIR}/chrome`;

if (!fs.existsSync(CHROME_PATH)) {
  console.error('✗ Chrome binary not found. Run setup-chrome.js first.');
  process.exit(1);
}

try {
  fs.mkdirSync(LIBS_DIR, { recursive: true });

  // Fix Chrome permissions
  try {
    execSync(`chmod -R 755 ${CHROME_DIR}/`);
    console.log('✓ Chrome permissions fixed');
  } catch (e) {
    console.error('✗ Error fixing permissions:', e.message);
  }

  // Check for missing libs
  console.log('\n=== Checking for missing libraries ===');
  let missingLibs = '';
  try {
    missingLibs = execSync(
      `LD_LIBRARY_PATH=${LIBS_DIR} ldd ${CHROME_PATH} 2>/dev/null | grep "not found"`,
      { encoding: 'utf8' }
    ).trim();
  } catch {
    // grep returns exit code 1 when nothing is found — means no missing libs
    missingLibs = '';
  }

  if (!missingLibs) {
    console.log('✓ No missing libraries found. Chrome should work correctly.');
    console.log('\nAdd this at the very top of your app BEFORE any other require:\n');
    console.log(`process.env.LD_LIBRARY_PATH = '${LIBS_DIR}';\n`);
    process.exit(0);
  }

  console.log('Missing libraries:\n', missingLibs);

  const packages = [
    'libatk1.0-0',
    'libatk-bridge2.0-0',
    'libatspi2.0-0',
    'at-spi2-core',
    'libcups2',
    'libdrm2',
    'libxkbcommon0',
    'libxcomposite1',
    'libxdamage1',
    'libxfixes3',
    'libxrandr2',
    'libgbm1',
    'libasound2',
    'libpango-1.0-0',
    'libpangocairo-1.0-0',
    'libcairo2',
    'libcairo-gobject2',
    'libgdk-pixbuf-2.0-0',
    'libgtk-3-0',
    'libdbus-1-3',
    'libdbus-glib-1-2',
    'libnss3',
    'libnspr4',
    'libexpat1',
    'libfontconfig1',
    'libfreetype6',
    'libharfbuzz0b',
    'libpixman-1-0',
    'libpng16-16',
    'libxcb1',
    'libxcb-shm0',
    'libxcb-render0',
    'libx11-6',
    'libx11-xcb1',
    'libxext6',
    'libxrender1',
    'libxss1',
    'libxtst6',
    'libglib2.0-0',
    'libavahi-common3',
    'libavahi-client3',
  ];

  const missingNames = missingLibs.split('\n')
    .map(line => line.match(/(\S+\.so)/)?.[1])
    .filter(Boolean);

  console.log('\nLibraries to resolve:', missingNames.join(', '));

  console.log('\n=== Downloading packages ===');

  const tmpDir = `${LIBS_DIR}/tmp_deb`;
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const pkg of packages) {
    try {
      process.stdout.write(`Downloading ${pkg}... `);

      execSync(`cd ${tmpDir} && apt-get download ${pkg} 2>/dev/null`, { stdio: 'pipe' });

      const debs = fs.readdirSync(tmpDir).filter(f => f.endsWith('.deb'));
      for (const deb of debs) {
        execSync(
          `cd ${tmpDir} && dpkg-deb -x ${deb} ${tmpDir}/extracted && ` +
          `find ${tmpDir}/extracted -name "*.so*" | xargs -I{} cp -P {} ${LIBS_DIR}/ 2>/dev/null; ` +
          `rm -rf ${tmpDir}/extracted ${tmpDir}/${deb}`,
          { stdio: 'pipe' }
        );
      }

      console.log('✓');
    } catch (e) {
      console.log(`✗ (${e.message.split('\n')[0]})`);
    }
  }

  // Cleanup tmp
  try { execSync(`rm -rf ${tmpDir}`); } catch { }

  // Re-check missing libs
  console.log('\n=== Missing libraries AFTER install ===');
  try {
    const stillMissing = execSync(
      `LD_LIBRARY_PATH=${LIBS_DIR} ldd ${CHROME_PATH} 2>/dev/null | grep "not found" || echo "✓ None — Chrome should work"`,
      { encoding: 'utf8' }
    );
    console.log(stillMissing);
  } catch {
    console.log('✓ None — Chrome should work');
  }

  console.log('\n=== Done ===');
  console.log('Add this at the very top of your app BEFORE any other require:\n');
  console.log(`process.env.LD_LIBRARY_PATH = '${LIBS_DIR}';\n`);

  process.exit(0);

} catch (e) {
  console.error('\n✗ Fatal error:', e.message);
  process.exit(1);
}
