'use strict';
// Recovery for legacy/plain text, never a second model call. Only complete
// sentences and explicit line boundaries are used; quoted/code/link content
// remains intact. Model-authored message boundaries take precedence.
function fallbackParts(value){
 const text=String(value||'').trim(),parts=[];let start=0,quote=[],fence='',inline=0,protectedLine=false;
 const pairs={'“':'”','‘':'’','「':'」','『':'』','《':'》','（':'）','(':')','[':']','【':'】','{':'}'};
 const urls=[...text.matchAll(/https?:\/\/[^\s<>"“”「」。！？；，)\]}]+/giu)].map(m=>[m.index,m.index+m[0].length]);let url=0;
 const emit=end=>{const part=text.slice(start,end).trim();if(part)parts.push(part);start=end;};
 for(let i=0;i<text.length;i++){
  while(url<urls.length&&i>=urls[url][1])url++;
  if(url<urls.length&&i>=urls[url][0]&&i<urls[url][1])continue;
  const c=text[i],escaped=i>0&&text[i-1]==='\\';
  if(i===0||text[i-1]==='\n')protectedLine=!fence&&!inline&&!quote.length&&/^\s*[|>]/.test(text.slice(i).split('\n')[0]);
  if(protectedLine&&c!=='\n')continue;
  if((text.startsWith('```',i)||text.startsWith('~~~',i))&&/^[ \t]*$/.test(text.slice(text.lastIndexOf('\n',i-1)+1,i))){const token=text.slice(i,i+3);if(!fence)fence=token;else if(fence===token)fence='';i+=2;continue;}
  if(fence)continue;
  if(c==='`'&&!escaped){let count=1;while(text[i+count]==='`')count++;if(!inline)inline=count;else if(inline===count)inline=0;i+=count-1;continue;}if(inline)continue;
  if(!escaped){
   if(quote.length&&c===quote.at(-1)){quote.pop();continue;}
   if(pairs[c]){quote.push(pairs[c]);continue;}
   if(c==='"'||c==="'"&&(i===0||/[\s:：([{]/.test(text[i-1]))){quote.push(c);continue;}
  }
  if(quote.length)continue;
  if(c==='\n'){
   const line=text.slice(text.lastIndexOf('\n',i-1)+1,i).trim(),next=text.slice(i+1).split('\n')[0].trim();
   if(line.startsWith('|')&&next.startsWith('|')||line.startsWith('>')&&next.startsWith('>'))continue;
   emit(i+1);continue;
  }
  let stop=/[。！？!?]/.test(c);
  if(c==='.'&&(i===text.length-1||/\s/.test(text[i+1]))&&text[i-1]!=='.'){
   const current=text.slice(start,i+1);
   stop=!/^\s*(?:[-*•]\s*)?\d+\.$/.test(current)&&!/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(current);
  }
  if(/[；;]/.test(c))stop=text.slice(start,i).trim().length>=6&&text.slice(i+1).trim().length>=6;
  if(stop){while(i+1<text.length&&/[。！？!?]/.test(text[i+1]))i++;while(i+1<text.length&&/[”’」』）》】]/.test(text[i+1]))i++;emit(i+1);}
 }
 emit(text.length);return parts;
}
module.exports={fallbackParts};
