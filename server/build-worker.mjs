#!/usr/bin/env node
// Builds the hosted Worker bundle: node build-worker.mjs <out _worker.js> [downloads.json] [bootstrap.json]
//   downloads.json : { "/download/x.exe": { name, size, parts: [...] } }   (big files served as joined parts)
//   bootstrap.json : { "username": "admin", "pw": "pbkdf2-sha256$100000$<salt>$<hash>" }  (only a HASH, never the password)
import { build } from 'esbuild'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, dl, boot, reset] = process.argv.slice(2);   // reset = v2.3 one-time admin reset { id, username, pw: HASH, email }
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'app', 'package.json'), 'utf8')).version;
const downloads = dl ? JSON.parse(fs.readFileSync(dl, 'utf8')) : {};
const bootstrap = boot ? JSON.parse(fs.readFileSync(boot, 'utf8')) : null;
if (bootstrap && !/^pbkdf2-sha256\$\d+\$[0-9a-f]+\$[0-9a-f]{64}$/.test(bootstrap.pw)) throw new Error('bootstrap.pw must be a password HASH');
const adminReset = reset ? JSON.parse(fs.readFileSync(reset, 'utf8')) : null;
if (adminReset && !/^pbkdf2-sha256\$\d+\$[0-9a-f]+\$[0-9a-f]{64}$/.test(adminReset.pw)) throw new Error('reset.pw must be a password HASH');
fs.writeFileSync(path.join(here, 'worker-config.js'), `export const DOWNLOADS = ${JSON.stringify(downloads)};\nexport const ADMIN_BOOTSTRAP = ${JSON.stringify(bootstrap)};\nexport const ADMIN_RESET = ${JSON.stringify(adminReset)};\nexport const VERSION = ${JSON.stringify(version)};\n`);
await build({ entryPoints: [path.join(here, 'worker.js')], bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: out, external: ['fs', 'path', 'crypto', 'stream', 'cloudflare:sockets'], logLevel: 'warning' });
fs.writeFileSync(path.join(here, 'worker-config.js'), "export const DOWNLOADS = {};\nexport const ADMIN_BOOTSTRAP = null;\nexport const ADMIN_RESET = null;\nexport const VERSION = '" + version + "';\n");
console.log('built', out, fs.statSync(out).size, 'bytes');
