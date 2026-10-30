'use strict';
const {randomUUID}=require('node:crypto');
function partDelay(part){return Math.max(1800,Math.min(8000,1100+Array.from(part.text).length*90));}
function beginParts(result,mirror,now=Date.now()){
 if(!Array.isArray(result.messages)||result.messages.length<2)return null;
 const parts=result.messages,id=randomUUID();
 result.text=parts[0].text;result.ui={...result.ui,...parts[0]};delete result.ui.text;
 result.reply_batch={id,total:parts.length,source:result.parts_source||'model'};
 // The API returns the first visible message. The remainder stays in the local
 // queue and is never mistaken for already-spoken conversation history.
 delete result.messages;
 return {id,parts,mirror,next_at:now+partDelay(parts[0]),created_ms:now};
}
module.exports={partDelay,beginParts};
