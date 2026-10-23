'use strict';
const token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('lilith-local-token') || '';
if (token) { sessionStorage.setItem('lilith-local-token', token); history.replaceState(null, '', location.pathname); }
const $ = id => document.getElementById(id);
let config = {}, facts = [], playerName = '你', selectedTaskId = '', taskSignature = '';
function notice(text) { $('notice').textContent = text; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error === 'unauthorized' ? '请从游戏的 Mod 设置入口重新打开此页面。' : value.error || '请求失败');
  return value;
}
function tab(name) {
  for (const section of document.querySelectorAll('main > section')) section.hidden = section.id !== name;
  for (const button of document.querySelectorAll('nav button')) button.classList.toggle('active', button.dataset.tab === name);
  document.title = name === 'chat' ? '莉莉丝 · 聊天' : '莉莉丝 · Mod 设置';
}
for (const button of document.querySelectorAll('nav button')) button.onclick = () => tab(button.dataset.tab);
const fields = [
  ['对话服务', [
    ['mock_mode','模拟回复','checkbox'],['provider.kind','服务类型','select',['custom','deepseek','kimi','qwen','glm','gemini']],
    ['provider.base_url','API 地址','url'],['provider.api_key','API 密钥','password'],['provider.model','模型名称','text'],
    ['provider.wire_api','接口格式','select',['chat_completions','responses','gemini_interactions']],
    ['provider.thinking_mode','思考模式','text'],['provider.reasoning_effort','思考强度','text'],
    ['provider.temperature','温度','number'],['provider.max_tokens','最大回复 Tokens','number'],
    ['provider.timeout_ms','请求超时（毫秒）','number'],['network.proxy_url','HTTP / HTTPS 代理','url']]],
  ['角色与对话', [
    ['ui.language_mode','语言','select',['follow_game','zh-CN','zh-TW','en','ja']],
    ['conversation.reply_max_chars','回复字数上限','number'],
    ['conversation.allow_parenthetical_actions','允许括号内动作描写','checkbox'],
    ['memory.max_messages','上下文消息数量','number'],['memory.max_chars_per_message','每条上下文字符上限','number'],
    ['memory.long_term_max_items','长期记忆条数上限','number']]],
  ['本机感知与搜索', [
    ['local_context.enabled','启用本机上下文','checkbox'],['local_context.time_enabled','感知本机时间','checkbox'],
    ['local_context.media_enabled','感知音乐播放状态','checkbox'],['media.enabled','音乐桥接（Apple Music / Spotify，需自动化权限）','checkbox'],
    ['music.preferred_player','首选播放器','select',['netease','applemusic','spotify','qqmusic','amazonmusic']],
    ['web_search.enabled','启用网络搜索','checkbox'],['web_search.backend','搜索方式','select',['off','provider','brave','searxng']],
    ['web_search.base_url','搜索服务地址','url'],['web_search.api_key','搜索 API 密钥','password']]]
];
const extensions = [
  ['DeepSeek Harness（DSH）', [['integrations.dsh.enabled','启用 DSH 自动协作','checkbox'],
    ['integrations.dsh.default_mode','默认协作方式','select',['auto','chat','dsh']],
    ['integrations.dsh.read_roots','允许读取的文件或文件夹（每行一个绝对路径）','multiline'],
    ['integrations.dsh.allow_write','允许在任务目录创建新文件','checkbox'],
    ['integrations.dsh.allow_web','允许联网检索','checkbox'],
    ['integrations.dsh.model','任务模型（留空沿用对话模型）','text'],
    ['integrations.dsh.base_url','Messages API 地址（留空使用 DeepSeek 官方）','url'],
    ['integrations.dsh.task_timeout_ms','任务最长运行时间（毫秒）','number'],
    ['integrations.dsh.max_tokens','每步最大输出 Tokens','number'],
    ['integrations.dsh.executable','本机 DSH 启动程序','text']]],
  ['ComfyUI · 本地 Qwen 绘图', [['integrations.comfy.enabled','启用绘图接口','checkbox'],
    ['integrations.comfy.base_url','ComfyUI 地址','url'],['integrations.comfy.model_label','模型显示名称','text'],
    ['integrations.comfy.autonomous_enabled','允许莉莉丝自主选择绘图 / 表情包','checkbox'],
    ['integrations.comfy.cooldown_seconds','普通自主插画间隔（秒）','number'],['integrations.comfy.daily_limit','每日生成上限','number'],
    ['integrations.comfy.api_key','服务密钥（可选）','password'],
    ['integrations.comfy.prompt_node_id','提示词节点 ID','text'],['integrations.comfy.prompt_input','提示词输入字段','text'],
    ['integrations.comfy.workflow','导出的 API 工作流 JSON','json']]]
];
function get(object, path) { return path.split('.').reduce((v, key) => v && v[key], object); }
function set(object, path, value) { const keys = path.split('.'); let target = object;
  for (const key of keys.slice(0,-1)) target = target[key] ||= {}; target[keys.at(-1)] = value; }
function renderFields(target, groups) {
  $(target).replaceChildren();
  for (const [name, items] of groups) {
    const fieldset = document.createElement('fieldset'), legend = document.createElement('legend');
    legend.textContent = name; fieldset.append(legend);
    for (const [path, label, type, choices] of items) {
      const row = document.createElement('label'); row.className = 'field';
      const title = document.createElement('span'); title.textContent = label;
      const input = document.createElement(type === 'select' ? 'select' : ['json','multiline'].includes(type) ? 'textarea' : 'input');
      input.dataset.path = path; input.dataset.kind = type; input.setAttribute('aria-label', label);
      if (type === 'select') for (const choice of choices) { const option = document.createElement('option'); option.value = choice; option.textContent = choice; input.append(option); }
      else if (!['json','multiline'].includes(type)) input.type = type;
      const value = get(config, path);
      if (type === 'checkbox') input.checked = Boolean(value);
      else if (type === 'password') { input.autocomplete = 'off'; input.placeholder = get(config, path.replace(/(api_key|api_token|event_secret)$/, '$1_configured')) ? '已保存；留空保留原密钥' : '尚未配置'; }
      else if (type === 'json') { input.value = JSON.stringify(value || {}, null, 2); input.rows = 8; }
      else input.value = value ?? '';
      if (type === 'number') input.step = path.endsWith('temperature') ? '0.05' : '1';
      row.append(title,input); fieldset.append(row);
    }
    $(target).append(fieldset);
  }
}
function collect(form) { const patch = {};
  for (const input of form.querySelectorAll('[data-path]')) {
    const type = input.dataset.kind;
    if (type === 'password' && !input.value) continue;
    const value = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value)
      : type === 'json' ? JSON.parse(input.value) : input.value;
    set(patch,input.dataset.path,value);
  } return patch;
}
for (const id of ['settings-form','extension-form']) $(id).onsubmit = async event => {
  event.preventDefault();
  try { const result = await api('/v1/settings',{method:'PATCH',body:JSON.stringify(collect(event.target))});
    config = result.config; renderFields('setting-fields',fields); renderFields('extension-fields',extensions);
    notice('设置已保存，莉莉丝已重新读取配置。'); } catch(error) { notice(error.message); }
};
let chatSignature='';
function renderMessages(items) { $('messages').replaceChildren();
  for(const item of items) { const div = document.createElement('div'); div.className = 'message '+item.role;
    const label=document.createElement('strong');label.textContent=item.role==='assistant'?'莉莉丝':playerName;
    const text=document.createElement('span');text.textContent=item.content;div.append(label);
    if(item.sticker){const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`莉莉丝发来的表情包：${item.content||'表情'}`);
      canvas.className='chat-sticker';div.append(canvas);
      loadArtImage({...item.sticker,kind:'sticker'},canvas).then(()=>{$('messages').scrollTop=$('messages').scrollHeight;}).catch(()=>{text.textContent='表情包暂时无法显示，可在小画室查看。';div.append(text);});
    }else div.append(text);
    $('messages').append(div); }
  $('messages').scrollTop=$('messages').scrollHeight;
}
async function historyLoad() { const result=await api('/v1/session/desktop-pet/history');
  const signature=JSON.stringify(result.messages);if(signature===chatSignature)return;
  chatSignature=signature;renderMessages(result.messages); }
$('chat-form').onsubmit=async event=>{event.preventDefault();const message=$('message').value.trim();if(!message)return;
  $('send').disabled=true;notice('莉莉丝正在想怎么回应你……');
  try {await api('/v1/session/desktop-pet/message',{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),
    player:{name:playerName},mode:'in_character',task_mode:$('task-mode').value,
    ...(selectedTaskId?{task_id:selectedTaskId}:{}),message})});$('message').value='';
    if($('task-mode').value==='dsh')$('task-mode').value='auto';selectedTaskId='';$('task-target').replaceChildren();
    await historyLoad();await taskLoad();notice('');}
  catch(error){notice(error.message);}finally{$('send').disabled=false;}};
$('reset-session').onclick=async()=>{if(!confirm('开始新对话？当前对话会清空，长期记忆保留。'))return;
  try{await api('/v1/control',{method:'POST',body:JSON.stringify({action:'reset_session',session_id:'desktop-pet'})});selectedTaskId='';$('task-target').replaceChildren();await historyLoad();await taskLoad();notice('已开始新对话。');}catch(error){notice(error.message);}};
function renderMemory(){ $('memory-facts').replaceChildren();for(const fact of facts){const row=document.createElement('div');row.className='fact';
  const key=document.createElement('input'),value=document.createElement('input'),remove=document.createElement('button');
  key.value=fact.key;value.value=fact.value;key.setAttribute('aria-label','记忆名称');value.setAttribute('aria-label','记忆内容');
  key.oninput=()=>fact.key=key.value;value.oninput=()=>fact.value=value.value;remove.textContent='移除';remove.onclick=()=>{facts=facts.filter(f=>f!==fact);renderMemory();};row.append(key,value,remove);$('memory-facts').append(row);}}
$('add-fact').onclick=()=>{facts.push({key:'',value:''});renderMemory();};
$('save-memory').onclick=async()=>{try{const result=await api('/v1/player-memory',{method:'PUT',body:JSON.stringify({facts})});facts=result.facts;renderMemory();notice('记忆已保存。');}catch(error){notice(error.message);}};
async function updateName(operation){try{notice('正在等待游戏检查称呼……');
  const result=await api('/v1/player-name',{method:'POST',body:JSON.stringify({operation,name:$('player-name').value})});
  if(!result.success)throw new Error(result.error||'游戏未接受该名称。');
  if(operation==='apply'){playerName=result.applied_name;$('player-name').value=playerName;
    facts=(await api('/v1/player-memory')).facts||[];renderMemory();await historyLoad();}
  notice(operation==='validate'?`游戏接受的名称：${result.applied_name}`:'称呼已保存，记忆已合并。');
}catch(error){notice(error.message);}}
$('validate-name').onclick=()=>updateName('validate');
$('name-form').onsubmit=event=>{event.preventDefault();updateName('apply');};
(async()=>{try{if(!token)throw new Error('请从游戏的 Mod 设置入口打开此页面。');
  const settings=await api('/v1/settings');config=settings.config;renderFields('setting-fields',fields);renderFields('extension-fields',extensions);
  $('task-mode').value=config.integrations?.dsh?.default_mode||'auto';
  const state=await api('/v1/game-state');playerName=state.PlayerName||state.player_name||'你';
  $('player-name').value=playerName;
  const memory=await api('/v1/player-memory');facts=memory.facts||[];renderMemory();await historyLoad();
  $('connection').textContent=config.mock_mode?'模拟回复':'真实模型模式';tab(location.pathname.endsWith('/qq')?'qq':location.pathname.endsWith('/art')?'art':location.pathname.endsWith('/chat')?'chat':'settings');
  if(location.pathname.endsWith('/art'))await artLoad(true);await taskLoad();
  if(config.mock_mode)notice('当前使用模拟回复。填写模型信息并关闭模拟回复后，可连接真实模型。');
}catch(error){$('connection').textContent='未连接';notice(error.message);tab('settings');}})();

const taskLabels={queued:'等待执行',starting:'准备中',running:'执行中',stopping:'正在停止',completed:'已完成',needs_input:'需要补充',failed:'未完成',stopped:'已停止',interrupted:'已中断'};
const taskErrors={dsh_provider_required:'请配置有效的对话服务并关闭模拟回复。',dsh_not_installed:'没有找到本机 DSH 启动程序。',dsh_auth_failed:'DeepSeek 密钥验证失败，请更新密钥。',dsh_execution_failed:'DSH 执行失败，请检查模型或续办任务。',task_timeout:'任务超过设定时间，已停止。',companion_restarted:'上次运行已中断，可续办。'};
async function taskLoad(){
  const {tasks}=await api('/v1/tasks?session_id=desktop-pet');const signature=JSON.stringify(tasks);
  if(signature===taskSignature)return;taskSignature=signature;
  const expanded=new Set([...$('task-cards').querySelectorAll('details[open]')].map(d=>d.dataset.task));
  $('task-cards').replaceChildren();
  for(const task of tasks.slice(0,8)){
    const card=document.createElement('article');card.className='task-card';
    const title=document.createElement('h3');title.textContent=`${taskLabels[task.status]||task.status} · ${task.goal}`;
    const progress=document.createElement('p');progress.textContent=taskErrors[task.error]||task.progress;card.append(title,progress);
    if(['queued','starting','running','stopping'].includes(task.status)){
      const stop=document.createElement('button');stop.type='button';stop.textContent='停止任务';stop.disabled=task.status==='stopping';
      stop.onclick=async()=>{stop.disabled=true;try{await api(`/v1/tasks/${task.id}/stop`,{method:'POST',body:'{}'});await taskLoad();}catch(e){notice(e.message);stop.disabled=false;}};card.append(stop);
    }
    {
      const follow=document.createElement('button');follow.type='button';follow.textContent=['queued','running'].includes(task.status)?'补充任务要求':'接着这项任务说';
      follow.onclick=()=>{selectedTaskId=task.id;$('task-mode').value='dsh';$('task-target').textContent='正在续办：'+task.goal;
        const clear=document.createElement('button');clear.type='button';clear.textContent='取消关联';clear.onclick=()=>{selectedTaskId='';$('task-target').replaceChildren();};$('task-target').append(clear);$('message').focus();};card.append(follow);
    }
    if(task.result){const details=document.createElement('details');details.dataset.task=task.id;details.open=expanded.has(task.id);
      const summary=document.createElement('summary');summary.textContent='查看完整结果';const content=document.createElement('pre');content.textContent=task.result;details.append(summary,content);card.append(details);}
    for(const file of task.artifacts){const download=document.createElement('button');download.type='button';download.textContent='保存 '+file.name;
      download.onclick=async()=>{try{const response=await fetch(file.download_path,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('文件暂时无法读取');
        const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message);}};card.append(download);}
    $('task-cards').append(card);
  }
}
const artImages=new Map();let artSignature='';
const artStatuses={queued:'等待绘制',rendering:'正在本机绘制',completed:'已完成',failed:'绘制失败'};
async function loadArtImage(job,canvas){
  let image=artImages.get(job.id);
  if(!image){const response=await fetch(job.image_path,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('图片暂不可用');
    const url=URL.createObjectURL(await response.blob());image=new Image();image.src=url;
    try{await image.decode();}finally{URL.revokeObjectURL(url);}artImages.set(job.id,image);}
  const sticker=job.kind==='sticker',size=Math.min(1024,image.naturalWidth);
  canvas.width=size;canvas.height=sticker?size+Math.round(size*.15):Math.round(image.naturalHeight*size/image.naturalWidth);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,0,0,size,sticker?size:canvas.height);
  if(sticker&&job.caption){ctx.fillStyle='#171720';ctx.textAlign='center';ctx.textBaseline='middle';
    const font=Math.max(16,Math.min(size*.075,size*.88/Math.max(1,[...job.caption].length)));
    ctx.font=`600 ${font}px "PingFang SC",sans-serif`;ctx.fillText(job.caption,size/2,size+(canvas.height-size)/2,size*.92);}
}
async function artLoad(force=false){try{
  const {jobs}=await api('/v1/art/jobs');const signature=JSON.stringify(jobs.map(j=>[j.id,j.status]));
  if(signature===artSignature&&!force)return;artSignature=signature;$('art-jobs').replaceChildren();
  $('art-state').textContent=config.integrations?.comfy?.enabled?'本机绘图已启用；一次绘制一张。':'绘图未启用，请在扩展服务配置本机工作流。';
  for(const job of jobs.slice(0,20)){const card=document.createElement('article');card.className='art-card';
    const title=document.createElement('h3');title.textContent=`${job.kind==='sticker'?'表情包':'插画'} · ${artStatuses[job.status]||job.status}`;
    const scene=document.createElement('p');scene.textContent=job.scene;card.append(title,scene);
    if(job.status==='completed'){const canvas=document.createElement('canvas');canvas.setAttribute('aria-label',job.caption||job.scene);card.append(canvas);
      const save=document.createElement('button');save.disabled=true;save.textContent=job.kind==='sticker'?'保存带字表情包':'保存图片';
      loadArtImage(job,canvas).then(()=>{save.disabled=false;}).catch(e=>notice(e.message));
      save.onclick=()=>canvas.toBlob(blob=>{if(!blob)return;
        const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`lilith-${job.kind}-${job.id}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');card.append(save);
    }else{const status=document.createElement('p');status.textContent=job.error||'生成进度会自动更新，完成后也会出现在游戏内。';card.append(status);}
    const details=document.createElement('details'),summary=document.createElement('summary'),prompt=document.createElement('pre');summary.textContent='查看绘图依据与提示词';
    prompt.textContent=`${job.source==='autonomous'?'莉莉丝自主选择':'手动绘制'} · ${job.profile_version}\n${job.reason||''}\n${job.final_prompt||''}`;details.append(summary,prompt);card.append(details);$('art-jobs').append(card);}
}catch(e){$('art-state').textContent=e.message;}}
$('art-form').onsubmit=async event=>{event.preventDefault();const scene=$('art-scene').value.trim();if(!scene)return;
  let kind=$('art-kind').value;if(kind==='auto')kind=/表情|贴纸|梗图|meme|sticker/i.test(scene)||$('art-caption').value.trim()?'sticker':'illustration';
  $('art-submit').disabled=true;try{await api('/v1/art/jobs',{method:'POST',body:JSON.stringify({kind,scene,caption:$('art-caption').value,
    mood:'gentle',request_id:crypto.randomUUID()})});await artLoad(true);}catch(e){notice(e.message);}finally{$('art-submit').disabled=false;}};
$('art-refresh').onclick=()=>artLoad(true);
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{if(button.dataset.tab==='art')artLoad(true);});
setInterval(()=>{if(!$('art').hidden)artLoad();},3000);
setInterval(()=>{if(!$('chat').hidden&&!$('send').disabled)historyLoad().catch(()=>{});},3000);
setInterval(()=>{if(!$('chat').hidden)taskLoad().catch(()=>{});},2000);
api('/v1/art/profile').then(profile=>{$('art-rules').textContent=[profile.identity_prompt,profile.personality_prompt,profile.style_prompt].join('\n\n');}).catch(()=>{});
if(location.pathname.endsWith('/art'))artLoad(true);

const qqFields=[['QQ 账号与连接',[
  ['enabled','启用 QQ 接入','checkbox'],['paused','暂停收发','checkbox'],
  ['owner_qq','主人的 QQ 号','text'],['bot_qq','莉莉丝的小号 QQ 号','text'],
  ['api_url','本机 OneBot HTTP API 地址','url'],['api_token','OneBot API Token','password'],
  ['event_secret','事件签名 Secret','password'],['mirror_desktop','同步绑定后的电脑端新对话','checkbox'],
  ['group_enabled','启用白名单群聊（@ 开始，10 条一轮）','checkbox'],['group_ids','允许的群号（JSON 字符串数组）','json'],
  ['min_interval_ms','发送最小间隔（毫秒）','number'],['max_per_minute','每分钟发送上限','number']]]];
async function qqLoad(render=true){
  const value=await api('/v1/qq');
  if(render){const previous=config;config=value;renderFields('qq-fields',qqFields);config=previous;}
  $('qq-state').textContent=!value.enabled?'QQ 接入未启用':value.paused?'已暂停'+(value.last_error?'：'+value.last_error:''):'接入已启用，待处理 '+value.pending+' 条；请检查连接并完成实际收发测试。';
  $('qq-state').textContent+=' 群聊今日发送 '+value.group_daily_used+'/50 条（北京时间），每轮最多 10 条。';
  $('qq-groups').textContent=JSON.stringify({date:value.group_day,timezone:value.group_timezone,used:value.group_daily_used,limit:value.group_daily_limit,round_limit:value.group_round_limit,rounds:value.group_rounds},null,2);
  $('qq-deliveries').textContent=JSON.stringify(value.outbox,null,2);
  $('qq-memory').textContent=JSON.stringify(await api('/v1/memory/archive'),null,2);
}
$('qq-form').onsubmit=async event=>{event.preventDefault();try{await api('/v1/qq',{method:'PATCH',body:JSON.stringify(collect(event.target))});await qqLoad();notice('QQ 配置已保存。');}catch(e){notice(e.message);}};
$('qq-probe').onclick=async()=>{try{const result=await api('/v1/qq/probe',{method:'POST',body:'{}'});notice('协议端已连接小号 '+result.bot_qq+'；还需实际私聊验证。');}catch(e){notice(e.message);}};
$('qq-pause').onclick=async()=>{try{await api('/v1/qq',{method:'PATCH',body:JSON.stringify({paused:true})});await qqLoad();notice('QQ 已暂停。');}catch(e){notice(e.message);}};
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>{if(button.dataset.tab==='qq')qqLoad().catch(e=>notice(e.message));});
setInterval(()=>{if(!$('qq').hidden)qqLoad(false).catch(()=>{});},3000);
if(location.pathname.endsWith('/qq'))qqLoad().catch(e=>notice(e.message));
