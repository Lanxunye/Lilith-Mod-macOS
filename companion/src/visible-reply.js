'use strict';
// Only final speech belongs on a conversation surface. Never turn an invalid
// structured response or explicitly marked reasoning into a plain-text reply.
function stripReasoningText(value) {
 const text=String(value||'');
 const tags=/<\/?(?:think|thinking|analysis|reasoning)\b[^>]*>/gi;
 let out='',cursor=0,depth=0,match;
 while((match=tags.exec(text))){
  const closing=match[0][1]==='/';
  if(!depth)out+=text.slice(cursor,match.index);
  if(closing){if(depth)depth--;else out='';}else depth++;
  cursor=tags.lastIndex;
 }
 if(!depth)out+=text.slice(cursor);
 return out.trim();
}
function looksStructured(text){return /^(?:\{|\[|```(?:json)?\s*[\[{])/i.test(text.trim());}
function replyObject(value){return value&&typeof value==='object'&&!Array.isArray(value)&&(typeof value.text==='string'||Array.isArray(value.messages));}
function extractReplyEnvelope(text){
 let result=null,cursor=0;
 // Scan complete top-level objects, respecting nested braces and JSON strings.
 // Selecting the final reply supports accidental duplicate JSON emissions.
 while(cursor<text.length){
  const start=text.indexOf('{',cursor);if(start<0)break;
  let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=start;i<text.length;i++){
   const c=text[i];
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){end=i+1;break;}
  }
  if(end<0)break;
  try{const value=JSON.parse(text.slice(start,end));if(replyObject(value))result=value;}catch{}
  cursor=end;
 }
 return result;
}
function visibleReplyText(value,depth=0){
 const text=stripReasoningText(value);if(!text||depth>3)return '';
 if(!looksStructured(text))return text;
 const envelope=extractReplyEnvelope(text);if(!envelope)return '';
 const parts=Array.isArray(envelope.messages)?envelope.messages.map(p=>typeof p==='string'?p:p?.text).filter(p=>typeof p==='string'&&p.trim()):[];
 return (parts.length?parts:[envelope.text]).map(p=>visibleReplyText(p,depth+1)).filter(Boolean).join('\n');
}
module.exports={stripReasoningText,looksStructured,extractReplyEnvelope,visibleReplyText};
