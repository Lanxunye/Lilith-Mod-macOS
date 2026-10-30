using System.Text.Json;
using LilithMod;
var root=Path.Combine(Path.GetTempPath(),"lilith-shared-test-"+Guid.NewGuid());Directory.CreateDirectory(root);ModPaths.DataRoot=root;
try {
 var bridge=new MacSharedChatBridge();var seen=new List<(bool user,string text,bool proactive)>();
 void Deliver(bool user,string text,bool proactive)=>seen.Add((user,text,proactive));
 void Publish(params object[] rows)=>File.WriteAllText(Path.Combine(root,"shared-chat-events.json"),JsonSerializer.Serialize(new {cursor=rows.Length,messages=rows}));
 var old=new {seq=1,role="assistant",channel="proactive",request_id="speak-up:old",content="old"};
 Publish(old);bridge.Tick(true,Deliver);if(seen.Count!=0)throw new Exception("startup replay");
 var current=new {seq=2,role="assistant",channel="proactive",request_id="speak-up:new",content="自己想说的话"};
 Publish(old,current);UnityEngine.Time.unscaledTime+=2;bridge.Tick(false,Deliver);if(seen.Count!=0)throw new Exception("busy delivery");
 bridge.Tick(true,Deliver);if(seen.Count!=1||seen[0].text!="自己想说的话"||!seen[0].proactive||seen[0].user)throw new Exception("proactive projection");
 UnityEngine.Time.unscaledTime+=2;bridge.Tick(true,Deliver);if(seen.Count!=1)throw new Exception("duplicate delivery");
 Publish(old,current,new {seq=3,role="user",channel="qq",request_id="qq:1",content="QQ原话"});UnityEngine.Time.unscaledTime+=2;bridge.Tick(true,Deliver);
 if(!seen[1].user||seen[1].proactive||seen[1].text!="[QQ] QQ原话")throw new Exception("ordinary QQ changed");
 var user=new {seq=3,role="user",channel="qq",request_id="qq:1",content="QQ原话"};
 var p1=new {seq=4,role="assistant",channel="desktop",request_id="root:part:1",content="分条一",reply_part=new {emotion="shy",duration_ms=7800,index=1}};
 var p2=new {seq=5,role="assistant",channel="desktop",request_id="root:part:2",content="分条二",reply_part=new {emotion="happy",duration_ms=6500,index=2}};
 Publish(old,current,user,p1,p2);UnityEngine.Time.unscaledTime+=2;
 string lastEmotion="";int lastDuration=0;
 void Detailed(bool u,string text,bool dialogue,string emotion,int duration){Deliver(u,text,dialogue);lastEmotion=emotion;lastDuration=duration;}
 bridge.Tick(true,Detailed);if(seen.Count!=3||seen[2].text!="分条一"||!seen[2].proactive||lastEmotion!="shy"||lastDuration!=7800)throw new Exception("part metadata lost");
 bridge.Tick(true,Detailed);if(seen.Count!=3)throw new Exception("flashed queued messages");UnityEngine.Time.unscaledTime+=2;bridge.Tick(true,Detailed);if(seen.Count!=4||seen[3].text!="分条二")throw new Exception("tail skipped by cursor");
 Console.WriteLine("shared-chat-bridge: startup cursor, busy defer, proactive dialogue dispatch, no QQ mislabel, dedup and ordinary QQ passed");
} finally {Directory.Delete(root,true);}
namespace UnityEngine {public static class Time {public static float unscaledTime;}}
namespace LilithMod {internal static class ModPaths {internal static string DataRoot="";}}
