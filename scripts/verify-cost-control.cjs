'use strict';
// Synthetic native SDK validation. Never writes production chat/memory or sends QQ.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {DshConversation}=require('../companion/src/dsh-conversation');
const {safeConfig}=require('../companion/src/dsh-profile');
const {buildSystemPrompt}=require('../companion/src/server');
const {conversationStyle}=require('../companion/src/lilith-style');
const {ConversationStore}=require('../companion/src/conversation-store');
const {createQQCapabilities,DEFAULTS}=require('../companion/src/qq-capabilities');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-cost-native-')),home=path.join(root,'dsh-lilith/home'),profile=path.join(home,'profiles/lilith');
const production=path.join(os.homedir(),'Library/Application Support/LilithAI/dsh-lilith/home/profiles/lilith');
const character=require('../character/lilith.json'),style=require('../character/lilith-style.json');
const proof={at:new Date().toISOString(),root,synthetic:true,qq_messages_sent:0,production_history_written:false};let dsh;
(async()=>{try{
 fs.mkdirSync(path.join(profile,'node_modules'),{recursive:true,mode:0o700});
 const manifest=JSON.parse(fs.readFileSync(path.join(production,'package.json')));fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify(manifest));
 const patch=fs.readFileSync(path.join(production,'cordis.patch.yml'),'utf8');assert.ok(safeConfig(patch.split('\n').filter(l=>!l.trimStart().startsWith('#'))));fs.writeFileSync(path.join(profile,'cordis.patch.yml'),patch);fs.writeFileSync(path.join(profile,'.lilith-native-seed.json'),'{}');
 for(const name of Object.keys(manifest.dependencies||{})){const from=path.join(production,'node_modules',name),to=path.join(profile,'node_modules',name);if(fs.existsSync(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.symlinkSync(fs.realpathSync(from),to,'dir');}}
 dsh=new DshConversation({root,workspace:path.join(root,'workspace'),getConfig:()=>({integrations:{dsh:{executable:'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'}}}),getPersona:()=>JSON.stringify(character)+'\n'+conversationStyle(style,{baselineOnly:true}),getEndpoint:()=> 'http://127.0.0.1:1'});
 const history=[];
 for(const turn of [{channel:'qq',message:'今天画稿保存好了，终于松了口气。'},{channel:'qq',message:'还记得刚才那件事吗？'},{channel:'desktop',message:'晚上好，聊聊你的心情吧。'},{channel:'qq_group',message:'给大家介绍一下你自己吧。'}]){
  const {channel,message}=turn;
  const system=buildSystemPrompt(character,channel==='qq_group'?'群友':'主人','in_character',[],[],400,null,false,'','zh-CN',{channel,message});
  const raw=await dsh.complete({key:channel+':synthetic',conversation:channel+':synthetic',channel,tools:true,system,prompt:JSON.stringify({recent_visible_conversation:channel==='qq'?history:[],current_user_message:message})});
  const value=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));assert.ok(value.text&&Array.isArray(value.messages));history.push({role:'user',content:message},{role:'assistant',content:value.text});
 }
 const store=new ConversationStore(root);
 try{
  const cap=createQQCapabilities({root,store,getConfig:()=>({...DEFAULTS,owner_qq:'111111',private_stickers_enabled:true,stickers_enabled:true}),getCanon:()=>({identity:character.canon.identity,traits:character.voice.traits}),conversation:(messages,limits)=>dsh.complete({key:'qq-decision',conversation:'synthetic-internal',channel:'aux',tools:false,ephemeral:true,maxTokens:limits.maxTokens,system:messages[0].content,prompt:messages[1].content})});
  const stickers=Array.from({length:20},(_,i)=>({id:(i+1).toString(16).padStart(64,'0'),description:'可爱角色微笑、开心地庆祝，表示认可与轻松。',usage:{sent:0,recently_sent:false}}));
  const choice=await cap.decidePrivate({current:{text:'画稿保存好了，好开心。'},reply:'幸好留住了。那就放心开心一会儿吧。',recent:[{role:'user',text:'刚才差点忘记保存。'}],stickers,media:{enabled:true,cadence:{eligible:true}}});
  assert.ok(choice===null||stickers.some(s=>s.id===choice));assert.equal(cap.status().capability_error,'');proof.selector_candidates=20;
 }finally{store.close();}
 proof.usage=dsh.status().cost_control;
 const script=`from compression import zstd
import pathlib,json,sys
root=pathlib.Path(sys.argv[1]);result=[]
for f in root.glob('**/sessions/*/*/session.v4.jsonl.zstd'):
 rows=[json.loads(l) for l in zstd.decompress(f.read_bytes()).decode().splitlines()]
 headers=[r['data']['header'] for r in rows if r['type']=='request/header']
 if not headers:continue
 h=headers[-1];tools=h.get('tools',[]);rea=sum('rea' in str(t.get('name','')).split('__') for t in tools)
 result.append({'auxiliary':'auxiliary-' in str(f),'tools':len(tools),'rea_tools':rea,'tool_definition_chars':len(json.dumps(tools,ensure_ascii=False)),'model_config':h.get('config'),'usage':[r['data'].get('usage') for r in rows if r['type']=='assistant/message']})
print(json.dumps(result))`;
 proof.requests=JSON.parse(execFileSync('python3',['-c',script,path.join(root,'dsh-lilith')],{encoding:'utf8'}));
 assert.equal(proof.requests.length,5);assert.ok(proof.requests.every(r=>r.rea_tools===0&&r.tools===0));assert.equal(proof.requests.find(r=>r.auxiliary).tools,0);
 assert.ok(proof.requests.every(r=>r.usage.every(u=>(u.inputTokens+u.cacheReadTokens)<50000)));
 proof.passed=true;console.log(JSON.stringify(proof));
}finally{await dsh?.close();fs.mkdirSync(path.resolve(__dirname,'../evidence'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../evidence/cost-control-native.json'),JSON.stringify(proof,null,2));}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
