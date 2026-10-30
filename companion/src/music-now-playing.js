'use strict';
// Read-only MediaRemote query. No player launch, control, credentials or UI access.
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const SCRIPT=`ObjC.import('AppKit');
$.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework').load;
function run(){
 const apps=$.NSWorkspace.sharedWorkspace.runningApplications;let running=false;
 for(let i=0;i<apps.count;i++)if(ObjC.unwrap(apps.objectAtIndex(i).bundleIdentifier)==='com.netease.163music')running=true;
 const out={running:running,available:false,playing:false,source:'netease',observed_at:Date.now()};
 if(!running)return JSON.stringify(out);
 try{const r=$.NSClassFromString('MRNowPlayingRequest'),item=r.localNowPlayingItem;
  if(!item||item.isNil())return JSON.stringify(Object.assign(out,{error:'no_system_media'}));
  const bundle=ObjC.unwrap(r.localNowPlayingPlayerPath.client.bundleIdentifier);
  if(bundle!=='com.netease.163music')return JSON.stringify(Object.assign(out,{error:'other_media_source'}));
  const info=item.nowPlayingInfo;function value(k){const x=info.objectForKey(k);return x&&!x.isNil()?ObjC.unwrap(x):null;}
  return JSON.stringify(Object.assign(out,{available:true,playing:!!r.localIsPlaying,title:value('kMRMediaRemoteNowPlayingInfoTitle'),artist:value('kMRMediaRemoteNowPlayingInfoArtist'),album:value('kMRMediaRemoteNowPlayingInfoAlbum'),duration:value('kMRMediaRemoteNowPlayingInfoDuration')}));
 }catch(e){return JSON.stringify(Object.assign(out,{error:'now_playing_unavailable'}));}
}`;
async function nowPlaying(execute=promisify(execFile)){
 if(process.platform!=='darwin')return {available:false,running:false,error:'mac_only'};
 try{const r=await execute('/usr/bin/osascript',['-l','JavaScript','-e',SCRIPT],{timeout:8000,maxBuffer:8192});return JSON.parse(r.stdout);}
 catch{return {available:false,running:false,error:'now_playing_unavailable'};}
}
module.exports={nowPlaying,SCRIPT};
