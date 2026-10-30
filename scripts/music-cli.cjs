#!/usr/bin/env node
'use strict';
// Fixed read-only commands; deliberately no playback, account or shell forwarding.
const {MusicSource,ID}=require('../companion/src/music-source'),{analyzeAudio}=require('../companion/src/music-audio');
(async()=>{const source=new MusicSource(),[op,arg]=process.argv.slice(2);let result;
 if(op==='now')result=await source.snapshot();
 else if(op==='playlist')result=source.playlist({id:arg||'8781548197'});
 else if(op==='lyrics'&&ID.test(arg||''))result=await source.publicRead('lyrics',{id:arg});
 else if(op==='search')result=await source.publicRead('search',{query:arg||''});
 else if(op==='analyze'&&ID.test(arg||''))result=await analyzeAudio(source.audio(arg));
 else throw Error('music_operation_denied');console.log(JSON.stringify(result));
})().catch(e=>{console.error(JSON.stringify({error:/^music_/.test(e.message)?e.message:'music_read_failed'}));process.exitCode=1;});
