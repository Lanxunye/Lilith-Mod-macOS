import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const localPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const idPattern = /^[a-zA-Z0-9_.:-]{1,128}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fault = code => Object.assign(Error(code), {code});
const atomic = (file, value) => {
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, value, {mode: 0o600, flag: 'wx'});
  fs.renameSync(tmp, file);
};

export function allowRequest(req) {
  if (!localPeers.has(req.socket?.remoteAddress)) return false;
  let host;
  try { host = new URL('http://' + req.headers.host); } catch { return false; }
  if (!localHosts.has(host.hostname) || host.username || host.password || host.pathname !== '/') return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (!['http:', 'https:'].includes(new URL(origin).protocol) || new URL(origin).host !== host.host) return false; }
    catch { return false; }
  }
  return true;
}

// This is a UI adapter to the existing authoritative journal and executor. It
// never opens a DSH session log or runs tools in the ordinary desktop profile.
export function createBridge({dataRoot = path.join(os.homedir(), 'Library/Application Support/LilithAI'),
  workspace = path.join(os.homedir(), 'Documents/Lilith-DSH-Workspace'), request = fetch} = {}) {
  const csrf = crypto.randomBytes(32).toString('hex');
  const projection = path.join(workspace, '莉莉丝对话同步');
  const markerFile = path.join(projection, '.lilith-sync.json');
  const transcriptFile = path.join(projection, '对话记录.jsonl');
  const owner = hash(path.resolve(dataRoot));
  let records = new Map(), session = '', projectionError = '';
  async function api(route, body) {
    const file = path.join(dataRoot, 'runtime.json');
    if (fs.lstatSync(file).isSymbolicLink()) throw fault('lilith_runtime_invalid');
    const runtime = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!['127.0.0.1', '::1'].includes(runtime.host) || !Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 || typeof runtime.token !== 'string' || runtime.token.length < 16) throw fault('lilith_runtime_invalid');
    const base = `http://${runtime.host === '::1' ? '[::1]' : runtime.host}:${runtime.port}`;
    const r = await request(base + route, {method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + runtime.token},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(body === undefined ? 10000 : 35 * 60000)});
    const value = await r.json();
    if (!r.ok) throw fault(/^[a-z0-9_]+$/.test(value.error || '') ? value.error : 'lilith_request_failed');
    return value;
  }
  async function binding() {
    const q = await api('/v1/qq');
    const sid = q.session_id || 'desktop-pet';
    if (!idPattern.test(sid)) throw fault('lilith_session_invalid');
    if (session !== sid) { session = sid; records = new Map(); }
    return sid;
  }
  async function history(sid) {
    const messages = []; let cursor = 0;
    for (let page = 0; page < 1000; page++) {
      const result = await api('/v1/session/' + encodeURIComponent(sid) + '/events?after=' + cursor);
      const rows = result.messages || [];
      if (!rows.length) return {messages, cursor};
      if (!Number.isSafeInteger(result.cursor) || result.cursor <= cursor || rows.some(r => !Number.isSafeInteger(r.seq) || r.seq <= cursor)) throw fault('lilith_history_cursor_invalid');
      messages.push(...rows); cursor = result.cursor;
      if (rows.length < 100) return {messages, cursor};
    }
    throw fault('lilith_history_limit_reached');
  }
  function project(messages) {
    for (const row of messages) records.set(row.seq, row);
    try {
      let marker;
      if (fs.existsSync(projection)) {
        if (fs.lstatSync(projection).isSymbolicLink() || !fs.statSync(projection).isDirectory() || !fs.existsSync(markerFile) || fs.lstatSync(markerFile).isSymbolicLink()) throw fault('lilith_sync_directory_conflict');
        marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
        if (marker.owner !== owner || marker.schema !== 1) throw fault('lilith_sync_directory_conflict');
      } else {
        fs.mkdirSync(projection, {recursive: false, mode: 0o700});
        marker = {schema: 1, owner, sha256: null};
        atomic(markerFile, JSON.stringify(marker));
      }
      if (fs.existsSync(transcriptFile)) {
        if (fs.lstatSync(transcriptFile).isSymbolicLink() || !fs.statSync(transcriptFile).isFile()) throw fault('lilith_sync_file_changed');
        const actual = hash(fs.readFileSync(transcriptFile));
        if (actual !== marker.sha256 && actual !== marker.next_sha256) throw fault('lilith_sync_file_changed');
        // Recover either side of an interrupted publication, while retaining
        // external-edit detection. The pending hash is written before the file.
        if (marker.next_sha256 && actual === marker.next_sha256) marker.sha256 = actual;
      }
      const rows = [...records.values()].sort((a, b) => a.seq - b.seq);
      const text = rows.map(r => JSON.stringify({id: r.id, seq: r.seq, role: r.role, channel: r.channel, time: r.created_at, text: r.content})).join('\n') + (rows.length ? '\n' : '');
      const sha256 = hash(text);
      if (sha256 !== marker.sha256) {
        atomic(markerFile, JSON.stringify({...marker, next_sha256: sha256}));
        atomic(transcriptFile, text);
        atomic(markerFile, JSON.stringify({schema: 1, owner, sha256, messages: rows.length, session}));
      } else if (marker.next_sha256) {
        atomic(markerFile, JSON.stringify({schema: 1, owner, sha256, messages: rows.length, session}));
      }
      projectionError = '';
    } catch (e) { projectionError = /^lilith_sync_/.test(e.code || '') ? e.code : 'lilith_sync_write_failed'; }
  }
  return {
    csrf,
    async snapshot(after = 0) {
      if (!Number.isSafeInteger(after) || after < 0) throw fault('invalid_cursor');
      const sid = await binding();
      const [events, dsh] = await Promise.all([history(sid), api('/v1/dsh')]);
      records = new Map(); project(events.messages || []);
      return {ok: true, csrf, session: sid, messages: (events.messages || []).filter(r => r.seq > after), cursor: events.cursor || 0,
        dsh: {running: dsh.running, active: dsh.active, status: dsh.status, purge_loaded: dsh.purge?.status === 'loaded_this_run'},
        pending: dsh.pending || [], transcript_file: transcriptFile, projection_error: projectionError};
    },
    async send(body, suppliedCsrf) {
      if (typeof suppliedCsrf !== 'string' || !/^[0-9a-f]{64}$/.test(suppliedCsrf) || !crypto.timingSafeEqual(Buffer.from(suppliedCsrf), Buffer.from(csrf))) throw fault('lilith_csrf_invalid');
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000 || !idPattern.test(body.request_id || '')) throw fault('invalid_message');
      const sid = await binding();
      // The desktop channel writes the shared private journal. QQ delivery still
      // follows the existing mirror setting; opening this panel never enables it.
      const requestId = body.request_id.startsWith('dsh-desktop:') ? body.request_id : 'dsh-desktop:' + body.request_id;
      const result = await api('/v1/session/' + encodeURIComponent(sid) + '/message', {message: body.message, request_id: requestId});
      return {ok: true, result, snapshot: await this.snapshot()};
    }
  };
}

export const name = 'lilith-desktop-bridge';
export const inject = ['webServer'];
export function apply(ctx) {
  const bridge = createBridge();
  const sendJson = (res, status, value) => {res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});res.end(JSON.stringify(value));};
  const register = (route, method, action) => ctx.webServer.register({kind: 'exact', path: route, handler: async (req, res) => {
    if (!allowRequest(req)) return sendJson(res, 403, {error: 'lilith_origin_rejected'});
    if (req.method !== method) return sendJson(res, 405, {error: 'method_not_allowed'});
    try {
      let body;
      if (method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) {size += Buffer.byteLength(chunk);if (size > 16384) throw fault('invalid_body');chunks.push(Buffer.from(chunk));}
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      sendJson(res, 200, await action(req, body));
    } catch (e) {sendJson(res, e.code === 'lilith_csrf_invalid' ? 403 : e.code?.startsWith('invalid_') ? 400 : 503, {error: /^[a-z0-9_]+$/.test(e.code || '') ? e.code : 'lilith_service_unavailable'});}
  }});
  ctx.effect(() => {
    const timer = setInterval(() => {void bridge.snapshot().catch(() => {});}, 5000);
    void bridge.snapshot().catch(() => {});
    const disposers = [register('/lilith-bridge/snapshot', 'GET', req => bridge.snapshot(Number(new URL(req.url, 'http://127.0.0.1').searchParams.get('after') || 0))),
      register('/lilith-bridge/message', 'POST', (req, body) => bridge.send(body, req.headers['x-lilith-bridge']))];
    return () => {clearInterval(timer);for (const dispose of disposers) dispose?.();};
  });
}
export default {name, inject, apply};
