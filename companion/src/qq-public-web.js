'use strict';
const https=require('node:https'),dns=require('node:dns').promises,net=require('node:net');
const {fault}=require('./conversation-store');
function publicAddress(ip){
 if(net.isIPv4(ip)){const a=ip.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&[0,168].includes(a[1])||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===198&&[18,19,51].includes(a[1])||a[0]===203&&a[1]===0&&a[2]===113);}
 if(net.isIPv6(ip))return /^2[0-9a-f]{3}:/i.test(ip)&&!/^2002:/i.test(ip)&&!/^2001:(?:db8|0:|2:|10:|20:)/i.test(ip);
 return false;
}
// Some local proxy DNS setups return benchmarking fake IPs. Resolve those names
// through authenticated HTTPS DNS, then apply the same public-address check.
async function publicLookup(host){
 const addresses=await dns.lookup(host,{all:true});
 if(!addresses.length||!addresses.every(a=>/^198\.(18|19)\./.test(a.address)))return addresses;
 const response=await publicGet('https://cloudflare-dns.com/dns-query?type=A&name='+encodeURIComponent(host),{
  limit:32768,timeout:5000,redirects:0,headers:{Accept:'application/dns-json'},
  resolve:async()=>[{address:'1.1.1.1',family:4}]
 });
 const data=JSON.parse(response.bytes.toString());
 if(data.Status!==0)throw fault('qq_dns_failed');
 return (data.Answer||[]).filter(a=>a.type===1&&net.isIPv4(a.data)).map(a=>({address:a.data,family:4}));
}
async function publicGet(target,{limit=512*1024,timeout=8000,allowHost,redirects=2,truncate=false,headers={},resolve:lookupHost=publicLookup,send=https.get}={}){
 const url=new URL(target);
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hash)throw fault('qq_public_https_required');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(allowHost&&!allowHost(host))throw fault('qq_media_host_denied');
 const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await Promise.race([lookupHost(host,{all:true}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(fault('qq_dns_timeout')),timeout);t.unref();})]);
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw fault('qq_private_network_denied');
 const address=addresses[0];
 return new Promise((resolve,reject)=>{
  const req=send(url,{headers:{'User-Agent':'Lilith-QQ-Bridge/0.4','Accept-Encoding':'identity',...headers},lookup:(_host,options,cb)=>options?.all?cb(null,[address]):cb(null,address.address,address.family)},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(!redirects||!res.headers.location){reject(fault('qq_redirect_limit'));return;}publicGet(new URL(res.headers.location,url).href,{limit,timeout,allowHost,redirects:redirects-1,truncate,resolve:lookupHost,send}).then(resolve,reject);return;}
   if(res.statusCode!==200){res.resume();reject(fault('qq_public_fetch_failed'));return;}
   if(Number(res.headers['content-length'])>limit&&!truncate||res.headers['content-encoding']&&!['identity'].includes(res.headers['content-encoding'])){res.destroy();reject(fault('qq_public_response_too_large'));return;}
   const chunks=[];let bytes=0;
   res.on('data',chunk=>{const previous=bytes;bytes+=chunk.length;if(bytes>limit){if(truncate){chunks.push(chunk.subarray(0,Math.max(0,limit-previous)));resolve({bytes:Buffer.concat(chunks),type:String(res.headers['content-type']||''),url:url.href,truncated:true});res.destroy();}else{res.destroy();reject(fault('qq_public_response_too_large'));}}else chunks.push(chunk);});
   res.on('end',()=>resolve({bytes:Buffer.concat(chunks),type:String(res.headers['content-type']||''),url:url.href}));res.on('error',()=>reject(fault('qq_public_fetch_failed')));
  });
  req.setTimeout(timeout,()=>req.destroy());const timer=setTimeout(()=>req.destroy(),timeout);timer.unref();
  req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(fault('qq_public_fetch_failed')));
 });
}
function plain(text){return String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();}
function rssItems(xml){return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,3).map(m=>({title:plain(m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]||''),url:plain(m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]||''),snippet:plain(m[1].match(/<description>([\s\S]*?)<\/description>/)?.[1]||'')})).filter(r=>r.title&&r.url.startsWith('https://'));}
module.exports={publicGet,publicAddress,publicLookup,plain,rssItems};
