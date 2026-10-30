// Host-only bridge. No model tool is registered and no credential leaves DSH.
import http from 'node:http';
import fs from 'node:fs';
import {timingSafeEqual,createHash} from 'node:crypto';
export const name='lilith-native-search';
export const inject=['credentials'];
const failure=code=>Object.assign(Error(code),{code});
export async function officialRequest(credentials,ref,operation,payload,{request=fetch}={}){
 if(!['search','fetch'].includes(operation))throw failure('search_operation_denied');
 if(operation==='search'&&(typeof payload.query!=='string'||!payload.query.trim()||[...payload.query].length>128||!Number.isInteger(payload.count)||payload.count<1||payload.count>5))throw failure('search_invalid_query');
 if(operation==='fetch'){
  let u;try{u=new URL(payload.url);}catch{throw failure('search_invalid_url');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||payload.url.length>8192)throw failure('search_invalid_url');
 }
 const hit=await credentials.resolve(ref);
 // Account grants are not API keys. Only the configured official API-key ref is used.
 if(typeof hit?.value!=='string'||!/^sk-[A-Za-z0-9_-]+$/.test(hit.value))throw failure('search_native_api_key_required');
 const body=operation==='search'?{query:payload.query,count:payload.count,need_content:true}:{url:payload.url};
 let response;
 try{response=await request('https://api.deepseek.com/v1/tools/'+operation,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+hit.value,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw failure('search_transport_failed');}
 if(!response.ok){await response.body?.cancel();throw failure('search_http_'+response.status);}
 const parts=[];let size=0;
 try{for await(const part of response.body){size+=part.length;if(size>2*1024*1024){throw failure('search_response_too_large');}parts.push(part);}
  return JSON.parse(Buffer.concat(parts).toString());
 }catch(e){throw failure(e.code==='search_response_too_large'?e.code:'search_invalid_response');}
}
export async function installSearch(ctx,{file=process.env.LILITH_DSH_SEARCH_FILE,token=process.env.LILITH_DSH_SEARCH_TOKEN,ref=process.env.LILITH_DSH_SEARCH_REF||'DEEPSEEK_API_KEY',request=fetch}={}){
 if(!file||!token||token.length<32||!/^[A-Z][A-Z0-9_]{0,99}$/.test(ref))throw failure('search_bridge_config_invalid');
 const fingerprint=createHash('sha256').update(token).digest('hex');
 const server=http.createServer(async(req,res)=>{
  const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method!=='POST'||req.url!=='/search'||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){req.resume();send(403,{error:'search_bridge_denied'});return;}
  const chunks=[];let bytes=0;
  try{for await(const c of req){bytes+=c.length;if(bytes>16384)throw failure('search_bridge_request_too_large');chunks.push(c);}
   const {operation,payload}=JSON.parse(Buffer.concat(chunks).toString());
   send(200,{value:await officialRequest(ctx.credentials,ref,operation,payload,{request})});
  }catch(e){send(400,{error:/^search_[a-z0-9_]+$/.test(e.code||'')?e.code:'search_bridge_failed'});}
 });
 server.requestTimeout=25000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 fs.writeFileSync(file,JSON.stringify({port:server.address().port,fingerprint}),{mode:0o600});
 ctx.provide('lilithSearchReady',{ready:true,authentication:'native_official_api_key_reference'});
 const dispose=()=>{server.closeAllConnections();server.close();try{if(JSON.parse(fs.readFileSync(file)).fingerprint===fingerprint)fs.unlinkSync(file);}catch{}};
 ctx.effect(()=>dispose);return {dispose};
}
export async function apply(ctx){await installSearch(ctx);}
