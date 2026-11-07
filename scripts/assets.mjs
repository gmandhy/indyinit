import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(root, 'docs/assets-manifest.json');
const command = process.argv[2];
if (!['prepare','verify'].includes(command)) throw new Error('Use prepare or verify');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root,'node_modules/@mediapipe/tasks-vision/package.json'),'utf8'));
if (pkg.version !== manifest.tasksVisionVersion) throw new Error('MediaPipe version mismatch; use npm ci');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (const asset of manifest.assets) {
    const target = path.join(root,'public',asset.path);
    if (command === 'prepare') {
      let bytes;
      if (asset.packagePath) bytes = await readFile(path.join(root,'node_modules/@mediapipe/tasks-vision',asset.packagePath));
      else {
        const response = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (hash(bytes) !== asset.sha256) throw new Error(`Source checksum mismatch: ${asset.path}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target,bytes);
    }
    const bytes = await readFile(target);
    if (hash(bytes) !== asset.sha256) throw new Error(`Local checksum mismatch: ${asset.path}`);
  }
  const wasmFiles = (await readdir(path.join(root,'node_modules/@mediapipe/tasks-vision/wasm'))).filter(f => /\.(js|wasm)$/.test(f)).sort();
  const recorded = manifest.assets.filter(a => a.packagePath).map(a => path.basename(a.packagePath)).sort();
  if (JSON.stringify(wasmFiles) !== JSON.stringify(recorded)) throw new Error('WASM manifest does not match installed package');
  console.log(`Verified ${manifest.assets.length} assets (Tasks Vision ${pkg.version}); SHA-256 matches.`);
} catch (error) {
  console.error(`Asset ${command} failed: ${error.message}\nRun npm ci, then npm run assets:prepare (network required), then npm run assets:verify. Do not use runtime CDN fallbacks.`);
  process.exitCode = 1;
}
