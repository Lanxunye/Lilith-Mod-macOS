'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {fault}=require('./conversation-store');
const run=promisify(execFile);
const MAX_SOURCE_BYTES=20*1024*1024,MAX_VISION_BYTES=6*1024*1024,MAX_SOURCE_PIXELS=80*1000*1000;
function imageType(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(bytes.subarray(0,6).toString().startsWith('GIF8'))return 'image/gif';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';throw fault('qq_image_format_unsupported');}
async function prepareVisionImage(bytes){
 if(bytes.length>MAX_SOURCE_BYTES)throw fault('qq_image_too_large');
 const mime=imageType(bytes);if(bytes.length<=MAX_VISION_BYTES)return {bytes,mime};
 if(process.platform!=='darwin')throw fault('qq_image_processing_unavailable');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-vision-'));fs.chmodSync(dir,0o700);
 try{
  const input=path.join(dir,'input.'+mime.split('/')[1]);fs.writeFileSync(input,bytes,{mode:0o600});
  const options={timeout:15000,maxBuffer:32768,windowsHide:true};
  const {stdout}=await run('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',input],options);
  const width=Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]),height=Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if(!width||!height||width>32768||height>32768||width*height>MAX_SOURCE_PIXELS)throw fault('qq_image_dimensions_exceeded');
  for(const [edge,quality]of [[4096,85],[3072,75]]){
   const output=path.join(dir,'vision-'+edge+'.jpeg');
   await run('/usr/bin/sips',['--resampleHeightWidthMax',String(edge),'-s','format','jpeg','-s','formatOptions',String(quality),input,'--out',output],options);
   const size=fs.statSync(output).size;if(size>MAX_VISION_BYTES)continue;
   const result=fs.readFileSync(output);if(imageType(result)!=='image/jpeg')throw fault('qq_image_processing_failed');
   return {bytes:result,mime:'image/jpeg'};
  }
  throw fault('qq_image_too_large');
 }catch(e){if(e.code&&/^qq_image_/.test(e.code))throw e;throw fault('qq_image_processing_failed');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={MAX_SOURCE_BYTES,MAX_VISION_BYTES,MAX_SOURCE_PIXELS,imageType,prepareVisionImage};
