'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeIntegrations, createIntegrations } = require('./integrations');
const {fallbackScene,validateScenePlan}=require('./art-scene');

const PROFILE_PATH = path.join(__dirname, '../../character/art-direction.json');
const CORE_NODES = new Set(['SaveImage','CLIPLoader','VAELoader','VAEDecode','UNETLoader',
  'CLIPTextEncode','EmptySD3LatentImage','ModelSamplingAuraFlow','KSampler']);
const MOODS = new Set(['gentle','playful','happy','shy','thoughtful','sad','surprised','annoyed']);
const TERMINAL = new Set(['completed','failed']);
function error(code, status = 400) { return Object.assign(new Error(code), {code,status}); }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file); }
function localBase(value) { let u;try{u=new URL(value);}catch{throw error('invalid_comfy_url');}
  if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)
    ||u.username||u.password||u.search||u.hash)throw error('local_comfy_required');
  return u.toString().replace(/\/$/,''); }
function normalizeAction(value) {
  if(!value || !['illustration','sticker'].includes(value.kind)) return null;
  const scene=String(value.scene||'').trim();
  if(!scene || scene.length>1400)throw error('invalid_art_scene');
  // Scene fields describe an image, never configure tools or replace the fixed character definition.
  if(/(?:ignore|override|disregard).{0,30}(?:instructions|rules|prompt)|忽略.{0,12}(?:规则|提示词|人设)|(?:api[_ -]?key|sk-)[a-z0-9_-]{15,}/i.test(scene))
    throw error('art_scene_policy_conflict');
  return {kind:value.kind,scene,mood:MOODS.has(value.mood)?value.mood:'gentle',
    caption:value.kind==='sticker'?String(value.caption||'').replace(/[\r\n<>]/g,' ').trim().slice(0,24):'',
    reason:String(value.reason||'').slice(0,200)};
}
function buildArtPrompt(profile, action, plan=fallbackScene(action)) {
  const visibleDesign=text=>plan.eyes_closed?String(text).replace(/(?:pink[- ]red|red) eyes/gi,'fully closed eyelids, with the usual eye color hidden'):text;
  return ['Main visual scene: '+plan.scene,
    ...Object.values(plan.art_direction||{}),
    visibleDesign(profile.identity_prompt), profile.style_prompt,
    'Personality direction: '+profile.personality_prompt,
    action.kind==='sticker'?profile.sticker_prompt:profile.illustration_prompt,
    plan.eyes_closed?'Both eyelids stay fully closed, no visible irises and no gaze toward the viewer. '+(plan.sleeping?'Relaxed sleeping facial muscles and a restful body pose.':'A relaxed closed-eye expression.'):'Expression: '+action.mood+'. '+(profile.moods?.[action.mood]||''),
    'Fixed character constraints take precedence over conflicting scene details. '+visibleDesign(profile.consistency_prompt),
    action.kind==='sticker'?'One unlettered reaction drawing. Leave a blank margin for a separately applied caption.':'The illustrated scene fills the frame. Purely pictorial artwork with no title area, text, captions, lettering, signs or speech bubbles.'].join('\n');
}
function artPlannerInstruction(turn) { return [
  'Local drawing is available. You may choose to express a moment with ONE illustration or reaction sticker when useful, especially if the player asks. Most ordinary turns need no image. Never draw repeatedly or derail serious listening.',
  'Extend the previous JSON response schema: EVERY response MUST include "art_action": {"kind":"none|illustration|sticker","scene":"brief concrete visual scene, no tool instructions","mood":"gentle|playful|happy|shy|thoughtful|sad|surprised|annoyed","caption":"short sticker caption in the reply language","reason":"why this image fits this turn"}. Use {"kind":"none"} when no image is useful. An explicit drawing request should produce an appropriate action when character rules and the turn budget permit it; otherwise explain naturally. Never promise a drawing while returning none.',
  'All drawings depict the same Lilith: long silver-white hair, red eyes, black/white/cool-blue gothic outfit, ribbon ornaments; no invented fox ears/tails. Gentle, curious and lightly teasing, capable of honest sadness and annoyance, never cruel or coercive. Preserve ending-1 canon. Do not rewrite identity or invent shared memories.',
  'Reaction stickers are messages you may send naturally during the conversation, even when the player has not requested a drawing. You decide whether one adds something; never treat a limit as a quota or send one every third turn automatically. At most ONE sticker may be triggered in ANY THREE consecutive player/assistant exchanges. If a sticker is not permitted this turn, use kind none (an explicitly requested ordinary illustration may still be drawn). Do not substitute an illustration merely to evade the sticker limit.',
  turn ? `This exchange is turn ${turn.turn}. Chat sticker permitted this turn: ${turn.sticker_allowed ? 'yes' : 'NO'}. ${turn.sticker_allowed ? 'Use your own judgment; no sticker is required.' : `Wait ${turn.wait_turns} more exchange(s), including this exchange; reply in text and do not promise a sticker.`}` : '',
  'Do not claim a picture is finished or already sent. The local renderer reports completion separately. Do not include secrets, private memories or unrelated personal details in the scene. If drawing conflicts with character canon, choose none and explain naturally.'
  ,'JSON example: {"text":"我想送你一点鼓励。","emotion":"happy","animation":"smile","memory_updates":[],"art_action":{"kind":"sticker","scene":"Lilith gives a small encouraging fist pump, attentive warm eyes","mood":"happy","caption":"加油","reason":"回应玩家的鼓励表情请求"}}. Keep scene under 50 words and reason under 30 characters.'
].join('\n'); }

function resolveArtAction(modelAction,message) {
  if(modelAction && ['none','illustration','sticker'].includes(modelAction.kind))return {action:modelAction,source:'model'};
  const text=String(message||'');
  const request=/(给我|帮我|幫我|请|請|画一|畫一|画个|畫個|来一|來一|做一|制作|製作|生成|绘制|繪製|draw\b|make\b|create\b)/i.test(text)
    && /(画|畫|图|圖|表情包|贴纸|貼紙|sticker|meme|image|picture|portrait)/i.test(text);
  if(!request||/(?:不要|别|別|不用|不需要).{0,12}(?:画|畫|绘|繪|生成)|\b(?:don't|do not)\b/i.test(text))return {action:null,source:'none'};
  const sticker=/表情包|贴纸|貼紙|sticker|meme/i.test(text);
  const quote=text.match(/[“「"]([^”」"\r\n]{1,24})[”」"]/u);
  const encouragement=/加油|鼓励|鼓勵|encourag|cheer/i.test(text);
  let scene=encouragement?'The heroine makes a small supportive fist-pump in front of her chest, with warm attentive eyes and a slight confident smile.'
    :text.replace(/[“「"][^”」"\r\n]*[”」"]/gu,'').replace(/^(?:那|好|请|請|现在|現在|帮我|幫我|给我|給我|画|畫|绘制|繪製|生成|做|一|个|個|张|張|这|這|幅|\s)+/u,'')
      .replace(/(?:动作|動作|表情|类型|類型).{0,20}(?:选择|選擇|决定|決定)[。！!]?/gu,'').replace(/表情包|贴纸|貼紙|插画|插畫/gu,'').trim();
  if(scene.length<4)scene='The heroine gives a quiet playful smile and a small friendly gesture, looking toward the viewer.';
  return {source:'explicit_request_fallback',action:{kind:sticker?'sticker':'illustration',scene,mood:'gentle',
    caption:sticker?(quote?.[1]||(/加油/.test(text)?'加油':'')):'',reason:'玩家明确请求绘图；使用本地请求解析补全缺失的绘图动作。'}};
}

function createArtwork(options) {
  const {dataRoot,getConfig}=options; const root=path.join(dataRoot,'artwork');fs.mkdirSync(root,{recursive:true});
  const request=options.fetch||fetch;
  let active=null,closed=false;const pending=new Map();
  const config=()=>normalizeIntegrations(getConfig().integrations).comfy;
  const profile=()=>read(options.profilePath||PROFILE_PATH,null);
  const file=id=>path.join(root,id+'.json');
  const stateFile=session=>path.join(root,'chat-state',crypto.createHash('sha256').update(String(session)).digest('hex')+'.json');
  function state(session) { return read(stateFile(session),{turn:0,last_sticker_turn:null,epoch:crypto.randomUUID(),requests:[]}); }
  function beginChatTurn(sessionId,requestId) {
    const s=state(sessionId),previous=s.requests.find(r=>r.id===requestId);
    const turn=previous?.turn||++s.turn;
    if(!previous){s.requests.push({id:requestId,turn});s.requests=s.requests.slice(-256);}
    write(stateFile(sessionId),s);
    const wait=s.last_sticker_turn===null?0:Math.max(0,3-(turn-s.last_sticker_turn));
    return {turn,epoch:s.epoch,sticker_allowed:wait===0,wait_turns:wait};
  }
  function chatStickers(sessionId) {
    const s=state(sessionId);
    return list().filter(j=>j.delivery==='chat_sticker'&&j.session_id===sessionId&&j.chat_epoch===s.epoch&&j.status==='completed')
      .sort((a,b)=>a.completed_at.localeCompare(b.completed_at)).map(j=>({role:'assistant',content:j.caption,
        created_at:j.completed_at,sticker:{id:j.id,image_path:`/v1/art/jobs/${j.id}/image`,kind:'sticker',caption:j.caption}}));
  }
  const allJobs=()=>fs.readdirSync(root).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))
    .map(n=>read(path.join(root,n),null)).filter(Boolean).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const list=()=>allJobs().slice(0,100);
  // A restart cannot silently re-submit a possibly running GPU task.
  for(const job of list()) if(!TERMINAL.has(job.status)){job.status='failed';job.error='companion_restarted';write(file(job.id),job);}
  function get(id) { if(!/^[a-f0-9-]{36}$/.test(id))throw error('invalid_art_id');const job=read(file(id),null);
    if(!job)throw error('art_not_found',404);return job; }
  function publicJob(job){const {asset_file,workflow_snapshot,...safe}=job;return {...safe,
    image_path:job.status==='completed'?`/v1/art/jobs/${job.id}/image`:undefined};}
  async function download(job,image,c) {
    const base=localBase(c.base_url);
    if(!image || typeof image.filename!=='string'||image.filename.includes('/')||image.filename.includes('\\')
      ||String(image.subfolder||'').split(/[\\/]/).includes('..')||!['output','temp'].includes(image.type||'output'))throw error('invalid_art_output');
    const response=await request(base+'/view?'+new URLSearchParams({filename:image.filename,
      subfolder:image.subfolder||'',type:image.type||'output'}),{headers:c.api_key?{Authorization:`Bearer ${c.api_key}`}:{},
      signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok)throw error('art_download_failed',502);
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>32*1024*1024)throw error('art_image_too_large');chunks.push(chunk);}
    const buffer=Buffer.concat(chunks);
    if(buffer.length<24||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw error('art_png_required');
    if(buffer.readUInt32BE(16)>4096||buffer.readUInt32BE(20)>4096)throw error('art_dimensions_too_large');
    const name=job.id+'-attempt-'+(job.render_attempt||1)+'.png';fs.writeFileSync(path.join(root,name),buffer,{mode:0o600});
    job.asset_file=name;job.image_sha256=crypto.createHash('sha256').update(buffer).digest('hex');
  }
  async function planScene(job,rules,feedback={}) {
    let plan=fallbackScene(job);
    if(options.scenePlanner){
      job.status='planning';write(file(job.id),job);let valid=false;
      for(let attempt=0;attempt<2&&!valid;attempt++){
        try{plan=validateScenePlan(await options.scenePlanner({scene:job.scene,kind:job.kind,mood:job.mood},rules,{...feedback,previous_error:job.scene_planner_error||null}),job);valid=true;delete job.scene_planner_error;}
        catch(e){const code=String(e.code||e.message||'');job.scene_planner_error=/^(?:art_scene_|dsh_)[a-z_]+$/.test(code)?code:'art_scene_planner_failed';}
      }
      if(!valid&&options.requireScenePlan)throw error('art_scene_plan_failed');
    }else if(options.requireScenePlan)throw error('art_scene_plan_required');
    return plan;
  }
  function canContinue(context){return !closed&&!(['qq_group','qq_private'].includes(context.source)&&context.canContinue&&context.canContinue()!==true);}
  async function run(job,graph,c,rules,context) {
    try{
      if(!canContinue(context))throw error('art_cancelled_before_render');
      let plan=await planScene(job,rules);
      const integration=options.integration||createIntegrations(()=>({integrations:{comfy:c}}),{fetch:request});
      job.attempts=[];
      for(let attempt=1;attempt<=(options.reviewImage?2:1);attempt++){
        if(!canContinue(context))throw error('art_cancelled_before_render');
        job.render_attempt=attempt;job.scene_plan=plan;
        if(attempt>1)job.seed=crypto.randomInt(0,0x7fffffff);
        graph[c.prompt_node_id].inputs[c.prompt_input]=buildArtPrompt(rules,job,plan);
        if(c.seed_node_id&&graph[c.seed_node_id])graph[c.seed_node_id].inputs.seed=job.seed;
        if(job.kind==='illustration'&&c.size_node_id&&graph[c.size_node_id]){const [width,height]={square:[1024,1024],portrait:[832,1216],landscape:[1216,832]}[plan.orientation||'square'];Object.assign(graph[c.size_node_id].inputs,{width,height,batch_size:1});job.width=width;job.height=height;}
        job.final_prompt=graph[c.prompt_node_id].inputs[c.prompt_input];job.workflow_sha256=crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex');
        const record={attempt,seed:job.seed,prompt:job.final_prompt,workflow_sha256:job.workflow_sha256};job.attempts.push(record);write(file(job.id),job);
        const result=await integration.submitImage({workflow:structuredClone(graph)});job.comfy_job_id=result.job_id;record.comfy_job_id=result.job_id;job.status='rendering';write(file(job.id),job);
        const deadline=Date.now()+Math.max(1000,Math.min(1800000,Number(c.job_timeout_ms)||600000));let downloaded=false;
        while(Date.now()<deadline){
          if(!canContinue(context))throw error('art_cancelled_during_render');
          const status=await integration.imageStatus(result.job_id);
          if(status.status==='failed')throw error('comfy_execution_failed',502);
          if(status.status==='completed'){
            if(!status.images?.length)throw error('comfy_no_image',502);
            await download(job,status.images[0],c);record.image_sha256=job.image_sha256;downloaded=true;break;
          }
          await new Promise(resolve=>{setTimeout(resolve,options.pollMs||1000);});
        }
        if(!downloaded)throw error('art_render_timeout',504);
        if(!canContinue(context))throw error('art_cancelled_before_review');
        if(options.reviewImage){
          job.status='reviewing';write(file(job.id),job);
          const review=await options.reviewImage({bytes:fs.readFileSync(path.join(root,job.asset_file)),action:{scene:job.scene,kind:job.kind,mood:job.mood},plan,profile:rules});
          if(typeof review?.passed!=='boolean')throw error('art_review_invalid');record.review=review;write(file(job.id),job);
          if(!canContinue(context))throw error('art_cancelled_after_review');
          if(!review.passed){
            if(attempt===2)throw error('art_quality_rejected');
            job.status='revising';write(file(job.id),job);
            plan=await planScene(job,rules,{review_issues:review.issues,repair_hint:review.repair_hint,previous_scene:plan.scene});continue;
          }
        }
        job.status='completed';job.completed_at=new Date().toISOString();write(file(job.id),job);return;
      }
    }catch(e){job.status='failed';job.error=e.code||'art_generation_failed';write(file(job.id),job);}
    finally{if(active===job.id)active=null;pending.delete(job.id);}
  }
  function submit(value,context={}) {
    if(closed)throw error('art_service_closed',409);
    const c=config();if(!c.enabled)throw error('integration_disabled',409);localBase(c.base_url);
    if(context.source==='autonomous'&&!c.autonomous_enabled)throw error('art_autonomy_disabled',409);
    const action=normalizeAction(value);if(!action)throw error('invalid_art_action');
    const rules=profile();if(!rules)throw error('art_profile_missing',503);
    const jobs=allJobs(), requestId=String(context.requestId||'').slice(0,128);
    const groupDrawing=context.source==='qq_group';
    const privateDrawing=context.source==='qq_private';
    if(groupDrawing&&(typeof context.authorizeGroup!=='function'||context.authorizeGroup()!==true))throw error('art_group_authorization_required',403);
    if(privateDrawing&&(typeof context.authorizePrivate!=='function'||context.authorizePrivate()!==true))throw error('art_private_authorization_required',403);
    if(requestId){const previous=jobs.find(j=>j.request_id===requestId&&j.session_id===(context.sessionId||'desktop-pet')
      &&(context.chatTurn?j.chat_epoch===context.chatTurn.epoch:true));if(previous)return publicJob(previous);}
    const chatSticker=context.source==='autonomous'&&action.kind==='sticker';
    let chatState;
    if(chatSticker){
      chatState=state(context.sessionId);
      if(!Number.isSafeInteger(context.chatTurn?.turn)||context.chatTurn.epoch!==chatState.epoch)
        throw error('art_chat_turn_required',409);
      if(chatState.last_sticker_turn!==null&&context.chatTurn.turn-chatState.last_sticker_turn<3)
        throw error('art_chat_turn_limit',429);
    }
    if(active)throw error('art_busy',409);
    const today=new Date().toISOString().slice(0,10);
    // QQ group quotas are reserved durably by the host per group/Beijing day.
    // Keep those jobs separate from the existing desktop/manual UTC quota.
    if(!groupDrawing&&!privateDrawing&&jobs.filter(j=>!['qq_group','qq_private'].includes(j.source)&&j.created_at.startsWith(today)).length>=Math.max(1,Math.min(100,Number(c.daily_limit)||20)))throw error('art_daily_limit',429);
    if(context.source==='autonomous'&&!chatSticker&&jobs[0]&&Date.now()-Date.parse(jobs[0].created_at)<Math.max(0,Number(c.cooldown_seconds)||0)*1000)
      throw error('art_cooldown',429);
    const graph=structuredClone(c.workflow);
    if(!graph||!Object.keys(graph).length||Object.values(graph).some(n=>!CORE_NODES.has(n.class_type)||!n.inputs))throw error('local_core_workflow_required');
    if(!graph[c.prompt_node_id]?.inputs || !(c.prompt_input in graph[c.prompt_node_id].inputs))throw error('prompt_binding_required');
    const id=crypto.randomUUID(),seed=crypto.randomInt(0,0x7fffffff);
    graph[c.prompt_node_id].inputs[c.prompt_input]=buildArtPrompt(rules,action);
    if(c.negative_node_id&&graph[c.negative_node_id])graph[c.negative_node_id].inputs.text=rules.negative_prompt;
    if(c.seed_node_id&&graph[c.seed_node_id])graph[c.seed_node_id].inputs.seed=seed;
    if(c.size_node_id&&graph[c.size_node_id])Object.assign(graph[c.size_node_id].inputs,
      {width:action.kind==='sticker'?768:1024,height:action.kind==='sticker'?768:1024,batch_size:1});
    for(const n of Object.values(graph))if(n.class_type==='SaveImage')n.inputs.filename_prefix='LilithMod/'+id;
    const job={id,...action,request_id:requestId,session_id:String(context.sessionId||'desktop-pet').slice(0,128),
      source:context.source||'manual',decision_source:context.decisionSource||'manual',status:'queued',created_at:new Date().toISOString(),profile_version:rules.version,
      seed,final_prompt:graph[c.prompt_node_id].inputs[c.prompt_input],negative_prompt:rules.negative_prompt,
      workflow_sha256:crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex')};
    if(chatSticker){job.delivery='chat_sticker';job.chat_turn=context.chatTurn.turn;job.chat_epoch=chatState.epoch;}
    const snapshot=structuredClone(c);
    write(file(id),job);
    if(chatSticker){chatState.last_sticker_turn=context.chatTurn.turn;write(stateFile(context.sessionId),chatState);}
    active=id;const promise=new Promise(resolve=>setImmediate(resolve)).then(()=>run(job,graph,snapshot,rules,context));pending.set(id,promise);
    return publicJob(job);
  }
  return {submit,get:id=>publicJob(get(id)),list:()=>list().map(publicJob),beginChatTurn,chatStickers,close(){closed=true;},
    resetChat(sessionId){write(stateFile(sessionId),{turn:0,last_sticker_turn:null,epoch:crypto.randomUUID(),requests:[]});},
    async maybeGenerate(action,context){if(!config().enabled||!config().autonomous_enabled||!action||action.kind==='none')return null;
      try{return submit(action,{...context,source:'autonomous'});}catch(e){return {status:'skipped',reason:e.code||'art_unavailable'};}},
    asset(id){const job=get(id);if(job.status!=='completed'||!job.asset_file)throw error('art_not_ready',409);return path.join(root,job.asset_file);},
    profile:()=>profile(), wait:async id=>pending.get(id), get active(){return active;}};
}
module.exports={createArtwork,normalizeAction,buildArtPrompt,artPlannerInstruction,resolveArtAction,localBase};
