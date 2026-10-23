#!/usr/bin/env python3
"""Convert a local Comfy canvas using the running server's node schemas; no model downloads."""
import argparse, json, urllib.request, hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--base',default='http://127.0.0.1:8188');a=p.parse_args()
raw=a.source.read_bytes();canvas=json.loads(raw)
info=json.load(urllib.request.urlopen(a.base.rstrip('/')+'/object_info',timeout=10))
links={link[0]:link for link in canvas['links']}; graph={}
for node in canvas['nodes']:
 if node.get('mode',0)!=0: raise SystemExit('Disabled/bypass nodes need explicit review')
 schema=info[node['type']]['input'];inputs={};widgets=iter(node.get('widgets_values',[]));ports={i['name']:i for i in node.get('inputs',[])}
 for name,spec in {**schema.get('required',{}),**schema.get('optional',{})}.items():
  port=ports.get(name,{})
  if port.get('link') is not None:
   link=links[port['link']];inputs[name]=[str(link[1]),link[2]];continue
  if isinstance(spec[0],list) or spec[0] in ['INT','FLOAT','STRING','BOOLEAN']:
   try:inputs[name]=next(widgets)
   except StopIteration:
    if name in schema.get('required',{}):raise SystemExit('Missing widget: '+node['type']+'.'+name)
    continue
   if len(spec)>1 and isinstance(spec[1],dict) and spec[1].get('control_after_generate'):next(widgets,None)
 graph[str(node['id'])]={'class_type':node['type'],'inputs':inputs}
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(graph,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'source':str(a.source),'source_sha256':hashlib.sha256(raw).hexdigest(),'nodes':len(graph),'output':str(a.output)},ensure_ascii=False))
