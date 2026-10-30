#!/usr/bin/env python3
"""Build an allowlisted public source tree and macOS setup ZIP. Never upload or copy user state."""
import argparse, importlib.util, json, shutil, hashlib, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('review',ROOT/'scripts/prepare-github-macos.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--binary-dir',type=Path,required=True);p.add_argument('--loader-dir',type=Path,required=True);p.add_argument('--secret-config',type=Path,action='append',default=[]);a=p.parse_args()
 out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);repo=out/'repository';repo.mkdir()
 review.SKIP.update({'.local-state','dist','coverage','screenshots','logs','.env'})
 for name in review.DIRECTORIES+['dsh-desktop-bridge','dsh-bili-subagent-lilith','packaging']:review.copy_tree(ROOT/name,repo/name)
 for name in review.FILES+['MACOS.md','macos-release.json','一键部署.command','安装游戏插件.command']:review.copy(ROOT/name,repo/name)
 for name in review.SCRIPTS+['build-public-release.py','bootstrap-macos.sh','install-macos.cjs','music-cli.cjs']:review.copy(ROOT/'scripts'/name,repo/'scripts'/name)
 # Keep the already-reviewed Purge adaptation and its own MIT notices, not node_modules or private backups.
 purge=ROOT.parent/'dsh-purge-lilith'
 if not purge.exists():purge=ROOT/'dsh-purge-lilith'
 for name in ['lib','bin','lilith','presets','docs','skills','scripts']:review.copy_tree(purge/name,repo/'dsh-purge-lilith'/name)
 for name in ['package.json','client.js','cordis.patch.yml','LICENSE','NOTICE.md','CONTRIBUTORS.md','README.md','README.zh-CN.md','LILITH-ADAPTATION.md','NATIVE-PANEL.md','screenshots.json']:review.copy(purge/name,repo/'dsh-purge-lilith'/name)
 for name in ['DSH.md','DSH接入设计-20261022.md']:
  import re
  f=repo/name;f.write_text(re.sub(r'\[([^\]]+)\]\(evidence/[^)]+\)',r'\1（本机验收材料未公开）',f.read_text()))
 metadata=json.loads((repo/'macos-release.json').read_text())
 metadata={k:v for k,v in metadata.items() if not k.endswith('_evidence') and k not in ['desktop_window_evidence']}
 metadata['artifacts']={k:{'sha256':review.digest(a.binary_dir/name)} for k,name in [('plugin','LilithMod.dll'),('native_bridge','liblilith_macos.dylib')]}
 for key,name in [('loader','BepInEx.Unity.IL2CPP.dll'),('loader_compat','LilithLoaderCompat.dll')]:metadata['artifacts'][key]={'sha256':review.digest(a.loader_dir/name)}
 # Nested evidence pointers are local validation notes, never a dependency of the installer.
 def clean(v):
  if isinstance(v,dict):return {k:clean(x) for k,x in v.items() if k!='evidence'}
  if isinstance(v,list):return [clean(x) for x in v]
  return v
 metadata=clean(metadata);(repo/'macos-release.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
 secrets=review.private_values(a.secret_config);findings=review.audit(repo,secrets)
 if findings:(out/'audit-failed.json').write_text(json.dumps(findings,ensure_ascii=False,indent=2));raise SystemExit('Source audit blocked; see audit-failed.json')
 setup=out/'setup';shutil.copytree(repo,setup)
 for name in ['LilithMod.dll','liblilith_macos.dylib']:review.copy(a.binary_dir/name,setup/'payload'/name)
 findings=review.audit(setup,secrets)
 if findings:(out/'audit-failed.json').write_text(json.dumps(findings,ensure_ascii=False,indent=2));raise SystemExit('Setup audit blocked; see audit-failed.json')
 review.sums(repo);review.sums(setup)
 version=metadata['version'];archives=[]
 for tree,suffix in [(repo,'source'),(setup,'setup')]:
  file=out/f'Lilith-Mod-{version}-macOS-{suffix}.zip';review.archive(tree,file);archives.append({'name':file.name,'bytes':file.stat().st_size,'sha256':review.digest(file)})
 (out/'SHA256SUMS.txt').write_text(''.join(x['sha256']+'  '+x['name']+'\n' for x in archives))
 result={'version':version,'secret_findings':0,'archives':archives,'scope':'One-click console deployment; game plugin requires preinstalled compatible loader; no clean-machine game install claim'}
 (out/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
