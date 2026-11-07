#!/usr/bin/env python3
"""Token and tool usage from Claude Code transcripts (read-only, offline).

Usage:
  python3 scripts/measure-usage.py [FILE_OR_DIR ...] [--since 2026-11-07T00:00] [--until ...]

With no path, it reads every *.jsonl transcript under ~/.claude/projects/*MEGA-SYSTEM*/ (the main
sessions). Pass agent transcripts too: their paths show up in task notifications.
For each file it prints the number of assistant turns, the input/output and cache read/write tokens,
the model mix, the wall time, the top tool calls, how many times AI_HANDOFF.md and very large files
were read, and how many smoke runs were started.
Nothing here leaves the machine.
"""
import collections, glob, json, os, sys
from datetime import datetime

BIG = ('AI_HANDOFF.md', 'DesktopIsland.tsx', 'webBots.ts', 'apps/sport/index.html', 'finance/js/app.js', 'e2e/smoke.mjs')

def ts(s):
    try: return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception: return None

def scan(path, since=None, until=None):
    r = dict(turns=0, input=0, output=0, cache_read=0, cache_write=0, models=collections.Counter(),
             tools=collections.Counter(), big_reads=collections.Counter(), smoke=0, first=None, last=None)
    for line in open(path, encoding='utf8', errors='replace'):
        try: o = json.loads(line)
        except Exception: continue
        t = ts(o.get('timestamp', '') or '')
        if t and since and t < since: continue
        if t and until and t > until: continue
        m = o.get('message')
        if not isinstance(m, dict): continue
        if t:
            r['first'] = r['first'] or t; r['last'] = t
        u = m.get('usage')
        if o.get('type') == 'assistant' and u:
            r['turns'] += 1
            r['input'] += u.get('input_tokens', 0) or 0
            r['output'] += u.get('output_tokens', 0) or 0
            r['cache_read'] += u.get('cache_read_input_tokens', 0) or 0
            r['cache_write'] += u.get('cache_creation_input_tokens', 0) or 0
            r['models'][m.get('model', '?')] += 1
        for c in m.get('content') or []:
            if not isinstance(c, dict) or c.get('type') != 'tool_use': continue
            r['tools'][c.get('name')] += 1
            inp = json.dumps(c.get('input', {}))
            for b in BIG:
                if b in inp and c.get('name') in ('Read', 'Bash', 'Grep'): r['big_reads'][b] += 1
            if 'smoke' in inp and c.get('name') == 'Bash' and 'node --check' not in inp: r['smoke'] += 1
    return r

def main(argv):
    since = until = None; paths = []
    it = iter(argv)
    for a in it:
        if a == '--since': since = ts(next(it))
        elif a == '--until': until = ts(next(it))
        else: paths.append(a)
    if since and since.tzinfo is None: since = since.astimezone()
    if until and until.tzinfo is None: until = until.astimezone()
    if not paths: paths = glob.glob(os.path.expanduser('~/.claude/projects/*MEGA-SYSTEM*/'))
    files = []
    for p in paths:
        files += sorted(glob.glob(os.path.join(p, '*.jsonl'))) if os.path.isdir(p) else [p]
    tot = collections.Counter()
    for f in files:
        r = scan(f, since, until)
        if not r['turns']: continue
        wall = (r['last'] - r['first']).total_seconds() / 60 if r['first'] and r['last'] else 0
        print(f"== {os.path.basename(f)}")
        print(f"   turns {r['turns']}  input {r['input']:,}  output {r['output']:,}  cache read {r['cache_read']:,}  cache write {r['cache_write']:,}")
        print(f"   avg context/turn ~{(r['cache_read'] + r['input'] + r['cache_write']) // max(1, r['turns']):,}  wall {wall:.0f} min  smoke runs {r['smoke']}")
        print(f"   models {dict(r['models'])}")
        print(f"   tools {r['tools'].most_common(8)}")
        if r['big_reads']: print(f"   big-file reads {dict(r['big_reads'])}")
        for k in ('turns', 'input', 'output', 'cache_read', 'cache_write', 'smoke'): tot[k] += r[k]
    if len(files) > 1: print(f"== total {dict(tot)}")

if __name__ == '__main__':
    main(sys.argv[1:])
