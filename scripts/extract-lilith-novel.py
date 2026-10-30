"""Read-only extraction for the supplied Unity/Naninovel build.

Exports source-language tables and joins PrintText records to speakers and
source-line coordinates. Managed-reference command execution is NOT emulated.
Full game text stays in the ignored private-source folder, never in a package.
Requires the already installed UnityPy; does not launch or modify the game.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import struct
import UnityPy


def sha(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def i32(b, p):
    return struct.unpack_from('<i', b, p)[0]


def string(b, p):
    n = i32(b, p)
    if not 0 <= n <= len(b) - p - 4:
        raise ValueError('invalid string at ' + str(p))
    return b[p+4:p+4+n].decode('utf-8'), (p+4+n+3) & ~3


def aligned_strings(b):
    values = []
    for p in range(0, len(b)-4, 4):
        n = i32(b, p)
        if not 1 <= n <= min(20000, len(b)-p-4):
            continue
        try:
            s, end = string(b, p)
        except (UnicodeError, ValueError):
            continue
        if s.isprintable():
            values.append((p, s, end))
    return values


def extract_script(b, name, path_id):
    actual_name, pos = string(b, 28)
    assert actual_name == name
    count = i32(b, pos)
    assert 0 <= count < 100000
    pos += 4 + 8*count  # serialized managed-reference line IDs
    table_count = i32(b, pos)
    pos += 4
    ids = []
    for _ in range(table_count):
        s, pos = string(b, pos)
        ids.append(s)
    assert i32(b, pos) == table_count
    pos += 4
    texts = []
    for _ in range(table_count):
        s, pos = string(b, pos)
        texts.append(s)
    assert len(set(ids)) == len(ids)
    table = dict(zip(ids, texts))
    ss = aligned_strings(b)
    headers = []
    for j, (p, s, end) in enumerate(ss[:-2]):
        if (re.fullmatch(r'[A-Za-z_][A-Za-z0-9_+]*', s)
                and ss[j+1][0] == end and ss[j+1][1].startswith('Naninovel')
                and ss[j+2][0] == ss[j+1][2]
                and ss[j+2][1] in ('Elringus.Naninovel.Runtime', 'Assembly-CSharp')):
            headers.append((p, s, ss[j+2][2]))
    labels, commands = [], []
    for j, (p, typ, body) in enumerate(headers):
        limit = headers[j+1][0]-8 if j+1 < len(headers) else len(b)
        vals = [v for v in ss if body <= v[0] < limit]
        if typ == 'LabelScriptLine':
            _, q = string(b, body+4)  # line index followed by stable line GUID
            label, _ = string(b, q)
            labels.append((i32(b, body), label))
        if typ not in ('PrintText', 'AddChoice'):
            continue
        source_names = [v for v in vals if v[1] == name]
        hits = [v for v in vals if v[1] in table]
        if not hits or not source_names:
            continue
        ident = hits[0][1]
        assert all(v[1] == ident for v in hits), (name, p, 'ambiguous text ID')
        line = i32(b, source_names[0][2])
        # PrintText stores AuthorId after its third source-coordinate record.
        # Offset includes SourceLineIndex, inline-index, flags and padding.
        speaker = ''
        if typ == 'PrintText' and len(source_names) >= 3:
            author_pos = source_names[2][2] + 32
            speaker, _ = string(b, author_pos)
            assert len(speaker) < 100
        raw_speaker = speaker
        # An expression-valued author can contain a source-coordinate record.
        # Do not silently present that script name as a person's identity.
        if speaker == name or speaker.startswith('Prologue'):
            speaker = '[unresolved]'
        commands.append({'source_ref': name + '#' + ident, 'text_id': ident,
                         'line_index': line, 'speaker': speaker,
                         'speaker_raw': raw_speaker,
                         'kind': 'dialogue' if typ == 'PrintText' else 'choice',
                         'text': table[ident], 'object_path_id': path_id,
                         'record_offset': p})
    labels.sort()
    for row in commands:
        row['label'] = next((label for idx, label in reversed(labels)
                             if idx <= row['line_index']), 'script-start')
    commands.sort(key=lambda r: (r['line_index'], r['record_offset']))
    return {'name': name, 'object_path_id': path_id, 'sha256': hashlib.sha256(b).hexdigest(),
            'script_lines': count, 'source_table_entries': table_count,
            'source_table_end_offset': pos, 'source_table': table,
            'labels': labels, 'records': commands}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('bundle', type=pathlib.Path)
    ap.add_argument('output', type=pathlib.Path)
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    before = sha(args.bundle)
    env = UnityPy.load(str(args.bundle))
    scripts = []
    for obj in env.objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        b = obj.get_raw_data()
        try:
            name, _ = string(b, 28)
        except (ValueError, UnicodeError, struct.error):
            continue
        if re.fullmatch(r'Prologue\d+(?:_\d+)?|Title|StartGame|ExitGame', name):
            script = extract_script(b, name, obj.path_id)
            scripts.append(script)
            (args.output/(name+'.json')).write_text(json.dumps(script, ensure_ascii=False, indent=2)+'\n')
            lines = [f"{r['line_index']:04d} [{r['label']}] {r['speaker'] or r['kind']}: {r['text']} ({r['text_id']})"
                     for r in script['records']]
            (args.output/(name+'.txt')).write_text('\n'.join(lines)+'\n')
    assert len(scripts) == 20, 'expected 20 shipped main scripts in this build'
    after = sha(args.bundle)
    assert after == before, 'source changed during extraction'
    rows = [r for s in scripts for r in s['records']]
    manifest = {'schema_version': 1, 'source': str(args.bundle), 'source_sha256': before,
                'source_unchanged': True, 'unitypy_version': UnityPy.__version__,
                'scripts': [{k: s[k] for k in ('name', 'object_path_id', 'sha256', 'script_lines', 'source_table_entries')}
                            for s in sorted(scripts, key=lambda s:s['name'])],
                'totals': {'scripts': len(scripts), 'source_texts': sum(s['source_table_entries'] for s in scripts),
                           'dialogue_records': sum(r['kind']=='dialogue' for r in rows),
                           'choice_records': sum(r['kind']=='choice' for r in rows)},
                'speakers': dict(collections.Counter(r['speaker'] for r in rows if r['kind']=='dialogue')),
                'limitations': ['Static serialized source, not a runtime playthrough.',
                                'Command execution and branch reachability are not emulated.',
                                'No full generic typetree: only source tables, label metadata and selected command fields decoded.',
                                'Choice text and non-Lilith speakers are retained for context, not automatically treated as her speech.']}
    (args.output/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ('source_sha256','source_unchanged','totals','speakers')},ensure_ascii=False))


if __name__ == '__main__':
    main()
