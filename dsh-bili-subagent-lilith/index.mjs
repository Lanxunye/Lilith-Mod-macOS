import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual,createHash,randomUUID} from 'node:crypto';
export const name='lilith-bili-readonly';
export const inject=[];
const VERSION='0.8.7-lilith.1',bvid=/^BV[0-9A-Za-z]{10}$/;
const fail=code=>Object.assign(Error(code),{code});
const privateQuery=/(?:sk-[\w-]+|api[_ -]?key|密码|密钥|验证码|Bearer\s|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\/Users\/|\b\d{7,20}\b)/i;
export function validate(operation,payload={}){
 if(!['status','check','search','video','subtitle','comments','login_start','login_poll'].includes(operation))throw fail('bili_operation_denied');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('bili_invalid_payload');
 if(['video','subtitle','comments'].includes(operation)&&!bvid.test(payload.bvid||''))throw fail('bili_invalid_bvid');
 if(operation==='search'&&(typeof payload.query!=='string'||!payload.query.trim()||[...payload.query].length>80||privateQuery.test(payload.query.normalize('NFKC'))))throw fail('bili_private_query_denied');
 if(operation==='login_poll'&&!/^[a-f0-9-]{36}$/.test(payload.id||''))throw fail('bili_invalid_login');
}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);fs.chmodSync(file,0o600);}
export function createReader({directory,python=path.join(directory,'.venv/bin/python'),request=fetch,execute}={}){
 const credentials=path.join(directory,'bili_credential.json'),sessions=new Map();let checked=false,logged=false,lastError='',busy=false;
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const pythonCall=execute||((operation,payload)=>new Promise((resolve,reject)=>{
  if(!fs.existsSync(python))return reject(fail('bili_dependencies_required'));
  const child=execFile(python,['-u',fileURLToPath(new URL('./read_worker.py',import.meta.url))],{cwd:directory,timeout:28000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR||'/tmp',LANG:'en_US.UTF-8',LILITH_BILI_CREDENTIAL:credentials}},(e,stdout)=>{
   if(e)return reject(fail('bili_reader_failed'));try{resolve(JSON.parse(stdout.trim()));}catch{reject(fail('bili_reader_invalid'));}
  });child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({operation,payload}));
 }));
 async function get(url){let res;try{res=await request(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'},signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error();return {data:await res.json(),cookies:res.headers.getSetCookie?.()||[]};}catch{throw fail('bili_login_network_failed');}}
 function status(){return {installed:true,version:VERSION,read_only:true,dependencies_ready:fs.existsSync(python),credential_present:fs.existsSync(credentials),login_state:checked?(logged?'verified':'expired'):'unverified',busy,last_error:lastError,video_pixels:false,audio_understanding:false};}
 async function call(operation,payload={}){
  validate(operation,payload);if(operation==='status')return status();
  if(busy)throw fail('bili_busy');busy=true;
  try{
   let value;
   if(operation==='login_start'){
    const {data}=await get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header');
    if(!data?.data?.qrcode_key||!data?.data?.url)throw fail('bili_login_failed');
    const id=randomUUID(),qr=await pythonCall('qr',{url:data.data.url});if(!qr.image)throw fail('bili_qr_failed');
    sessions.clear();sessions.set(id,{key:data.data.qrcode_key,expires:Date.now()+180000});return {id,image:qr.image,expires_in:180};
   }
   if(operation==='login_poll'){
    const s=sessions.get(payload.id);if(!s||s.expires<Date.now()){sessions.delete(payload.id);return {state:'expired'};}
    const {data,cookies}=await get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key='+encodeURIComponent(s.key));
    const code=data?.data?.code;
    if(code!==0){if(code===86038)sessions.delete(payload.id);return {state:({86101:'waiting',86090:'scanned',86038:'expired'})[code]||'unknown'};}
    const jar={},want={SESSDATA:'sessdata',bili_jct:'bili_jct',DedeUserID:'dedeuserid',buvid3:'buvid3'};
    for(const c of cookies){const first=c.split(';')[0],i=first.indexOf('='),key=want[first.slice(0,i)];if(key)jar[key]=first.slice(i+1);}
    if(!jar.sessdata||!jar.dedeuserid)throw fail('bili_login_cookie_missing');
    try{const {data:spi}=await get('https://api.bilibili.com/x/frontend/finger/spi');jar.buvid3||=spi?.data?.b_3||'';}catch{}
    write(credentials,jar);sessions.delete(payload.id);checked=false;logged=false;return {state:'ok'};
   }
   value=await pythonCall(operation,payload);
   if(value?.error)throw fail(/^bili_[a-z_]+$/.test(value.error)?value.error:'bili_read_failed');
   if(operation==='check'){checked=true;logged=value.logged_in===true;}
   lastError='';return value;
  }catch(e){if(operation==='check')checked=false;lastError=/^bili_[a-z_]+$/.test(e.code||'')?e.code:'bili_read_failed';throw fail(lastError);}finally{busy=false;}
 }
 return {call,status};
}
export async function install(ctx,{home=process.env.DSH_HOME,file=process.env.LILITH_DSH_BILI_FILE,token=process.env.LILITH_DSH_BILI_TOKEN,reader}={}){
 if(!home||!file||!token||token.length<32)throw fail('bili_bridge_invalid');
 reader||=createReader({directory:path.join(home,'bili-duty')});const fingerprint=createHash('sha256').update(token).digest('hex');
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
  if(req.method!=='POST'||req.url!=='/read'||actual.length!==expected.length||!timingSafeEqual(actual,expected)){req.resume();send(403,{error:'bili_bridge_denied'});return;}
  let size=0;const chunks=[];try{for await(const c of req){size+=c.length;if(size>16384)throw fail('bili_request_too_large');chunks.push(c);}
   const {operation,payload}=JSON.parse(Buffer.concat(chunks).toString());send(200,{value:await reader.call(operation,payload)});
  }catch(e){send(400,{error:/^bili_[a-z_]+$/.test(e.code||'')?e.code:'bili_bridge_failed'});}
 });server.requestTimeout=30000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});write(file,{port:server.address().port,fingerprint});
 ctx.provide('lilithBiliReady',{ready:true,version:VERSION,readOnly:true});
 const dispose=()=>{server.closeAllConnections();server.close();try{if(JSON.parse(fs.readFileSync(file)).fingerprint===fingerprint)fs.unlinkSync(file);}catch{}};ctx.effect(()=>dispose);return {dispose};
}
export async function apply(ctx){await install(ctx);}
