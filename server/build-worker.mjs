#!/usr/bin/env node
// Builds the hosted Worker bundle: node build-worker.mjs <out _worker.js> [downloads.json] [bootstrap.json]
//   downloads.json : { "/download/x.exe": { name, size, parts: [...] } }   (big files served as joined parts)
//   bootstrap.json : { "username": "admin", "pw": "pbkdf2-sha256$100000$<salt>$<hash>" }  (only a HASH, never the password)
import { build } from 'esbuild'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, dl, boot] = process.argv.slice(2);
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'app', 'package.json'), 'utf8')).version;
const downloads = dl ? JSON.parse(fs.readFileSync(dl, 'utf8')) : {};
const bootstrap = boot ? JSON.parse(fs.readFileSync(boot, 'utf8')) : null;
if (bootstrap && !/^pbkdf2-sha256\$\d+\$[0-9a-f]+\$[0-9a-f]{64}$/.test(bootstrap.pw)) throw new Error('bootstrap.pw must be a password HASH');
fs.writeFileSync(path.join(here, 'worker-config.js'), `export const DOWNLOADS = ${JSON.stringify(downloads)};\nexport const ADMIN_BOOTSTRAP = ${JSON.stringify(bootstrap)};\nexport const VERSION = ${JSON.stringify(version)};\n`);
await build({ entryPoints: [path.join(here, 'worker.js')], bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: out, external: ['fs', 'path', 'crypto', 'stream'], logLevel: 'warning' });
fs.writeFileSync(path.join(here, 'worker-config.js'), "export const DOWNLOADS = {};\nexport const ADMIN_BOOTSTRAP = null;\nexport const VERSION = '" + version + "';\n");
console.log('built', out, fs.statSync(out).size, 'bytes');
