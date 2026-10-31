'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outputDirectory = path.join(root, 'dist');

async function buildFrontend() {
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.cp(path.join(root, 'public'), outputDirectory, { recursive: true });
  await fs.copyFile(path.join(root, 'brand.js'), path.join(outputDirectory, 'brand.js'));

  const vendorDirectory = path.join(outputDirectory, 'vendor');
  await fs.mkdir(vendorDirectory, { recursive: true });
  await fs.copyFile(
    path.join(root, 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.min.css'),
    path.join(vendorDirectory, 'bootstrap.min.css')
  );
  await fs.copyFile(
    path.join(root, 'node_modules', 'bootstrap', 'dist', 'js', 'bootstrap.bundle.min.js'),
    path.join(vendorDirectory, 'bootstrap.bundle.min.js')
  );
}

buildFrontend().catch((error) => {
  console.error('Frontend build failed:', error);
  process.exitCode = 1;
});
