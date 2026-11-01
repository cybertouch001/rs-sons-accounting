
// Runs the bundled Worker in Node against in-memory fakes of D1 and R2 to check the hosted code path end to end.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
globalThis.FixedLengthStream = class { constructor() { const ts = new TransformStream(); this.readable = ts.readable; this.writable = ts.writable; } };
class FakeD1 { constructor() { this.d = new DatabaseSync(':memory:'); } prepare(sql) { const d = this.d; return { bind(...p) { return { async all() { return { results: d.prepare(sql).all(...p) }; }, async run() { const r = d.prepare(sql).run(...p); return { meta: { changes: Number(r.changes) } }; } }; } }; } }
class FakeR2 { constructor() { this.m = new Map(); this.n = 0; this.delay = 0; }
  async head(k) { const o = this.m.get(k); return o ? { etag: o.etag, size: o.b.length } : null; }
  async get(k) { const o = this.m.get(k); return o ? { etag: o.etag, size: o.b.length, arrayBuffer: async () => o.b.slice().buffer } : null; }
  async put(k, b, opt = {}) { if (this.delay) await new Promise(r => setTimeout(r, this.delay)); const o = this.m.get(k); if (opt.onlyIf && opt.onlyIf.etagMatches && (!o || o.etag !== opt.onlyIf.etagMatches)) return null; const u = b instanceof Uint8Array ? b : new Uint8Array(b); const e = { b: u.slice(), etag: 'e' + (++this.n) }; this.m.set(k, e); return { etag: e.etag }; }
  async delete(k) { this.m.delete(k); } async list({ prefix }) { return { objects: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(k => ({ key: k, size: this.m.get(k).b.length })) }; } }
module.exports = async function makeWorkerEnv(bundlePath) {
  const mod = await import(bundlePath + '?t=' + Date.now());
  const env = { DB: new FakeD1(), FILES: new FakeR2(), ASSETS: { fetch: async () => new Response('asset') } };
  const worker = mod.default;
  const mk = () => { let cookie = ''; return { get cookie() { return cookie; }, async call(m, ...a) { const r = await worker.fetch(new Request('https://x.test/api/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rs-client': '1', cookie }, body: JSON.stringify({ m, a }) }), env, {}); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const j = await r.json(); if (!j.ok) { const e = new Error(j.error); e.code = j.code; throw e; } return j.data; } }; };
  return { env, worker, client: mk };
};
