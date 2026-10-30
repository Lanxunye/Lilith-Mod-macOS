'use strict';
const VIDEO_LINK_RULE='B站视频链接采用按需提供：日常分析、感想、推荐和主动分享都不主动附原视频链接或来源清单。仅当前主人明确索要（如“让我看看原视频”“把链接发我”）时提供对应原视频地址；历史中索要过不代表本轮仍要。已有记录可直接给地址，不重新阅读或联网查找，不消耗阅读轮数。链接只作为文字发送，不调用工具打开或播放；没有可靠对应记录时先确认是哪条，不编造地址。';
function wantsVideoLink(message){
 const text=String(message||'').normalize('NFKC').replace(/```[\s\S]*?```/g,'').replace(/^>.*$/gm,'').replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"/g,'');
 if(/(?:不要|不用|不必|无需|别|不需要|先不|暂时不)[^，。；,;\n]{0,8}(?:链接|地址|网址|原视频|原片|BV号)/i.test(text))return false;
 if(/(?:为什么|怎么).{0,8}(?:总|每次|老是|又).{0,8}(?:链接|原视频)/.test(text))return false;
 return /(?:让我|给我|我想|想要|能否|能不能|可以)[^，。；,;\n]{0,5}(?:看看|看一下|看下|看|打开|播放)[^，。；,;\n]{0,4}(?:原视频|那条视频|这个视频|原片)/.test(text)||
 /(?:给我|发我|发给我|发来|贴出|贴下|提供|分享|给个|来个|求)[^，。；,;\n]{0,6}(?:链接|网址|地址|BV号|BVID|原视频|原片)/i.test(text)||
 /(?:原视频|那条视频|视频)[^，。；,;\n]{0,6}(?:链接|地址|网址)[^，。；,;\n]{0,5}(?:给我|发来|在哪|哪里|呢|是什么|发一下|发下|贴一下)/.test(text)||
 /把[^，。；,;\n]{0,8}(?:原视频|视频链接|链接|BV号)[^，。；,;\n]{0,5}(?:发|给|贴)/i.test(text)||
 /^(?:链接|原视频|地址|BV号)(?:呢|在哪|在哪里|发一下)?[？！?!。~\s]*$/i.test(text.trim());
}
function isVideoUrl(value){
 try{const u=new URL(/^https?:\/\//i.test(value)?value:'https://'+value),host=u.hostname.toLowerCase();
  return !u.username&&!u.password&&(host==='b23.tv'||host.endsWith('.b23.tv')||(host==='bilibili.com'||host.endsWith('.bilibili.com'))&&/^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)(?:[/?#]|$)/i.test(u.pathname));
 }catch{return false;}
}
function stripVideoLinks(value){
 const original=String(value||'');let text=original.replace(/\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g,(all,label,url)=>isVideoUrl(url)?/^(?:原视频|视频链接|链接|点此观看|点击观看|查看原视频|来源|参考)$/.test(label.trim())?'':label:all);
 text=text.replace(/<((?:https?:\/\/|www\.)[^\s<>]+)>/gi,(all,url)=>isVideoUrl(url)?'':all);
 text=text.replace(/(?:https?:\/\/|(?:www\.)?bilibili\.com\/|b23\.tv\/)[^\s<>"“”「」，。；！？、）)\]]*/gi,all=>{
  const clean=all.replace(/[.,;:!?]+$/,'');return isVideoUrl(clean)?all.slice(clean.length):all;
 });
 if(text===original)return original;
 return text.split('\n').map(line=>line.replace(/(?:[，,；;]\s*)?(?:原视频|原片|视频链接|链接|来源|参考)[：:]\s*$/,'').replace(/[ \t]+/g,' ').trim()).filter(line=>line&&!/^[👉🔗\s]*(?:原视频|原片|视频链接|链接|来源|参考)?[：:\s]*$/.test(line)).join('\n').trim();
}
function applyVideoLinkPolicy(value,{requested=false,links=[],maxChars=400,fitText=(s,n)=>[...s].slice(0,n).join(''),allowEmpty=false}={}){
 const urls=[...new Set(links.map(l=>typeof l==='string'?l:l.url).filter(isVideoUrl))].slice(0,2);
 if(requested&&!urls.length)return value;
 const supplied=Array.isArray(value.messages)?value.messages.map(p=>typeof p==='string'?{text:p}:p).filter(p=>p&&typeof p.text==='string'&&p.text.trim()):[];
 const raw=supplied.length?supplied:[{text:String(value.text||'')}];
 const clean=raw.map(p=>({...p,text:stripVideoLinks(p.text)})).filter(p=>p.text.trim());
 const suffix=requested?urls.join('\n'):'',reserve=suffix?[...suffix].length+1:0;
 const sourceCitations=Array.isArray(value.citations)?value.citations:[],citations=sourceCitations.filter(c=>!isVideoUrl(c?.url||''));
 if(!suffix&&raw.every(p=>stripVideoLinks(p.text)===p.text)&&citations.length===sourceCitations.length)return value;
 let remaining=Math.max(0,maxChars-reserve);const parts=[];
 for(const p of clean){if(remaining<=0)break;const text=fitText(p.text,remaining).trim();if(!text)continue;parts.push({...p,text});remaining-=[...text].length+1;}
 if(suffix)parts.push({text:suffix});
 if(!parts.length&&!allowEmpty)parts.push({text:'刚才聊的内容，还可以接着说。'});
 const result={...value,text:parts.map(p=>p.text).join('\n'),citations};
 if(supplied.length||suffix)result.messages=parts;
 return result;
}
module.exports={VIDEO_LINK_RULE,wantsVideoLink,isVideoUrl,stripVideoLinks,applyVideoLinkPolicy};
