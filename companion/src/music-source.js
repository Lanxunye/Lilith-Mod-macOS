'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{nowPlaying}=require('./music-now-playing');
const ID=/^[1-9]\d{0,17}$/;
const clip=(x,n=160)=>String(x??'').replace(/[\x00-\x1f]/g,' ').slice(0,n);
function track(v){if(!v||!ID.test(String(v.id)))return null;return {id:String(v.id),title:clip(v.name||v.title),artists:(v.artists||v.ar||[]).map(x=>clip(x.name,80)).slice(0,12),album:clip(v.album?.name||v.al?.name),duration:Number(v.duration||v.dt||0)/1000,genre:typeof v.genre==='string'?clip(v.genre,60):'',url:'https://music.163.com/#/song?id='+v.id};}
function matchTrack(media,rows){
 const norm=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[\s·・]/g,'');
 const pool=rows.filter(t=>norm(t.title)===norm(media.title));
 const names=norm(media.artist).split(/[/、,，&]/).filter(Boolean);
 const exact=pool.filter(t=>names.length&&names.every(a=>t.artists.some(b=>norm(b)===a)));
 if(exact.length===1)return exact[0];
 return !names.length&&pool.length===1?pool[0]:null;
}
class MusicSource{
 constructor({root=path.join(os.homedir(),'Library/Containers/com.netease.163music/Data'),readNow=nowPlaying,request=fetch}={}){this.root=root;this.readNow=readNow;this.request=request;}
 database(fn){const p=path.join(this.root,'Documents/storage/sqlite_storage.sqlite3');const db=new DatabaseSync(p,{readOnly:true});try{return fn(db);}finally{db.close();}}
 queue(){try{const f=path.join(this.root,'Documents/storage/file_storage/webdata/file/playingList');if(fs.statSync(f).size>12e6)throw Error();const v=JSON.parse(fs.readFileSync(f));return (v.list||[]).map(x=>track(x.track)).filter(Boolean);}catch{return [];}}
 async snapshot(){const media=await this.readNow();if(!media.running||!media.available||!media.title)return {...media,available:false,playing:false,playback_status:'unavailable'};
  const t=matchTrack(media,this.queue());return {...media,title:clip(media.title),artist:clip(media.artist),album:clip(media.album),track:t,id:t?.id||null,source:'netease',playing:media.playing===true,playback_status:media.playing===true?'playing':'paused',observed_at:Date.now()};}
 song(id){if(!ID.test(String(id)))throw Error('music_invalid_id');return this.database(db=>{const row=db.prepare('SELECT jsonStr FROM dbTrack WHERE id=?').get(String(id));return row?track(JSON.parse(row.jsonStr)):null;});}
 playlist({id,name}){if(id&&!ID.test(String(id)))throw Error('music_invalid_playlist');return this.database(db=>{
  const rows=db.prepare('SELECT jsonStr FROM persistentModel WHERE uniKey=?').all('page:playlist');let selected=null,entities={};
  for(const r of rows){const data=JSON.parse(r.jsonStr).data||{};for(const p of Object.values(data.entities||{}))if(id?String(p.id)===String(id):p.name===name){selected=p;entities=data.trackEntities||{};}}
  if(!selected)throw Error('music_playlist_not_cached');
  const ids=[...new Set((selected.trackIds||[]).map(x=>String(x.id)).filter(x=>ID.test(x)))];const get=db.prepare('SELECT jsonStr FROM dbTrack WHERE id=?');
  const songs=ids.map(id=>{const r=get.get(id);return track(entities[id]||(r?JSON.parse(r.jsonStr):null));}).filter(Boolean);
  const counts={};for(const s of songs)for(const a of s.artists)counts[a]=(counts[a]||0)+1;
  return {id:String(selected.id),name:clip(selected.name),tags:(selected.tags||[]).map(x=>clip(x,40)).slice(0,20),total:Number(selected.trackCount)||ids.length,ids,tracks:songs,metadata_count:songs.length,complete:ids.length===(Number(selected.trackCount)||ids.length)&&songs.length===ids.length,source:'local_client_cache',remote_updated_at:Number(selected.updateTime)||null,synced_at:Date.now(),artists:Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([name,count])=>({name,count}))};
 });}
 async publicRead(op,payload){let url;
  if(op==='lyrics'&&ID.test(String(payload.id)))url='https://music.163.com/api/song/lyric?'+new URLSearchParams({id:payload.id,lv:'-1',kv:'-1',tv:'-1'});
  else if(op==='search'&&typeof payload.query==='string'&&payload.query.length<=80&&!/[\x00-\x1f]|\/Users\/|sk-|Bearer|密码|密钥|验证码/i.test(payload.query))url='https://music.163.com/api/search/get?'+new URLSearchParams({s:payload.query,type:'1',limit:'8'});
  else throw Error('music_operation_denied');
  const r=await this.request(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Referer:'https://music.163.com/'}});
  if(!r.ok)throw Error('music_public_read_failed');const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>1024*1024)throw Error('music_response_too_large');chunks.push(chunk);}
  const v=JSON.parse(Buffer.concat(chunks));if(v.code!==200)throw Error('music_public_read_failed');
  return op==='search'?{songs:(v.result?.songs||[]).map(track).filter(Boolean)}:{state:v.nolyric?'instrumental':v.lrc?.lyric?'read':'unavailable',text:String(v.lrc?.lyric||'').slice(0,16000),translation:String(v.tlyric?.lyric||'').slice(0,8000)};
 }
 audio(id){if(!ID.test(String(id)))return null;const dir=path.join(this.root,'Library/Caches/online_play_cache');try{
  const files=fs.readdirSync(dir).filter(n=>n.startsWith(id+'-_-_')&&n.endsWith('.uc!'));
  for(const name of files){const f=path.join(dir,name),s=fs.statSync(f);if(s.size>0&&s.size<=100*1024*1024&&!fs.lstatSync(f).isSymbolicLink())return {file:f,encoding:'netease_uc_xor_a3',cache_complete:false};}
 }catch{}return null;}
}
module.exports={MusicSource,track,matchTrack,ID};
