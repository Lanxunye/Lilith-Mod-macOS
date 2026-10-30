'use strict';

const crypto = require('crypto');
const fs = require('node:fs');

const DEFAULT_INTEGRATIONS = {
  dsh: { enabled: false, transport: 'stdio', endpoint: '', api_key: '', timeout_ms: 30000,
    executable: '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
    default_mode: 'auto', model: '', base_url: '', read_roots: '', allow_write: true, allow_web: false,
    task_timeout_ms: 600000, max_tokens: 4096 },
  comfy: { enabled: false, base_url: 'http://127.0.0.1:8188', api_key: '',
    model_label: '本地 Qwen', workflow: {}, prompt_node_id: '', prompt_input: 'text', timeout_ms: 120000,
    autonomous_enabled: false, cooldown_seconds: 90, daily_limit: 20, job_timeout_ms: 600000,
    negative_node_id: '', size_node_id: '', seed_node_id: '', output_node_id: '' }
};

function integrationError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw integrationError('endpoint_required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw integrationError('invalid_endpoint');
  return url.toString();
}

function normalizeIntegrations(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_INTEGRATIONS).map(([name, defaults]) =>
    [name, { ...defaults, ...(value[name] || {}) }]));
}

function describeIntegrations(value) {
  const config = normalizeIntegrations(value);
  return {
    protocol_version: 1,
    dsh: { enabled: Boolean(config.dsh.enabled), transport: config.dsh.transport,
      configured: config.dsh.transport==='stdio'?fs.existsSync(config.dsh.executable):Boolean(config.dsh.endpoint),
      status: config.dsh.transport==='stdio'?'sdk_configured_unverified':config.dsh.endpoint?'configured_unverified':'reserved',
      description: '桌面与 QQ 共用 DSH 原生对话；独立工作区，删除和高危操作逐次明文确认。' },
    comfy: { enabled: Boolean(config.comfy.enabled), model_label: config.comfy.model_label,
      configured: Boolean(config.comfy.base_url && Object.keys(config.comfy.workflow || {}).length),
      status: Object.keys(config.comfy.workflow || {}).length ? 'configured_unverified' : 'workflow_required' }
  };
}

function createIntegrations(getConfig, options = {}) {
  const request = options.fetch || fetch;
  const json = async (url, init, config) => {
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`;
    let response;
    try {
      response = await request(url, { ...init, headers,
        signal: AbortSignal.timeout(Math.max(1000, Math.min(180000, Number(config.timeout_ms) || 30000))) });
    } catch { throw integrationError('integration_unreachable', 502); }
    if (!response.ok) throw integrationError('integration_request_failed', 502);
    return response.json();
  };
  return {
    describe: () => describeIntegrations(getConfig().integrations),
    async dshChat(payload) {
      const config = normalizeIntegrations(getConfig().integrations).dsh;
      if (!config.enabled) throw integrationError('integration_disabled', 409);
      if (options.dshAdapter) return options.dshAdapter.chat(payload);
      const messages = payload.messages;
      if (!Array.isArray(messages) || messages.length > 80 || messages.some(m =>
        !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 20000))
        throw integrationError('invalid_messages');
      return json(endpoint(config.endpoint), { method: 'POST', body: JSON.stringify({
        protocol_version: 1, request_id: crypto.randomUUID(), messages,
        context: payload.context || {}, stream: false }) }, config);
    },
    async submitImage(payload) {
      const config = normalizeIntegrations(getConfig().integrations).comfy;
      if (!config.enabled) throw integrationError('integration_disabled', 409);
      const graph = structuredClone(payload.workflow || config.workflow);
      if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !Object.keys(graph).length
        || Object.values(graph).some(node => !node || typeof node.class_type !== 'string' || !node.inputs))
        throw integrationError('api_workflow_required');
      if (payload.prompt !== undefined) {
        if (typeof payload.prompt !== 'string' || payload.prompt.length > 10000)
          throw integrationError('invalid_prompt');
        const node = graph[config.prompt_node_id];
        if (!node || !config.prompt_input || !(config.prompt_input in node.inputs))
          throw integrationError('prompt_binding_required');
        node.inputs[config.prompt_input] = payload.prompt;
      }
      const base = endpoint(config.base_url).replace(/\/$/, '');
      const result = await json(base + '/prompt', { method: 'POST',
        body: JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() }) }, config);
      if (!result.prompt_id || result.error) throw integrationError('workflow_rejected', 422);
      return { protocol_version: 1, job_id: result.prompt_id, status: 'queued' };
    },
    async imageStatus(id) {
      const config = normalizeIntegrations(getConfig().integrations).comfy;
      if (!config.enabled) throw integrationError('integration_disabled', 409);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw integrationError('invalid_job_id');
      const base = endpoint(config.base_url).replace(/\/$/, '');
      const history = await json(base + '/history/' + encodeURIComponent(id), { method: 'GET' }, config);
      const item = history[id];
      const images = !item ? [] : Object.values(item.outputs || {}).flatMap(output => output.images || []);
      return { protocol_version: 1, job_id: id, status: !item ? 'pending'
        : item.status && item.status.status_str === 'error' ? 'failed'
        : item.status?.completed || item.status?.status_str === 'success' || images.length ? 'completed' : 'pending',
        images: !item ? [] : Object.values(item.outputs || {}).flatMap(output => output.images || []).map(image => ({
          filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output',
          url: base + '/view?' + new URLSearchParams({ filename: image.filename,
            subfolder: image.subfolder || '', type: image.type || 'output' }) })) };
    }
  };
}

module.exports = { DEFAULT_INTEGRATIONS, normalizeIntegrations, describeIntegrations, createIntegrations };
