'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
function audioSignature(b){return b.subarray(0,3).toString()==='ID3'||b.subarray(0,4).toString()==='fLaC'||b.subarray(0,4).toString()==='RIFF'||b.subarray(4,8).toString()==='ftyp'||b[0]===255&&(b[1]&224)===224;}
function spectrum(pcm,rate){
 const n=1024,total=pcm.length/4,bands=[0,0,0,0],limits=[250,1000,2000,4000];let mass=0,weighted=0,frames=0;
 for(let start=0;start+n<=total;start+=rate/2){
  const re=new Float64Array(n),im=new Float64Array(n);for(let i=0;i<n;i++)re[i]=pcm.readFloatLE((start+i)*4)*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
  for(let size=2;size<=n;size*=2){const angle=-2*Math.PI/size;for(let base=0;base<n;base+=size)for(let j=0;j<size/2;j++){const a=base+j,b=a+size/2,c=Math.cos(angle*j),s=Math.sin(angle*j),r=re[b]*c-im[b]*s,q=re[b]*s+im[b]*c;re[b]=re[a]-r;im[b]=im[a]-q;re[a]+=r;im[a]+=q;}}
  for(let k=1;k<n/2;k++){const energy=re[k]**2+im[k]**2,hz=k*rate/n;bands[limits.findIndex(limit=>hz<=limit)]+=energy;mass+=energy;weighted+=energy*hz;}frames++;
 }
 return {maximum_frequency_hz:rate/2,frames,centroid_hz:mass?Math.round(weighted/mass):null,bands:bands.map((energy,i)=>({range_hz:[i?limits[i-1]:0,limits[i]],fraction:mass?Math.round(energy/mass*1000)/1000:0})),limitation:'仅统计0—4000Hz频率分布，不能据此识别具体乐器。'};
}
function features(pcm){
 const length=Math.floor(pcm.length/4),rate=8000,step=400,energies=[];
 if(length<rate*3)throw Error('music_audio_too_short');
 for(let offset=0;offset+step<=length;offset+=step){let square=0;for(let j=0;j<step;j++){const x=pcm.readFloatLE((offset+j)*4);if(!Number.isFinite(x))throw Error('music_invalid_audio');square+=x*x;}energies.push(Math.sqrt(square/step));}
 const onset=energies.map((x,i)=>Math.max(0,x-(energies[i-1]||x))),scores=[];
 for(let lag=6;lag<=30;lag++){let s=0,a=0,b=0;for(let i=lag;i<onset.length;i++){s+=onset[i]*onset[i-lag];a+=onset[i]**2;b+=onset[i-lag]**2;}scores.push({bpm:Math.round(1200/lag),score:a&&b?s/Math.sqrt(a*b):0});}
 scores.sort((a,b)=>b.score-a.score);const peaks=[];for(let i=0;i<energies.length;i+=20){const xs=energies.slice(i,i+20);peaks.push({second:Math.round(i/20),rms:xs.reduce((a,b)=>a+b,0)/xs.length});}
 const sorted=energies.toSorted((a,b)=>a-b),low=sorted[Math.floor(sorted.length*.1)],high=sorted[Math.floor(sorted.length*.95)];
 return {analyzed_seconds:length/rate,channels:1,sample_rate:rate,spectrum:spectrum(pcm,rate),tempo_candidates:scores.filter(x=>x.score>.1).slice(0,3),tempo_reliable:false,tempo_note:'RMS起伏的自相关候选；不等于已确认拍速，存在半速/倍速和无鼓误差。',dynamic_range_db:low>1e-6?Math.round(20*Math.log10(high/low)*10)/10:null,loudest:peaks.toSorted((a,b)=>b.rms-a.rms).slice(0,3),quietest:peaks.toSorted((a,b)=>a.rms-b.rms).slice(0,3),key:null,instruments:null};
}
async function analyzeAudio(source,{ffmpeg='/opt/homebrew/bin/ffmpeg',execute=run}={}){
 if(!source||!fs.existsSync(ffmpeg))return {state:'unavailable',reason:!source?'not_cached':'ffmpeg_unavailable'};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-music-audio-'));fs.chmodSync(dir,0o700);
 try{let bytes=fs.readFileSync(source.file);if(bytes.length>100*1024*1024)throw Error('music_audio_too_large');
  if(source.encoding==='netease_uc_xor_a3')for(let i=0;i<bytes.length;i++)bytes[i]^=0xa3;
  if(!audioSignature(bytes))return {state:'unavailable',reason:'cache_format_unrecognized'};
  const input=path.join(dir,'input.media');fs.writeFileSync(input,bytes,{mode:0o600});bytes=null;
  const {stdout}=await execute(ffmpeg,['-v','error','-nostdin','-i',input,'-t','300','-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],{timeout:45000,maxBuffer:12*1024*1024,encoding:'buffer'});
  return {state:'analyzed',scope:'up_to_first_300_seconds_of_available_cache',cache_complete:false,...features(stdout),limitations:['不是直接音频语义模型；不支持确认乐器、演唱技巧、和弦或曲风。','缓存可能不完整；只描述实际解码范围，不能声称听完整首。']};
 }catch{return {state:'unavailable',reason:'cache_decode_failed'};}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={analyzeAudio,features,audioSignature};
