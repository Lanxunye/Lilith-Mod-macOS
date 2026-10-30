'use strict';
const fs=require('node:fs'),path=require('node:path');
const {systemLocation,normalizeLocation}=require('./system-location');
const VERSION='2026.10.29.1',DEFAULTS={enabled:false,provider_consent:false,refresh_minutes:30,location_hours:6,revision:1};
const relevant=s=>/天气|天氣|气温|氣溫|室外温度|室外溫度|体感|體感|下雨|下雪|冷不冷|热不热|熱不熱|多少度|带伞|帶傘|定位|所在地|我在哪|weather|temperature|outside|天気|気温/i.test(String(s||''));
const weatherCodes={0:'晴',1:'大致晴朗',2:'局部多云',3:'阴天',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'较强毛毛雨',56:'轻微冻毛毛雨',57:'冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'轻微冻雨',67:'冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'阵雨',82:'强阵雨',85:'小阵雪',86:'强阵雪',95:'雷暴',96:'雷暴伴小冰雹',99:'雷暴伴冰雹'};
const fault=code=>Object.assign(Error(code),{code});
const load=f=>{try{return JSON.parse(fs.readFileSync(f));}catch{return null;}};
function write(f,value){const temp=f+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,f);}
function range(v,min,max){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;}
async function weatherRead(location,{request=fetch,now=Date.now}={}){
 const lat=Math.round(location.latitude*10)/10,lon=Math.round(location.longitude*10)/10;
 if(!range(lat,-90,90)||!range(lon,-180,180))throw fault('weather_invalid_location');
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m,is_day',daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:'1',temperature_unit:'celsius',wind_speed_unit:'ms',timezone:'auto',timeformat:'unixtime'}).toString();
 let res;try{res=await request(url.toString(),{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});}catch{throw fault('weather_service_unreachable');}
 if(!res.ok)throw fault('weather_service_error');
 const chunks=[];let size=0;try{for await(const bytes of res.body){size+=bytes.length;if(size>128*1024){await res.body.cancel?.().catch(()=>{});throw fault('weather_response_too_large');}chunks.push(Buffer.from(bytes));}}catch(e){if(e.code)throw e;throw fault('weather_invalid_response');}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fault('weather_invalid_response');}
 const c=body.current,u=body.current_units||{},at=now();
 if(body.error||!c||!range(c.temperature_2m,-100,65)||!range(c.time,0,at/1000+300)||at-c.time*1000>90*60000||u.temperature_2m!=='°C'||u.time!=='unixtime')throw fault('weather_invalid_or_stale_data');
 const current={source:'Open-Meteo',source_url:'https://open-meteo.com/',data_type:'weather_model_estimate',temperature_c:c.temperature_2m,observed_at:new Date(c.time*1000).toISOString(),fetched_at:new Date(at).toISOString(),place:location.city||'系统定位的近似区域',location_observed_at:new Date(location.observed_at).toISOString(),location_precision:'约10公里范围或系统定位误差，以较大者为准'};
 try{new Intl.DateTimeFormat('zh-CN',{timeZone:body.timezone});current.timezone=body.timezone;}catch{current.timezone='UTC';}
 if(range(c.apparent_temperature,-120,90)&&u.apparent_temperature==='°C')current.feels_like_c=c.apparent_temperature;
 if(range(c.relative_humidity_2m,0,100)&&u.relative_humidity_2m==='%')current.humidity_percent=c.relative_humidity_2m;
 if(range(c.wind_speed_10m,0,150)&&u.wind_speed_10m==='m/s')current.wind_m_s=c.wind_speed_10m;
 if(range(c.precipitation,0,500)&&u.precipitation==='mm')current.precipitation_mm=c.precipitation;
 if(Number.isInteger(c.weather_code)&&weatherCodes[c.weather_code])current.condition=weatherCodes[c.weather_code];
 if(c.is_day===0||c.is_day===1)current.is_day=!!c.is_day;
 const daily=body.daily,du=body.daily_units||{};
 if(daily&&Array.isArray(daily.time)&&range(daily.time[0],0,at/1000+86400)){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:current.timezone}).format(new Date(daily.time[0]*1000));
  if(date===new Intl.DateTimeFormat('en-CA',{timeZone:current.timezone}).format(new Date(at))){
   current.today={date};for(const [key,output,min,max,unit]of [['temperature_2m_max','high_c',-100,65,'°C'],['temperature_2m_min','low_c',-100,65,'°C'],['precipitation_probability_max','rain_probability_percent',0,100,'%']])if(Array.isArray(daily[key])&&range(daily[key][0],min,max)&&du[key]===unit)current.today[output]=daily[key][0];
  }
 }
 return current;
}
class WeatherContext{
 constructor({root,getBinding=()=>'',locate=systemLocation,readWeather=weatherRead,now=Date.now,autoTick=true}={}){
  Object.assign(this,{root,getBinding,locate,readWeather,now});this.dir=path.join(root,'weather');fs.mkdirSync(this.dir,{recursive:true,mode:0o700});this.file=path.join(this.dir,'config.json');this.cacheFile=path.join(this.dir,'state.json');
  if(!fs.existsSync(this.file))write(this.file,DEFAULTS);this.state=load(this.cacheFile)||{};this.busy=null;this.closed=false;this.lastAttempt=0;this.retryAt=0;
  this.timer=autoTick?setInterval(()=>{if(this.allowed()&&this.now()>=this.retryAt)void this.refresh().catch(()=>{});},60000):null;this.timer?.unref();
 }
 config(){return {...DEFAULTS,...load(this.file)};}
 allowed(channel='desktop'){const c=this.config();return !this.closed&&c.enabled&&c.provider_consent===true&&!!this.getBinding()&&c.owner_binding===this.getBinding()&&['desktop','qq'].includes(channel);}
 patch(body){const c=this.config();for(const [k,v]of Object.entries(body||{})){if(['enabled','provider_consent'].includes(k)&&typeof v==='boolean')c[k]=v;else if(k==='refresh_minutes'&&Number.isInteger(v)&&v>=15&&v<=120)c[k]=v;else if(k==='location_hours'&&Number.isInteger(v)&&v>=1&&v<=24)c[k]=v;else throw fault('weather_invalid_setting');}
  if(body.provider_consent===true){c.consent_provider='api.open-meteo.com';c.consented_at=new Date(this.now()).toISOString();}
  if(body.enabled===true){if(!this.getBinding())throw fault('weather_owner_binding_required');c.owner_binding=this.getBinding();}
  c.revision++;write(this.file,c);this.retryAt=0;this.lastAttempt=0;
  if(!c.enabled||!c.provider_consent){this.state={};write(this.cacheFile,this.state);}return this.status();
 }
 locationFresh(){const c=this.config(),l=this.state.location;return this.state.binding===this.getBinding()&&l?.status==='available'&&l.observed_at<=this.now()+60000&&this.now()-l.observed_at<c.location_hours*3600000;}
 fresh(){const r=this.state.current;return this.locationFresh()&&!!r&&Date.parse(r.fetched_at)<=this.now()+60000&&this.now()-Date.parse(r.fetched_at)<this.config().refresh_minutes*60000&&this.now()-Date.parse(r.observed_at)<90*60000;}
 snapshot(channel='desktop'){
  if(channel==='qq_group')return {supported:true,available:false,status:'private_scope',scope:'owner_private_and_desktop'};
  const c=this.config();if(!this.allowed(channel))return {supported:true,available:false,status:!c.enabled?'disabled':!c.provider_consent?'provider_consent_required':'owner_binding_changed',scope:'owner_private_and_desktop'};
  const same=this.state.binding===this.getBinding(),fresh=this.fresh();
  return {supported:true,available:fresh,status:fresh?(this.state.error?'cached_after_error':'available'):this.busy?'refreshing':same?this.state.error||(this.state.current?'stale':this.state.location?.status==='available'?'weather_not_requested':this.state.location?.status||'not_requested'):'not_requested',scope:'owner_private_and_desktop',refreshing:!!this.busy,location:{method:'macos_core_location',status:same?this.state.location?.status||'not_requested':'not_requested',precision:'rounded_0.1_degree'},...(fresh?{current:this.state.current}:{}),...(same&&this.state.current&&!fresh?{previous_reading_at:this.state.current.observed_at}:{}),last_error:same?this.state.error||'':''};
 }
 status(){const c=this.config();return {installed:true,version:VERSION,config:{enabled:c.enabled,provider_consent:c.provider_consent,refresh_minutes:c.refresh_minutes,location_hours:c.location_hours},...this.snapshot(),attribution:'Weather data by Open-Meteo (CC BY 4.0)',no_ip_location:true};}
 async refresh({force=false,forceLocation=false,requestPermission=false}={}){
  if(!this.allowed())return this.status();if(this.busy){await this.busy;if(requestPermission&&this.allowed()&&this.state.location?.status==='permission_required')return this.refresh({force,forceLocation,requestPermission});return this.status();}
  if(!force&&!forceLocation&&!requestPermission&&this.fresh())return this.status();
  if(!requestPermission&&!forceLocation&&this.lastAttempt&&this.now()-this.lastAttempt<60000)return this.status();
  const c=this.config(),binding=this.getBinding();this.lastAttempt=this.now();
  const valid=()=>this.allowed()&&this.config().revision===c.revision&&this.getBinding()===binding;
  this.busy=(async()=>{try{
   let location=this.locationFresh()&&!forceLocation&&!requestPermission?this.state.location:null;
   if(!location){const raw=await this.locate({root:this.root,requestPermission});if(!valid())return;location=normalizeLocation(raw,this.now());
    if(location.status!=='available'){this.state={binding,location,error:location.status};write(this.cacheFile,this.state);this.retryAt=this.now()+30*60000;return;}
   }
   const previous=this.state.binding===binding&&this.state.location?.latitude===location.latitude&&this.state.location?.longitude===location.longitude?this.state.current:null;
   this.state={binding,location,...(previous?{current:previous}:{}),error:''};write(this.cacheFile,this.state);
   const current=await this.readWeather(location,{now:this.now});if(!valid())return;
   this.state={binding,location,current,error:''};write(this.cacheFile,this.state);this.retryAt=this.now()+c.refresh_minutes*60000;
  }catch(e){if(valid()){this.state={...(this.state.binding===binding?this.state:{}),binding,error:/^weather_[a-z_]+$/.test(e.code||'')?e.code:'weather_unavailable'};write(this.cacheFile,this.state);this.retryAt=this.now()+5*60000;}}
  })();
  try{await this.busy;}finally{this.busy=null;}return this.status();
 }
 async observe(channel,message){if(this.allowed(channel)&&relevant(message)){
  let timer;try{await Promise.race([this.refresh({forceLocation:/重新定位|更新位置|我在哪|我在哪裡|换城市|換城市/.test(String(message))}),new Promise(r=>{timer=setTimeout(r,8000);})]);}finally{clearTimeout(timer);}
 }}
 close(){this.closed=true;clearInterval(this.timer);}
}
module.exports={WeatherContext,weatherRead,VERSION,relevant};
