'use strict';

const fs = require('fs');
const path = require('path');
const { createIntegrations, normalizeIntegrations } = require('./integrations');

const ALLOWED = {
  mock_mode: null,
  ui: ['language_mode'],
  provider: ['kind', 'base_url', 'api_key', 'model', 'wire_api', 'thinking_mode', 'reasoning_effort',
    'search_tool', 'timeout_ms', 'temperature', 'max_tokens'],
  network: ['proxy_url', 'provider_dns_servers', 'provider_dns_fallback_enabled'],
  media: ['enabled'], local_context: ['enabled', 'time_enabled', 'media_enabled'],
  web_search: ['enabled', 'backend', 'base_url', 'api_key', 'timeout_ms', 'max_results', 'cache_ttl_ms', 'daily_limit'],
  conversation: ['reply_max_chars', 'allow_parenthetical_actions'],
  memory: ['max_messages', 'max_chars_per_message', 'long_term_max_items'],
  music: ['preferred_player'], integrations: ['dsh', 'comfy']
};

function safePatch(config, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid_settings');
  const next = structuredClone(config);
  for (const [group, value] of Object.entries(patch)) {
    if (!Object.hasOwn(ALLOWED, group)) throw new Error('unsupported_setting');
    if (group === 'mock_mode') {
      if (typeof value !== 'boolean') throw new Error('invalid_mock_mode');
      next.mock_mode = value; continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_settings_group');
    next[group] = { ...(next[group] || {}) };
    for (const [key, field] of Object.entries(value)) {
      if (!ALLOWED[group].includes(key) || ['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('unsupported_setting');
      if (group === 'integrations') {
        const templates = normalizeIntegrations()[key];
        if (!field || typeof field !== 'object' || Array.isArray(field)) throw new Error('invalid_integration');
        next.integrations = normalizeIntegrations(next.integrations);
        for (const [name, data] of Object.entries(field)) {
          if (!Object.hasOwn(templates, name)) throw new Error('unsupported_integration_setting');
          if (typeof data !== typeof templates[name] || data === null || Array.isArray(data)
            || (typeof data === 'number' && !Number.isFinite(data))) throw new Error('invalid_integration_value');
          if (name === 'api_key' && data === '') continue;
          next.integrations[key][name] = data;
        }
      } else {
        if (key === 'api_key' && field === '') continue;
        if (typeof field !== 'string' && typeof field !== 'number' && typeof field !== 'boolean'
          && !(key === 'provider_dns_servers' && Array.isArray(field))) throw new Error('invalid_setting_value');
        if (typeof field === 'number' && !Number.isFinite(field)) throw new Error('invalid_setting_value');
        if (next[group][key] !== undefined && typeof field !== typeof next[group][key])
          throw new Error('invalid_setting_type');
        next[group][key] = field;
      }
    }
  }
  if (next.provider.base_url && !/^https?:\/\//i.test(next.provider.base_url)) throw new Error('invalid_provider_url');
  if (next.provider.max_tokens < 1 || next.provider.max_tokens > 32768) throw new Error('invalid_max_tokens');
  if (next.conversation.reply_max_chars < 20 || next.conversation.reply_max_chars > 500)
    throw new Error('invalid_reply_length');
  if(!Number.isInteger(next.web_search.daily_limit)||next.web_search.daily_limit<1||next.web_search.daily_limit>500)throw new Error('invalid_search_daily_limit');
  const comfy=normalizeIntegrations(next.integrations).comfy;
  if(comfy.cooldown_seconds<0||comfy.cooldown_seconds>3600||comfy.daily_limit<1||comfy.daily_limit>100
    ||comfy.job_timeout_ms<1000||comfy.job_timeout_ms>1800000)throw new Error('invalid_art_limits');
  const dsh=normalizeIntegrations(next.integrations).dsh;
  if(patch.integrations?.dsh && Object.hasOwn(patch.integrations.dsh,'executable'))next.integrations.dsh.transport='stdio';
  if(!['auto','chat','dsh'].includes(dsh.default_mode)||!['stdio','http_bridge'].includes(dsh.transport)
    ||!Number.isSafeInteger(dsh.task_timeout_ms)||dsh.task_timeout_ms<10000||dsh.task_timeout_ms>1800000
    ||!Number.isSafeInteger(dsh.max_tokens)||dsh.max_tokens<256||dsh.max_tokens>32768
    ||dsh.read_roots.length>10000||dsh.read_roots.split(/\r?\n/).filter(Boolean).some(p=>!path.isAbsolute(p.trim())))
    throw new Error('invalid_dsh_settings');
  if(dsh.base_url){let endpoint;try{endpoint=new URL(dsh.base_url);}catch{throw new Error('invalid_dsh_messages_url');}
    if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
      throw new Error('invalid_dsh_messages_url');}
  return next;
}

function publicSettings(config) {
  const copy = structuredClone(config);
  for (const group of [copy.provider, copy.web_search, ...Object.values(copy.integrations || {})]) {
    if (!group) continue;
    group.api_key_configured = Boolean(group.api_key);
    delete group.api_key;
  }
  return copy;
}

function createMacUi(host) {
  const integrations = createIntegrations(host.getConfig, host.integrationOptions);
  return {
    publicPage(req, res, url) {
      if (req.method !== 'GET' || !['/ui/bili','/ui/bili.js','/ui/settings', '/ui/chat', '/ui/art', '/ui/qq', '/ui/app.js', '/ui/style.css'].includes(url.pathname)) return false;
      const file = url.pathname==='/ui/bili'?'bili.html':url.pathname==='/ui/bili.js'?'bili.js':url.pathname.endsWith('.js') ? 'app.js' : url.pathname.endsWith('.css') ? 'style.css' : 'index.html';
      const body = fs.readFileSync(path.join(__dirname, '../web', file));
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': url.pathname.startsWith('/ui/bili')?"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'":"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'" });
      res.end(body); return true;
    },
    async route(req, res, url) {
      const send = (status, value) => host.sendJson(res, status, value);
      try {
        if(url.pathname==='/v1/tasks'&&req.method==='GET'){
          send(200,{tasks:host.tasks.list(url.searchParams.get('session_id')||'desktop-pet')});return true;
        }
        const task=url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]{36})(?:\/(stop|files)(?:\/([^/]+))?)?$/);
        if(task){
          if(task[2]==='stop'&&req.method==='POST'){send(200,await host.tasks.stop(task[1]));return true;}
          if(req.method==='GET'&&task[2]==='files'&&task[3]){
            const name=decodeURIComponent(task[3]),file=host.tasks.asset(task[1],name),stat=fs.statSync(file);
            if(stat.size>16*1024*1024)throw new Error('task_file_too_large');
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
              'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(file));return true;
          }
          if(req.method==='GET'&&!task[2]){send(200,host.tasks.get(task[1]));return true;}
        }
        if (req.method === 'GET' && url.pathname === '/v1/art/profile') {
          send(200, host.artwork.profile()); return true;
        }
        if (req.method === 'GET' && url.pathname === '/v1/art/jobs') {
          const session=url.searchParams.get('session_id');
          send(200, {jobs:host.artwork.list().filter(j=>!session||j.session_id===session)});return true;
        }
        if (req.method === 'POST' && url.pathname === '/v1/art/jobs') {
          const body=await host.parseBody(req);
          send(202,host.artwork.submit(body,{requestId:body.request_id,sessionId:body.session_id}));return true;
        }
        const art=url.pathname.match(/^\/v1\/art\/jobs\/([a-f0-9-]{36})(\/image)?$/);
        if(art && req.method==='GET'){
          if(!art[2])send(200,host.artwork.get(art[1]));
          else{const data=fs.readFileSync(host.artwork.asset(art[1]));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);}
          return true;
        }
        if (req.method === 'GET' && url.pathname === '/v1/settings') {
          send(200, { config: publicSettings(host.getConfig()), capabilities: {
            unity_chat: true, memory: true, native_tray: true, native_focus: true,
            enhanced_cross_screen_drag: false, harmony_experimental: true,
            media_players: ['Apple Music', 'Spotify'], integrations: integrations.describe() } });
          return true;
        }
        if (req.method === 'PATCH' && url.pathname === '/v1/settings') {
          const next = safePatch(host.getConfig(), await host.parseBody(req));
          host.saveConfig(next); host.reloadConfig();host.tasks.reconfigure();
          send(200, { ok: true, config: publicSettings(host.getConfig()) }); return true;
        }
        if (url.pathname === '/v1/player-memory' && req.method === 'GET') {
          send(200, host.readPlayerMemory()); return true;
        }
        if (url.pathname === '/v1/player-memory' && req.method === 'PUT') {
          const body = await host.parseBody(req);
          if (!Array.isArray(body.facts) || body.facts.length > 100 || body.facts.some(f => !f
            || typeof f.key !== 'string' || typeof f.value !== 'string' || f.key.length > 100 || f.value.length > 1000))
            throw new Error('invalid_memory');
          send(200, await host.writePlayerMemory(body)); return true;
        }
        if (url.pathname === '/v1/game-state' && req.method === 'GET') {
          send(200, host.gameState()); return true;
        }
        if (url.pathname === '/v1/player-name' && req.method === 'POST') {
          send(200, await host.playerName(await host.parseBody(req))); return true;
        }
        if (url.pathname === '/v1/integrations' && req.method === 'GET') {
          send(200, integrations.describe()); return true;
        }
        if (url.pathname === '/v1/integrations/dsh/chat' && req.method === 'POST') {
          send(200, await integrations.dshChat(await host.parseBody(req))); return true;
        }
        if (url.pathname === '/v1/integrations/comfy/jobs' && req.method === 'POST') {
          send(202, await integrations.submitImage(await host.parseBody(req))); return true;
        }
        const job = url.pathname.match(/^\/v1\/integrations\/comfy\/jobs\/([a-zA-Z0-9_-]+)$/);
        if (job && req.method === 'GET') { send(200, await integrations.imageStatus(job[1])); return true; }
      } catch (error) {
        send(error.status || 400, { error: error.code || 'invalid_request' }); return true;
      }
      return false;
    }
  };
}

module.exports = { createMacUi, safePatch, publicSettings };
