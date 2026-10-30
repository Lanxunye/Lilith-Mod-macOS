'use strict';
// Read-only projection: numeric state can tint the next turn without inventing
// an event, spending its detail quota, or changing the mood engine.
const labels={happy:'开心',calm:'踏实平静',sweet:'亲密甜意',heartache:'心疼',worry:'担心',sad:'难过',jealous:'吃醋'};
function moodBackground(state={}){
 const value=Math.max(0,Math.min(100,Number(state.mood)||0));
 const base=value>=80?'心情轻快，容易流露亲近和好奇':value>=55?'心情平稳，可以自在交流':value>=30?'心情有些低落，可以表达自己的感受':'心情低沉，允许沉默、不满和寻求陪伴';
 const dims=Object.entries(labels).map(([key,label])=>({label,value:Math.max(0,Math.min(100,Number(state.dims?.[key])||0))})).filter(x=>x.value>=5).sort((a,b)=>b.value-a.value).slice(0,2);
 return '本轮情绪底色（覆盖历史旧快照）：'+base+(dims.length?'；仍在延续的感受有'+dims.map(x=>x.label).join('、'):'')+'。这是上一轮状态衰减后的背景，不是主人本轮的新行为；当前话题和主人此刻的感受优先，可以自然变化。愿意亲近、嘴硬、在意或吃醋时可以具体说出来，也可以认真平静地接话；高心情不要求一直开心或讨好，不强行解释旧原因，不照念状态。';
}
module.exports={moodBackground};
