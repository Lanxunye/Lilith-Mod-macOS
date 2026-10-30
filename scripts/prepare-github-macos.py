#!/usr/bin/env python3
"""Create local review artifacts from an allowlist. No Git, upload, install or credential copying."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'bin', 'obj', 'node_modules', '__pycache__', '.git', '.DS_Store', 'private-source',
        'translation-cache', 'translation-work', 'evidence', 'vendor'}
DIRECTORIES = ['companion', 'character', 'dsh-feiyu-mood-lilith', 'dsh-fish-memory-lilith', 'dsh-speak-up-lilith', 'locales', 'protocol', 'plugin/src', 'plugin/assets',
               'native', 'tests', 'loader', '.github', 'docs']
FILES = ['LICENSE','ASSET-NOTICE.md','THIRD-PARTY-NOTICES.md','README.md','README.en.md',
         'README.ja.md','README.zh-TW.md','DSH.md','DSH接入设计-20261022.md','COMFYUI.md',
         'INTEGRATIONS.md','QQBOT.md','dependencies-macos.json','plugin/LilithMod.csproj','.gitignore','.gitattributes']
SCRIPTS = ['build-macos.sh','test-macos.sh','build-loader-macos.sh','prepare-github-macos.py',
           'import-meme-library.cjs','build-lore-candidates.js','build-lilith-style.cjs','build-dsh-memory.cjs','extract-lilith-novel.py','launch-macos.py','import-comfy-workflow.py',
           'test-native-macos.sh','install-steam-macos.py','launch-installed-macos.cjs',
           'uninstall-installed-macos.cjs','companion-service.cjs','open-console.cjs','startup-services.cjs','build-location-helper.sh']
VERSION = json.loads((ROOT/'macos-release.json').read_text())['version']
if not re.fullmatch(r'\d+\.\d+\.\d+-macos\.dev\d+(?:\.\d+)?', VERSION):
    raise ValueError('Unexpected macOS preview version')

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def copy(source, target):
    if source.is_symlink():
        raise ValueError('Symlink in public source: '+str(source.relative_to(ROOT)))
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    target.chmod(0o755 if source.suffix in {'.sh','.py','.command'} else 0o644)

def copy_tree(source, target):
    for p in sorted(source.rglob('*')):
        rel = p.relative_to(source)
        if any(part in SKIP or part.startswith('.test') or part.startswith('.provider-test') for part in rel.parts):
            continue
        if p.is_file() and p.name != 'art-reference.md' and not p.name.endswith(('.log','.pdb','.dmp')):
            copy(p, target/rel)

def private_values(paths):
    values=set()
    def visit(item):
        if isinstance(item,dict):
            for key,value in item.items():
                if key in {'api_key','token','api_token','event_secret','vision_api_key','search_api_key','apiKey','secret','password','owner_qq','bot_qq'} and isinstance(value,str) and len(value)>=5:values.add(value.encode())
                visit(value)
        elif isinstance(item,list):
            for value in item:visit(value)
    for p in paths:visit(json.loads(p.read_text()))
    return values

def audit(tree, secrets):
    findings=[]
    for p in tree.rglob('*'):
        if not p.is_file():continue
        rel=p.relative_to(tree).as_posix(); raw=p.read_bytes();data=raw+raw.replace(b'\x00',b'')
        for secret in secrets:
            if secret in data:findings.append({'path':rel,'rule':'private_credential_exact_match'})
        homes=re.findall(rb'/Users/[A-Za-z0-9_.-]+/',data)
        # Explicit synthetic Mac-path fixtures exercise privacy filtering; real home paths still block.
        synthetic_home=b'/Users/'+b'private/'
        if any(h!=synthetic_home or not rel.startswith('companion/test/') for h in homes):
            findings.append({'path':rel,'rule':'personal_home_path'})
        keys=re.findall(rb'\bsk-[A-Za-z0-9_-]{20,}\b',data)
        synthetic_key=b'sk-'+b'fixture-never-return'
        if any(k!=synthetic_key or rel!='companion/test/dsh-search.js' for k in keys):
            findings.append({'path':rel,'rule':'key_pattern'})
        if p.suffix in {'.app','.pdb','.dmp'} or p.name in {'Assembly-CSharp.dll','GameAssembly.dylib','global-metadata.dat','config.json','runtime.json','qq.json','conversations.sqlite'}:
            findings.append({'path':rel,'rule':'private_or_game_artifact'})
    return findings

def sums(tree):
    rows=[digest(p)+'  '+p.relative_to(tree).as_posix() for p in sorted(tree.rglob('*')) if p.is_file() and p.name!='SHA256SUMS.txt']
    (tree/'SHA256SUMS.txt').write_text('\n'.join(rows)+'\n')
    return len(rows)

def archive(tree, output):
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(tree.rglob('*')):
            if not p.is_file():continue
            info=zipfile.ZipInfo(p.relative_to(tree).as_posix(),date_time=(2026,10,22,0,0,0))
            info.create_system=3;info.external_attr=(stat.S_IFREG|stat.S_IMODE(p.stat().st_mode))<<16
            info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes())
    with zipfile.ZipFile(output) as z:
        if z.testzip():raise ValueError('Archive CRC check failed')
        for name in z.namelist():
            if name.startswith('/') or '..' in Path(name).parts:raise ValueError('Unsafe archive path')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--binary-dir',type=Path,required=True)
    parser.add_argument('--secret-config',type=Path,action='append',default=[])
    args=parser.parse_args();out=args.output.resolve()
    if out.exists():raise SystemExit('Choose a NEW output directory; existing files are never removed.')
    out.mkdir(parents=True);repo=out/'repository';repo.mkdir();payload=out/'plugin-preview';payload.mkdir()
    for name in DIRECTORIES:copy_tree(ROOT/name,repo/name)
    for name in FILES:copy(ROOT/name,repo/name)
    for name in SCRIPTS:copy(ROOT/'scripts'/name,repo/'scripts'/name)
    (repo/'MACOS.md').write_text('# macOS 开发预览\n\n请阅读 [macOS 依赖与构建说明](docs/macos-preview.md)。本机工作区、私人截图和调试记录不在此公开审查包中。\n')
    # Local history/evidence references are not public release metadata.
    for p in [repo/'DSH.md',repo/'DSH接入设计-20261022.md']:
        s=p.read_text();s=re.sub(r'\[([^\]]+)\]\(evidence/[^)]+\)',r'\1（本机验收材料未公开）',s);p.write_text(s)
    metadata=json.loads((ROOT/'macos-release.json').read_text())
    public_keys=['version','date','game_version','unity_version','architecture','bepinex','node_tests','managed_tests',
                 'dsh','comfy','qq','qq_desktop_sync','chat_stickers','native_chat_editor','ime_candidate_follow','studio_layout','long_session_stability','spaces_follow']
    public_metadata = {k:metadata[k] for k in public_keys if k in metadata}
    public_metadata['artifacts'] = {name:{'sha256':metadata['artifacts'][name]['sha256']}
        for name in ['plugin','native_bridge','loader','loader_compat']}
    (repo/'macos-release.json').write_text(json.dumps(public_metadata,ensure_ascii=False,indent=2)+'\n')
    for name in ['LilithMod.dll','liblilith_macos.dylib']:
        copy(args.binary_dir/name,payload/'BepInEx/plugins'/name)
    if subprocess.check_output(['otool','-D',str(args.binary_dir/'liblilith_macos.dylib')],text=True).splitlines()[1].strip()!='@rpath/liblilith_macos.dylib':
        raise SystemExit('Native install name is not portable')
    commands=subprocess.check_output(['otool','-l',str(args.binary_dir/'liblilith_macos.dylib')],text=True)
    if not re.search(r'minos\s+11\.0\b',commands):raise SystemExit('Unexpected native deployment target')
    for name in ['character','locales']:
        copy_tree(repo/name,payload/'BepInEx/plugins'/name)
    for name in ['src','web','workflows','assets']:
        copy_tree(repo/'companion'/name,payload/'BepInEx/plugins/companion'/name)
    for name in ['package.json','package-lock.json','release-info.json','config.macos.example.json']:
        copy(repo/'companion'/name,payload/'BepInEx/plugins/companion'/name)
    copy_tree(repo/'plugin/assets',payload/'BepInEx/plugins/assets')
    for name in ['LICENSE','ASSET-NOTICE.md','THIRD-PARTY-NOTICES.md','dependencies-macos.json']:
        copy(repo/name,payload/name)
    copy(repo/'docs/macos-preview.md',payload/'README.md')
    (payload/'README.md').write_text('> 此为插件预览载荷。下文的完整构建与启动脚本位于配套 source-review.zip 中；本 ZIP 不含游戏、加载器二进制或一键安装器。\n\n'+
        (payload/'README.md').read_text().replace('](../loader/README.md)','](loader/README.md)'))
    copy_tree(repo/'loader',payload/'loader')
    copy(repo/'scripts/build-loader-macos.sh',payload/'scripts/build-loader-macos.sh')
    secrets=private_values(args.secret_config)
    findings=audit(repo,secrets)+audit(payload,secrets)
    if findings:
        (out/'audit-failed.json').write_text(json.dumps(findings,ensure_ascii=False,indent=2)+'\n')
        raise SystemExit('Public archive preparation blocked; see redacted audit-failed.json')
    count_source=sums(repo);count_payload=sums(payload)
    source_zip=out/f'Lilith-Mod-{VERSION}-source-review.zip'
    payload_zip=out/f'Lilith-Mod-{VERSION}-plugin-preview.zip'
    archive(repo,source_zip);archive(payload,payload_zip)
    result={'version':VERSION,'local_only':True,'git_commands_executed':False,'public_release_ready':False,
      'secret_scan':{'findings':0,'exact_private_values_checked':len(secrets)},
      'source_files':count_source,'payload_files':count_payload,
      'archives':[{'name':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in [source_zip,payload_zip]],
      'excluded':['game','interop','BepInEx binaries','patched LGPL loader','CLR','Node','models','personal settings/history','private screenshots'],
      'remaining':['out-of-support loader CLR','clean-machine installation/removal test','older macOS and Intel/multi-screen acceptance','public source preview; end-user binary installer not released']}
    (out/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
