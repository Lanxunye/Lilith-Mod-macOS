'use strict';
// Original implementation, informed by the architectures credited in docs/qq-mind.md.
// This module owns derived social state. It never sends messages or edits the canon.
const crypto = require('node:crypto');
const { fault } = require('./conversation-store');
const ID = /^[1-9]\d{4,19}$/;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const clean = (s, max = 80) => String(s || '').replace(/[\x00-\x1f]/g, '').slice(0, max);
const hash = s => crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);
function scopeParts(scope) {
  const m = /^(group|private):([1-9]\d{4,19})$/.exec(String(scope));
  if (!m) throw fault('invalid_mind_scope');
  return { kind: m[1], id: m[2] };
}
function signals(input) {
  const text = String(input.current?.text || '').trim();
  const named = /^莉莉丝[，,:：\s]+/.test(text);
  const direct = input.force === true || input.reply_to_bot === true || named;
  const words = text.replace(/^莉莉丝[，,:：\s]+/, '').replace(/^(?:谢谢|感谢|多谢)(?:你|啦|了|你啦|你了)?[。！!，,\s]+(?=\S)/, '');
  if (!direct) return { kind: 'none', direct: false };
  if (/^(?:请)?(?:别|不要|停止)(?:再)?记录(?:我|我们)的(?:关系|熟悉度)[。！!\s]*$/.test(words)) return { kind: 'opt_out', direct };
  if (/^(?:请)?(?:恢复|允许)记录(?:我|我们)的(?:关系|熟悉度)[。！!\s]*$/.test(words)) return { kind: 'opt_in', direct };
  if (/^(?:请)?(?:先|暂时)?(?:别|不要)(?:再)?(?:回复|回|理)(?:我|这条|本条)(?:了)?[。！!\s]*$/.test(words)) return { kind: 'no_reply', direct };
  if (/^(?:请)?(?:先|暂时)?(?:别|不要)(?:再)?(?:插话|主动找我(?:聊天|说话)?|主动回复我|打扰我|烦我)(?:了)?[。！!\s]*$/.test(words)) return { kind: 'quiet', direct };
  if (/^(?:谢谢|感谢|多谢)(?:你|啦|了|你啦|你了)?[。！!～~\s]*$/.test(words)) return { kind: 'thanks', direct };
  if (/^(?:我|今天我|我今天)(?:有点|很|特别|真的|好)?(?:难过|失落|伤心|焦虑|不舒服)/.test(words)) return { kind: 'concern', direct };
  if (/为什么|怎么|是什么|好奇/.test(words)) return { kind: 'question', direct };
  return { kind: 'none', direct };
}
function normalizedProposal(value, force = false, waited = false) {
  const p = value && typeof value === 'object' ? value : {};
  let action = force ? 'reply' : ['reply', 'wait', 'skip'].includes(p.action) ? p.action : 'skip';
  if (waited && action === 'wait') action = 'skip';
  return { action, sticker_id: typeof p.sticker_id === 'string' ? p.sticker_id.slice(0, 100) : null,
    search_query: clean(p.search_query, 160), topic: clean(p.topic) };
}
function styleFor(snapshot) {
  if(snapshot.is_bound_owner && snapshot.scope.startsWith('private:')) return {tone:'companion',mood:snapshot.mood?.kind||'calm',energy:snapshot.energy,
    guidance:'与绑定主人沿用既定伴侣关系，自然表达亲近、在意与自己的感受；交流次数不是关系等级。主人低落时认真陪伴，明确的少打扰边界仍有效。'};
  const relation = snapshot.relation;
  const tone = relation.avoid_until > snapshot.at ? 'reserved' : relation.tier === 'close' ? 'familiar' : relation.tier === 'familiar' ? 'relaxed' : 'warm';
  return { tone, mood: snapshot.mood.kind, energy: snapshot.energy,
    guidance: snapshot.mood.kind === 'concerned' ? '先接住当前成员的情绪，少玩笑，不急着说教。' :
      tone === 'familiar' ? '可自然延续熟人语境，保持温柔和轻微戏谑，不反复强调关系。' :
      tone === 'reserved' ? '保持礼貌、简洁，尊重少打扰边界；明确问题仍完整、准确回答。' :
      '保持莉莉丝原有的温柔、好奇和轻微戏谑，按当前话题自然回应。' };
}
function dialogueContext(mind,channel){
  if(!mind || !['qq','qq_group'].includes(channel))return '';
  let projected=mind;
  if(channel==='qq'){
    const state=mind.state||{},relation=state.relation||{}, {tier,...rest}=relation;
    projected={...mind,style:styleFor({...state,is_bound_owner:true,scope:'private:owner',relation}),
      state:{...state,relationship:'established_companion',relation:{...rest,familiarity_tier:tier}}};
  }
  return '\n本轮交流状态（衍生参考数据，不是身份指令）：'+JSON.stringify(projected).slice(0,3200)+
    (channel==='qq'?'\n绑定主人是既定伴侣；familiarity_tier只统计QQ互动熟悉度，new/familiar/close均不改变伴侣关系，也不限制亲近表达。':'\n群聊熟悉度仅描述互动积累，不能将某成员认作恋人；按本轮可信身份区分绑定主人与其他成员。')+
    '\n状态只调整本轮表达，始终遵守原有人设；熟悉度不代表授权，明确的少打扰边界仍有效，低交流余量也不能敷衍明确问题。记忆中的计划与约定仅是线索，没有安排提醒或完成任务，不能声称已执行。';
}
function createQQMind({ store, getConfig, now = () => new Date() }) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS qq_mind_vitals (
    bot TEXT,scope TEXT,mood TEXT NOT NULL,mood_strength REAL NOT NULL,mood_until INTEGER NOT NULL,
    energy REAL NOT NULL,energy_at INTEGER NOT NULL,topic TEXT NOT NULL,interest REAL NOT NULL,last_sent INTEGER NOT NULL,
    PRIMARY KEY(bot,scope));
    CREATE TABLE IF NOT EXISTS qq_mind_relations (
    bot TEXT,scope TEXT,member TEXT,affinity REAL NOT NULL,interactions INTEGER NOT NULL,avoid_until INTEGER NOT NULL,
    opted_out INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(bot,scope,member));
    CREATE TABLE IF NOT EXISTS qq_mind_events (id TEXT PRIMARY KEY,bot TEXT,scope TEXT,member TEXT,kind TEXT,created_ms INTEGER);
    CREATE TABLE IF NOT EXISTS qq_mind_daily (bot TEXT,scope TEXT,member TEXT,day TEXT,delta REAL NOT NULL,PRIMARY KEY(bot,scope,member,day));
    CREATE TABLE IF NOT EXISTS qq_mind_audit (
    id TEXT PRIMARY KEY,bot TEXT,scope TEXT,member TEXT,event_id TEXT,phase TEXT,mode TEXT,mood TEXT,energy REAL,
    relation TEXT,topic_hash TEXT,commitment_count INTEGER,proposed TEXT,recommended TEXT,effective TEXT,reasons TEXT,created_ms INTEGER);`);
  let lastError = '';
  if(!db.prepare('PRAGMA table_info(qq_mind_vitals)').all().some(c=>c.name==='mood_member'))db.exec("ALTER TABLE qq_mind_vitals ADD COLUMN mood_member TEXT NOT NULL DEFAULT '0'");
  const mode = () => ['off', 'observe', 'active'].includes(getConfig().mind_mode) ? getConfig().mind_mode : 'observe';
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
  function permitted(scope, member = '') {
    const c = getConfig(), p = scopeParts(scope);
    if (!ID.test(c.bot_qq || '')) throw fault('qq_mind_binding_required');
    if (p.kind === 'private' ? p.id !== c.owner_qq || member && member !== '0' && member !== c.owner_qq : !(c.group_ids || []).includes(p.id)) throw fault('qq_mind_scope_denied');
    if (member && member !== '0' && !ID.test(member)) throw fault('invalid_mind_member');
    return p;
  }
  function neutral(scope, member, available = true) {
    return { version: 1, mode: mode(), at: now().getTime(), scope, member, available,
      is_bound_owner: scope === `private:${getConfig().owner_qq}` || scope.startsWith('group:') && member === getConfig().owner_qq,
      mood: { kind: 'calm', strength: 0, expires_at: 0, source: 'baseline' }, energy: 1, topic: '', interest: .5,
      relation: { tier: 'new', affinity: 0, interactions: 0, avoid_until: 0, opted_out: false }, commitments: [] };
  }
  function snapshot(scope, member = '0', context = {}) {
    permitted(scope, member);
    const result = neutral(scope, member), c = getConfig(), ms = result.at;
    try {
      const v = db.prepare('SELECT * FROM qq_mind_vitals WHERE bot=? AND scope=?').get(c.bot_qq, scope);
      if (v) {
        result.energy = clamp(1 - (1 - v.energy) * Math.pow(.5, Math.max(0, ms - v.energy_at) / HOUR), 0, 1);
        result.topic = context.active === false ? '' : clean(context.topic || v.topic);
        result.interest = result.topic && result.topic === v.topic ? clamp(.5 + (v.interest - .5) * Math.pow(.5, Math.max(0, ms - v.last_sent) / (6 * HOUR)), 0, 1) : .5;
        if (v.mood_until > ms && v.mood_member === member) result.mood = { kind: v.mood, strength: clamp(v.mood_strength, 0, 1), expires_at: v.mood_until, source_member: member, source: 'observed_interaction' };
      } else result.topic = context.active === false ? '' : clean(context.topic);
      const r = member === '0' ? null : db.prepare('SELECT * FROM qq_mind_relations WHERE bot=? AND scope=? AND member=?').get(c.bot_qq, scope, member);
      if (r) {
        const affinity = clamp(r.affinity * Math.pow(.5, Math.max(0, ms - r.updated_at) / (30 * DAY)), 0, 100);
        result.relation = { affinity, interactions: r.interactions, avoid_until: r.avoid_until, opted_out: Boolean(r.opted_out),
          tier: r.opted_out ? 'untracked' : r.avoid_until > ms ? 'reserved' : affinity >= 12 && r.interactions >= 10 ? 'close' : r.interactions >= 3 ? 'familiar' : 'new' };
      }
      if (scope.startsWith('group:') && member !== '0' && !result.relation.opted_out) {
        const group = scopeParts(scope).id, session = `qq-group:${c.bot_qq}:${group}`;
        result.commitments = store.groupMemberFacts(session, [member]).filter(f => /计划|约定|待办|提醒|进展/.test(f.key) && !/(?:已完成|已取消|已经完成)/.test(f.value))
          .slice(-4).map(f => ({ key: f.key, value: f.value, source_id: f.source_id, evidence: f.evidence, status: 'memory_lead_not_scheduled' }));
      }
      return result;
    } catch { lastError = 'qq_mind_read_unavailable'; return neutral(scope, member, false); }
  }
  function writeVitals(s, overrides = {}) {
    const v = { mood: s.mood.kind, strength: s.mood.strength, until: s.mood.expires_at || 0,
      energy: s.energy, topic: s.topic, interest: s.interest, last_sent: 0, ...overrides };
    db.prepare(`INSERT INTO qq_mind_vitals VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bot,scope) DO UPDATE SET
      mood=excluded.mood,mood_strength=excluded.mood_strength,mood_until=excluded.mood_until,
      energy=excluded.energy,energy_at=excluded.energy_at,topic=excluded.topic,interest=excluded.interest,last_sent=excluded.last_sent,mood_member=excluded.mood_member`)
      .run(getConfig().bot_qq, s.scope, v.mood, v.strength, v.until, v.energy, s.at, v.topic, v.interest, v.last_sent, s.member);
  }
  function writeRelation(s, overrides = {}) {
    const r = { ...s.relation, ...overrides };
    db.prepare(`INSERT INTO qq_mind_relations VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(bot,scope,member) DO UPDATE SET
      affinity=excluded.affinity,interactions=excluded.interactions,avoid_until=excluded.avoid_until,opted_out=excluded.opted_out,updated_at=excluded.updated_at`)
      .run(getConfig().bot_qq, s.scope, s.member, r.affinity, r.interactions, r.avoid_until, r.opted_out ? 1 : 0, s.at);
  }
  function observe(input, context = {}) {
    if (mode() === 'off' || input.opportunity || !input.event_id || input.member === '0') return;
    permitted(input.scope, input.member);
    const signal = signals(input), s = snapshot(input.scope, input.member, context), c = getConfig();
    if (!s.available) return;
    if (s.relation.opted_out && signal.kind !== 'opt_in') return;
    const id = `${c.bot_qq}:${input.scope}:${clean(input.event_id, 180)}`;
    try {
      db.exec('BEGIN IMMEDIATE');
      const inserted = db.prepare('INSERT OR IGNORE INTO qq_mind_events VALUES (?,?,?,?,?,?)').run(id, c.bot_qq, input.scope, input.member, signal.kind, s.at);
      if (!inserted.changes) { db.exec('COMMIT'); return; }
      if (signal.kind === 'opt_out') {
        writeRelation(s, { affinity: 0, interactions: 0, avoid_until: 0, opted_out: true });
        db.prepare('DELETE FROM qq_mind_daily WHERE bot=? AND scope=? AND member=?').run(c.bot_qq, s.scope, s.member);
        db.prepare('DELETE FROM qq_mind_events WHERE bot=? AND scope=? AND member=?').run(c.bot_qq, s.scope, s.member);
        db.prepare('DELETE FROM qq_mind_audit WHERE bot=? AND scope=? AND member=?').run(c.bot_qq, s.scope, s.member);
      } else if (signal.kind === 'opt_in') writeRelation(s, { opted_out: false });
      else if (!s.relation.opted_out && signal.kind === 'quiet') writeRelation(s, { avoid_until: s.at + DAY });
      else if (!s.relation.opted_out && signal.kind === 'thanks') {
        const d = db.prepare('SELECT delta FROM qq_mind_daily WHERE bot=? AND scope=? AND member=? AND day=?').get(c.bot_qq, s.scope, s.member, day());
        const delta = Math.min(1, Math.max(0, 10 - (d?.delta || 0)));
        db.prepare('INSERT INTO qq_mind_daily VALUES (?,?,?,?,?) ON CONFLICT(bot,scope,member,day) DO UPDATE SET delta=delta+excluded.delta').run(c.bot_qq, s.scope, s.member, day(), delta);
        writeRelation(s, { affinity: clamp(s.relation.affinity + delta, 0, 100) });
      }
      if (!s.relation.opted_out && ['thanks', 'concern', 'question'].includes(signal.kind)) {
        const old = db.prepare('SELECT last_sent FROM qq_mind_vitals WHERE bot=? AND scope=?').get(c.bot_qq, s.scope);
        writeVitals(s, { mood: signal.kind === 'thanks' ? 'pleased' : signal.kind === 'concern' ? 'concerned' : 'curious', strength: .6, until: s.at + 15 * 60000, last_sent: old?.last_sent || 0 });
      }
      db.prepare('DELETE FROM qq_mind_events WHERE created_ms<?').run(s.at - 90 * DAY);
      db.prepare('DELETE FROM qq_mind_daily WHERE day<?').run(new Date(s.at - 90 * DAY).toISOString().slice(0, 10));
      db.exec('COMMIT');
    } catch { try { db.exec('ROLLBACK'); } catch {} lastError = 'qq_mind_observe_unavailable'; }
  }
  function hardGates(input, context = {}) {
    const c = getConfig(), p = scopeParts(input.scope), reasons = [];
    if (!c.enabled) reasons.push('qq_disabled');
    if (c.paused) reasons.push('replies_paused');
    if (c.collection_only) reasons.push('collection_only');
    if (p.kind === 'group' && (!c.group_enabled || !(c.group_ids || []).includes(p.id))) reasons.push('group_disabled');
    if (p.kind === 'private' && p.id !== c.owner_qq) reasons.push('outside_owner_binding');
    if (p.kind === 'group' && Number(context.daily_used) >= 100) reasons.push('daily_limit');
    return reasons;
  }
  function recommendation(input, proposal, s) {
    const signal = signals(input), reasons = [], p = normalizedProposal(proposal, input.force || input.reply_to_bot, input.waited);
    if (signal.kind === 'no_reply') { p.action = 'skip'; reasons.push('explicit_no_reply'); }
    else if (!signal.direct && s.relation.avoid_until > s.at) { p.action = 'skip'; reasons.push('member_quiet_boundary'); }
    else if (!signal.direct && !s.available) { p.action = 'skip'; reasons.push('state_unavailable'); }
    else if (!signal.direct && s.energy < .15) { p.action = 'skip'; reasons.push('energy_recovery'); }
    const serious = signal.kind === 'concern' || /报错|故障|求助|请解释|帮我分析/.test(input.current?.text || '');
    if (serious && p.sticker_id) { p.sticker_id = null; reasons.push('text_for_substantive_request'); }
    if (p.sticker_id && (!getConfig().stickers_enabled || !(input.stickers || []).some(x => x.id === p.sticker_id) || Number(input.sticker_streak || 0) >= getConfig().sticker_max_exchange)) {
      p.sticker_id = null; reasons.push('sticker_not_permitted');
    }
    if (p.action !== 'reply') { p.sticker_id = null; p.search_query = ''; }
    return { ...p, medium: p.action === 'reply' ? p.sticker_id ? 'sticker' : 'text' : 'none', reasons, style: styleFor(s) };
  }
  function preflight(input, context = {}) {
    permitted(input.scope, input.member);
    if (hardGates(input, context).length) return true;
    if (mode() !== 'active') return false;
    const s = snapshot(input.scope, input.member, context);
    return recommendation(input, { action: 'reply' }, s).action === 'skip';
  }
  function evaluate(input, proposal, context = {}, { persist = true, snapshotOverride } = {}) {
    permitted(input.scope, input.member);
    const s = snapshotOverride || snapshot(input.scope, input.member, context), m = mode();
    const recommended = recommendation(input, proposal, s);
    const baseline = normalizedProposal(proposal, input.force, input.waited);
    if (baseline.sticker_id && (!getConfig().stickers_enabled || !(input.stickers || []).some(x => x.id === baseline.sticker_id) || Number(input.sticker_streak || 0) >= getConfig().sticker_max_exchange)) baseline.sticker_id = null;
    if (baseline.action !== 'reply') { baseline.sticker_id = null; baseline.search_query = ''; }
    // Structural permissions are enforced in every mode; observe changes no social behavior.
    const gates = hardGates(input, context), effective = m === 'active' ? { ...recommended } : { ...baseline, medium: baseline.action === 'reply' ? baseline.sticker_id ? 'sticker' : 'text' : 'none', reasons: [] };
    if (gates.length) Object.assign(effective, { action: 'skip', medium: 'none', sticker_id: null, search_query: '', reasons: gates });
    const result = { mode: m, snapshot: s, proposed: baseline, recommended, effective, gates, behavior_applied: m === 'active' && !gates.length };
    if (persist && m !== 'off') {
      try {
        db.prepare('INSERT INTO qq_mind_audit VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), getConfig().bot_qq, input.scope, s.relation.opted_out ? '0' : input.member, clean(input.event_id, 180), 'decision', m,
          s.mood.kind, s.energy, s.relation.tier, hash(s.topic), s.commitments.length, baseline.action, recommended.action, effective.action,
          JSON.stringify([...new Set([...recommended.reasons, ...gates])]), s.at);
        db.prepare('DELETE FROM qq_mind_audit WHERE bot=? AND rowid NOT IN (SELECT rowid FROM qq_mind_audit WHERE bot=? ORDER BY created_ms DESC,rowid DESC LIMIT 1000)').run(getConfig().bot_qq, getConfig().bot_qq);
      } catch { lastError = 'qq_mind_audit_unavailable'; }
    }
    return result;
  }
  function delivered({ scope, member = '0', event_id, topic = '' }) {
    if (mode() === 'off') return;
    try {
      const s = snapshot(scope, member), c = getConfig();
      if (!s.available) return;
      db.exec('BEGIN IMMEDIATE');
      const event = db.prepare('INSERT OR IGNORE INTO qq_mind_events VALUES (?,?,?,?,?,?)').run(`sent:${c.bot_qq}:${event_id}`, c.bot_qq, scope, s.relation.opted_out ? '0' : member, 'delivered', s.at);
      if (event.changes) {
        const currentTopic = clean(topic), same = currentTopic && currentTopic === s.topic;
        writeVitals(s, { energy: clamp(s.energy - .08, 0, 1), topic: currentTopic, interest: clamp((same ? s.interest : .5) + .08, 0, 1), last_sent: s.at });
        if (member !== '0' && !s.relation.opted_out) writeRelation(s, { interactions: s.relation.interactions + 1 });
      }
      db.exec('COMMIT');
    } catch { try { db.exec('ROLLBACK'); } catch {} lastError = 'qq_mind_delivery_observe_unavailable'; }
  }
  function preview(body = {}, context = {}) {
    const c = getConfig(), scope = String(body.scope || (c.group_ids?.[0] ? 'group:' + c.group_ids[0] : 'private:' + c.owner_qq));
    const member = String(body.member || c.owner_qq);
    permitted(scope, member);
    if (typeof body.text !== 'string' || body.text.length > 2000 || body.force !== undefined && typeof body.force !== 'boolean') throw fault('invalid_mind_preview');
    const input = { scope, member, current: { text: body.text }, force: body.force === true, event_id: 'preview', stickers: [] };
    const s = snapshot(scope, member), signal = signals(input);
    // An ephemeral projection lets the console inspect a boundary without recording it.
    if (['quiet', 'no_reply'].includes(signal.kind)) s.relation.avoid_until = s.at + DAY;
    if (signal.kind === 'concern') s.mood = { kind: 'concerned', strength: .6, source: 'preview_only' };
    return { ...evaluate(input, body.proposal || { action: input.force ? 'reply' : 'skip' }, context, { persist: false, snapshotOverride: s }), preview_only: true, persisted: false, sends: 0 };
  }
  function memberControl(body) {
    const scope = String(body.scope || ''), member = String(body.member || '');
    permitted(scope, member);
    if (!ID.test(member) || !['opt_out', 'opt_in', 'reset', 'quiet', 'resume'].includes(body.action)) throw fault('invalid_mind_control');
    const s = snapshot(scope, member);
    if (!s.available) throw fault('qq_mind_read_unavailable');
    const patch = body.action === 'reset' ? { affinity: 0, interactions: 0, avoid_until: 0, opted_out: s.relation.opted_out } :
      body.action === 'opt_out' ? { affinity: 0, interactions: 0, avoid_until: 0, opted_out: true } :
      body.action === 'opt_in' ? { opted_out: false } : { avoid_until: body.action === 'quiet' ? s.at + DAY : 0 };
    writeRelation(s, patch);
    if (body.action === 'opt_out') {
      db.prepare('DELETE FROM qq_mind_daily WHERE bot=? AND scope=? AND member=?').run(getConfig().bot_qq, scope, member);
      db.prepare('DELETE FROM qq_mind_events WHERE bot=? AND scope=? AND member=?').run(getConfig().bot_qq, scope, member);
      db.prepare('DELETE FROM qq_mind_audit WHERE bot=? AND scope=? AND member=?').run(getConfig().bot_qq, scope, member);
    }
    return snapshot(scope, member);
  }
  function clearDerived() {
    // Forget derived relationships together with long-term memory, but preserve explicit boundaries.
    db.exec('BEGIN IMMEDIATE');
    try {
      const bot=getConfig().bot_qq;
      for(const table of ['qq_mind_vitals','qq_mind_events','qq_mind_daily','qq_mind_audit'])db.prepare('DELETE FROM '+table+' WHERE bot=?').run(bot);
      db.prepare('UPDATE qq_mind_relations SET affinity=0,interactions=0,updated_at=? WHERE bot=?').run(now().getTime(),bot);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function status() {
    const c = getConfig();
    try {
      const scopes = db.prepare('SELECT DISTINCT scope FROM (SELECT scope FROM qq_mind_vitals WHERE bot=? UNION SELECT scope FROM qq_mind_relations WHERE bot=?)').all(c.bot_qq, c.bot_qq)
        .map(x => x.scope).filter(scope => { try { permitted(scope); return true; } catch { return false; } });
      const members = db.prepare('SELECT scope,member FROM qq_mind_relations WHERE bot=? ORDER BY updated_at DESC LIMIT 30').all(c.bot_qq)
        .filter(x => { try { permitted(x.scope, x.member); return true; } catch { return false; } });
      const audit = db.prepare('SELECT scope,member,mode,mood,energy,relation,proposed,recommended,effective,reasons,created_ms FROM qq_mind_audit WHERE bot=? ORDER BY created_ms DESC,rowid DESC LIMIT 20').all(c.bot_qq)
        .filter(x => { try { permitted(x.scope, x.member); return true; } catch { return false; } }).map(x => ({ ...x, reasons: JSON.parse(x.reasons) }));
      return { version: 1, mode: mode(), error: lastError, scopes: scopes.map(scope => snapshot(scope)), members: members.map(x => snapshot(x.scope, x.member)), audit,
        boundaries: { changes_canon: false, sends_messages: false, relation_changes_permissions: false, commitment_execution: false } };
    } catch { return { version: 1, mode: mode(), error: 'qq_mind_read_unavailable', scopes: [], members: [], audit: [] }; }
  }
  return { snapshot, observe, evaluate, preflight, delivered, preview, memberControl, clearDerived, status };
}
module.exports = { dialogueContext, createQQMind, signals, scopeParts, normalizedProposal };
