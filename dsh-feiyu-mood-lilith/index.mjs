import fs from 'node:fs';
import path from 'node:path';
import {createHmac, timingSafeEqual, createHash} from 'node:crypto';
import {lilithCore as core} from './upstream/index.js';
import style from './style.cjs';
import pet from './pet-affection-view.cjs';
import background from './mood-background.cjs';
const styleBytes = fs.readFileSync(new URL('./lilith-style.json', import.meta.url));
export const styleProfile = JSON.parse(styleBytes);
export const styleHash = createHash('sha256').update(styleBytes).digest('hex');

export const name = 'lilith-feiyu-mood';
export const inject = ['agents', 'llm'];
export const MARKER = '\nLILITH_MOOD_V1:';
const SLOT = 'lilith-owner';
const home = () => process.env.DSH_HOME;
const folder = () => path.join(home(), 'feiyu-mood');
const statusFile = () => path.join(folder(), 'lilith-status.json');
const atomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
  fs.chmodSync(file, 0o600);
};

export function decodeTurn(text, token, now = Date.now()) {
  if (typeof text !== 'string' || typeof token !== 'string' || token.length < 32) return null;
  const match = /\nLILITH_(?:MOOD|PROACTIVE)_V1:([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(text);
  if (!match || match[1].length > 16000) return null;
  const expected = createHmac('sha256', token).update(match[1]).digest();
  if (!timingSafeEqual(expected, Buffer.from(match[2], 'hex'))) return null;
  try {
    const turn = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (turn.version !== 1 || !['desktop', 'qq'].includes(turn.channel) ||
        typeof turn.id !== 'string' || !/^[a-f0-9-]{36}$/.test(turn.id) ||
        typeof turn.session !== 'string' || turn.session.length > 128 ||
        typeof turn.text !== 'string' || turn.text.length > 2000 ||
        !Number.isFinite(turn.at) || Math.abs(now - turn.at) > 30 * 60000) return null;
    return {...turn,proactive:match[0].startsWith('\nLILITH_PROACTIVE_V1:')};
  } catch { return null; }
}

export function spokenText(message) {
  if (!message) return '';
  if (message.message) return spokenText(message.message);
  const raw = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
    ? message.content.filter(x => x?.type === 'text').map(x => x.text || '').join('\n') : '';
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const parts=Array.isArray(j.messages)?j.messages.filter(p=>p&&typeof p.text==='string'&&p.text.trim()).map(p=>p.text.trim()):[];
    return (parts.length?parts.join('\n'):typeof j.text==='string'?j.text:'').slice(0,1500);
  } catch { return raw.slice(0, 1500); }
}
function inputText(message) {
  if (message?.message) return inputText(message.message);
  return typeof message?.content === 'string' ? message.content : (message?.content || [])
    .filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
}
function lastReply(agent, turn) {
  const events = agent.session.snapshotEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'assistant/message' && (turn === undefined || e.data?.turn === turn))
      return spokenText(e.data);
  }
  return '';
}

export function installMood(ctx, {token = process.env.LILITH_DSH_MOOD_TOKEN, engine = core, now = Date.now, petFile = process.env.LILITH_PET_STATE_FILE} = {}) {
  if (typeof token !== 'string' || token.length < 32) throw Error('lilith_mood_context_token_required');
  if (!home()) throw Error('lilith_mood_home_required');
  fs.mkdirSync(folder(), {recursive: true, mode: 0o700});
  fs.chmodSync(folder(), 0o700);
  const configFile = path.join(folder(), 'config.json');
  if (!fs.existsSync(configFile)) atomic(configFile, {...engine.DEFAULTS, selfName: '莉莉丝', ownerName: '主人',
    slots: [{id: SLOT, label: '莉莉丝与主人', selfName: '莉莉丝', ownerName: '主人', sessions: []}]});
  let seen = [];
  try {seen = JSON.parse(fs.readFileSync(statusFile(), 'utf8')).seen_ids || [];} catch {}
  const status = {version: '0.7.0-lilith.6', upstream: '0.7.0', pid: process.pid, loaded: true, pet_interactions: true, background_each_turn: true,
    style_version: styleProfile.version, style_sha256: styleHash,
    seen_ids: seen.slice(-200),
    judging: false, observed: 0, judged: 0, injected: 0, failures: 0, last_error: '', updated_at: now()};
  const publish = () => {status.updated_at = now(); atomic(statusFile(), status);};
  const mounted = new Map(), disposers = [];
  let chain = Promise.resolve(), disposed = false;
  function persist(state) {
    engine.saveState(SLOT, state);
    for (const file of ['state.json', 'diag.log']) {
      const full = path.join(folder(), file); if (fs.existsSync(full)) fs.chmodSync(full, 0o600);
    }
  }
  function mount(agent) {
    if (!agent?.session || mounted.has(agent)) return;
    let current = null, localOffs = [];
    localOffs.push(agent.ctx.on('agent/inbox/inserted', payload => {
      current = decodeTurn(inputText(payload.message), token, now());
      if (current) {status.observed++; publish();}
    }));
    localOffs.push(agent.ctx.systemPrompt.context({name: 'lilith-pet-interactions', order: 890, text: () => {
      if (!current || disposed) return '';
      const cfg=engine.loadConfig();if(cfg.injectMode==='off')return '';
      const s=engine.getState(SLOT,cfg.moodBase,{persist:false,halfHours:cfg.decayHalfHours});
      return pet.context(pet.readPet(petFile,now()),s.mood);
    }}));
    localOffs.push(agent.ctx.systemPrompt.context({name: 'lilith-mood-background', order: 895, text: () => {
      if (!current || disposed) return '';
      const cfg=engine.loadConfig();if(cfg.injectMode==='off')return '';
      const s=engine.getState(SLOT,cfg.moodBase,{persist:false,halfHours:cfg.decayHalfHours});
      return background.moodBackground({...s,mood:pet.effectiveMood(s.mood,pet.readPet(petFile,now()))});
    }}));
    localOffs.push(agent.ctx.systemPrompt.context({name: 'feiyu-mood', order: 900, text: () => {
      if (!current || disposed) return '';
      const cfg = engine.loadConfig(); if (cfg.injectMode === 'off') return '';
      const s = engine.getState(SLOT, cfg.moodBase, {persist: false, halfHours: cfg.decayHalfHours});
      if (!s.updatedAt || s.injectedFor === s.updatedAt || s.minor) return '';
      const midnight = new Date(now()); midnight.setHours(0, 0, 0, 0);
      const count = (s.saidAt || []).filter(t => t >= midnight.getTime()).length;
      if (s.lastConfidence < cfg.injectConfidence || count >= cfg.injectPerDay) {
        s.injectedFor = s.updatedAt; persist(s); return '';
      }
      const line = engine.moodLine({...s,mood:pet.effectiveMood(s.mood,pet.readPet(petFile,now()))}, cfg.injectMode, undefined, cfg.ownerName);
      if (!line) return '';
      s.injectedFor = s.updatedAt; s.lastInjectedText = line; s.lastInjectedAt = now();
      s.saidAt = [...(s.saidAt || []), now()].slice(-200); persist(s);
      status.injected++; publish(); return line;
    }}));
    localOffs.push(agent.ctx.on('agent/turn-stopping', async payload => {
      const turn = current; current = null;
      if (!turn || disposed) return;
      const reply = lastReply(agent, payload.turn); if (!reply) return;
      const work = async () => {
        if (disposed) return;
        const cfg = engine.loadConfig(); if (!cfg.autoJudge) return;
        const s = engine.getState(SLOT, cfg.moodBase, {persist: false, halfHours: cfg.decayHalfHours});
        if (status.seen_ids.includes(turn.id)) return;
        status.judging = true; publish();
        try {
          const llmCtx = {llm: {stream: request => ctx.llm.stream({...request,
            signal: AbortSignal.any([AbortSignal.timeout(30000), ...(payload.signal ? [payload.signal] : [])]),
            // Keep the upstream parser/decay/state engine, but replace its fish
            // persona judgement wholesale, avoiding contradictory generic rules.
            system: style.moodJudgePrompt(styleProfile, {self:cfg.selfName,owner:cfg.ownerName,aliases:cfg.selfAliases})+
              (turn.proactive?'\n本轮是莉莉丝自己主动开口，没有主人新发的话。只判断莉莉丝自己的实际可见表达；触发器、骰子与旧话题不是主人的新陈述。':'')
          })}};
          const delta = await engine.judge(llmCtx, agent, turn.proactive?'':turn.text, reply, turn.proactive?'talk':'', {
            self: cfg.selfName, owner: cfg.ownerName, aliases: cfg.selfAliases,
            judgeProvider: cfg.judgeProvider, judgeModel: cfg.judgeModel
          });
          if (disposed) return;
          if (!delta) throw Error('lilith_mood_judge_no_result');
          const significant = Math.abs(delta.moodDelta) >= cfg.sigMood ||
            engine.DIMS.some(([k]) => Math.abs(delta.dims[k] || 0) >= cfg.sigDim);
          const changed = Math.round(delta.moodDelta / engine.MOOD_STEP_DIVISOR) !== 0 ||
            engine.DIMS.some(([k]) => delta.dims[k] !== 0);
          if (changed) engine.applyDelta(s, delta, cfg.moodFloor, !significant);
          persist(s); status.seen_ids = [...status.seen_ids, turn.id].slice(-200);
          status.judged++; status.last_error = '';
        } catch {status.failures++; status.last_error = 'lilith_mood_judge_failed';}
        finally {status.judging = false; publish();}
      };
      // Native SDK wait includes this bounded judgement so a next turn can see
      // its result. Errors stay out of the ordinary reply and never call tools.
      const next = chain.catch(() => {}).then(work); chain = next;
      await next;
    }));
    mounted.set(agent, () => {for (const off of localOffs) off?.();});
  }
  disposers.push(ctx.on('agent/created', ({agent}) => mount(agent)));
  disposers.push(ctx.on('agent/disposed', ({agent}) => {mounted.get(agent)?.(); mounted.delete(agent);}));
  for (const agent of ctx.agents.list()) mount(agent);
  publish();
  ctx.provide('lilithMoodReady', {ready: true, version: status.version});
  const off = () => {disposed = true; status.loaded = false; publish();
    for (const d of disposers) d?.(); for (const d of mounted.values()) d(); mounted.clear();};
  ctx.effect(() => off);
  return {off, settle: () => chain, status};
}
export function apply(ctx) {installMood(ctx);}
