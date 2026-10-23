'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const run = promisify(execFile);
// Opt-in metadata reader. macOS may ask for Automation permission; no player is launched.
const SCRIPT = `ObjC.import('AppKit');
function run() {
 const ids = [];
 const running = $.NSWorkspace.sharedWorkspace.runningApplications;
 for(let i=0;i<running.count;i++)ids.push(ObjC.unwrap(running.objectAtIndex(i).bundleIdentifier));
 let paused = null;
 for (const [id,source] of [['com.apple.Music','applemusic'],['com.spotify.client','spotify']]) {
  if (!ids.includes(id)) continue;
  const app = Application(id), status = String(app.playerState());
  if (status !== 'playing' && status !== 'paused') continue;
  const track = app.currentTrack();
  const result = {available:true,playing:status==='playing',source,title:String(track.name()),
   artist:String(track.artist()),playback_status:status,error:''};
  if(result.playing)return JSON.stringify(result);paused=result;
 }
 return JSON.stringify(paused||{available:false,playing:false,playback_status:'unavailable',error:'no_supported_player'});
}`;
async function readMedia(execute = run) {
  try {
    const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], { timeout: 8000 });
    return JSON.parse(stdout);
  } catch (error) {
    return { available: false, playing: false, playback_status: 'unavailable',
      error: /1743|not authorized|not permitted/i.test(error.stderr || '') ? 'automation_permission_required' : 'mac_media_unavailable' };
  }
}
async function main() {
  const index = process.argv.indexOf('--parent-pid');
  const parent = index < 0 ? 0 : Number(process.argv[index + 1]);
  while (true) {
    if (parent) { try { process.kill(parent, 0); } catch { return; } }
    process.stdout.write(JSON.stringify(await readMedia()) + '\n');
    await delay(2000);
  }
}
if (require.main === module) main().catch(() => { process.exitCode = 1; });
module.exports = { readMedia };
