import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

mkdirSync(resolve(dist, 'popup'), { recursive: true });
mkdirSync(resolve(dist, 'options'), { recursive: true });
mkdirSync(resolve(dist, 'icons'), { recursive: true });

cpSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
cpSync(resolve(root, 'src/popup/index.html'), resolve(dist, 'popup/index.html'));
cpSync(resolve(root, 'src/options/index.html'), resolve(dist, 'options/index.html'));

try {
  cpSync(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true });
} catch {
  // icons dir may be empty during development
}

console.log('Static files copied to dist/');
