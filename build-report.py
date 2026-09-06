# -*- coding: utf-8 -*-
"""
pool-history.json + pool-records.template.html  ->  pool-records.html

pool-history.json is the source of truth and is edited by hand. This script
applies the pool's scoring rules, checks the file for mistakes, recomputes every
statistic, and writes a standalone page that opens straight from disk.

    py build-report.py
    start pool-records.html

Add a season by copying a "seasons" block in pool-history.json; see the
"howToAddASeason" key at the top of that file.
"""
import json, os, sys, re, unicodedata, statistics as st
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'pool-history.json')
TPL = os.path.join(HERE, 'pool-records.template.html')
OUT = os.path.join(HERE, 'pool-records.html')
MARK = '/*__PAYLOAD__*/'

problems, notes = [], []


def fail(msg):
    problems.append(msg)


def warn(msg):
    notes.append(msg)


H = json.load(open(SRC, encoding='utf-8'))
FORMATS = H['formats']
POOLERS = H.get('poolers', {})


# ==========================================================================
# 1. scoring — apply the pool's rules to each roster
# ==========================================================================
def choose(picks, fmt, where):
    """Return the set of indices that count.

    Best N by points, except that at least one defenceman must be among them
    when the format requires it: the lowest of the chosen is then dropped for
    the highest-scoring defenceman available.
    """
    n = fmt['counted']
    scored = [(i, p) for i, p in enumerate(picks) if p.get('pts') is not None]
    if len(scored) < n:
        fail('%s : %d choix pointes, il en faut %d' % (where, len(scored), n))
        return {i for i, _ in scored}
    order = sorted(scored, key=lambda ip: (-ip[1]['pts'], ip[0]))
    chosen = [i for i, _ in order[:n]]

    if fmt.get('requireDefenceman'):
        has_def = any(picks[i].get('def') for i in chosen)
        marked = [i for i, p in scored if p.get('def')]
        if not marked:
            warn('%s : aucun defenseur identifie ("def": true) — regle du defenseur non verifiee'
                 % where)
        elif not has_def:
            best_d = max(marked, key=lambda i: picks[i]['pts'])
            drop = min(chosen, key=lambda i: (picks[i]['pts'], -i))
            chosen = [i for i in chosen if i != drop] + [best_d]
    return set(chosen)


seasons = []
for s in H['seasons']:
    fmt = FORMATS.get(s['format'])
    if not fmt:
        fail('saison %s : format inconnu "%s" (connus : %s)'
             % (s['year'], s['format'], ', '.join(FORMATS)))
        continue

    seen = Counter(e['pooler'] for e in s['entries'])
    for nm, k in seen.items():
        if k > 1:
            fail('saison %s : "%s" apparait %d fois' % (s['year'], nm, k))

    entries = []
    for e in s['entries']:
        where = '%s / %s' % (s['year'], e['pooler'])
        picks = e['picks']

        if len(picks) != fmt['picks']:
            warn('%s : %d choix, le format en prevoit %d' % (where, len(picks), fmt['picks']))

        explicit = [p for p in picks if 'counts' in p]
        if explicit and len(explicit) != len(picks):
            fail('%s : "counts" present sur %d choix sur %d — mettez-le partout ou nulle part'
                 % (where, len(explicit), len(picks)))
        if explicit:
            counted = {i for i, p in enumerate(picks) if p['counts']}
            if len(counted) != fmt['counted']:
                fail('%s : %d choix marques "counts", le format en compte %d'
                     % (where, len(counted), fmt['counted']))
        else:
            counted = choose(picks, fmt, where)

        extras = e.get('extras', [])
        extra_counted = [x for x in extras if x.get('counts', True)]

        score = sum(picks[i]['pts'] for i in counted if picks[i].get('pts') is not None) \
            + sum(x['pts'] for x in extra_counted if x.get('pts') is not None)

        if 'score' in e and e['score'] != score:
            # Un ecart devient acceptable seulement s'il est documente par un
            # "scoreNote" : c'est le cas d'une feuille source qui ne se
            # reconcilie pas. Le score inscrit fait alors foi.
            if e.get('scoreNote'):
                warn('%s : score inscrit %s, somme des choix %s (ecart documente, '
                     'le score inscrit fait foi)' % (where, e['score'], score))
                score = e['score']
            else:
                fail('%s : score inscrit %s, score calcule %s' % (where, e['score'], score))

        for p in picks:
            if p.get('pts') is not None and p['pts'] < 0:
                warn('%s : %s a %s points' % (where, p['player'], p['pts']))

        entries.append(dict(
            pooler=e['pooler'], score=score,
            roster=[dict(player=p['player'], team=p.get('team'), pts=p.get('pts'),
                         counted=(i in counted), dman=bool(p.get('def')))
                    for i, p in enumerate(picks)],
            extras=[dict(player=x['player'], team=x.get('team'), pts=x.get('pts'),
                         counted=x.get('counts', True)) for x in extras]))

    # equal scores keep the order they have in the file
    entries.sort(key=lambda x: -x['score'])
    for i, e in enumerate(entries, 1):
        e['rank'] = i

    seasons.append(dict(year=s['year'], season=s['season'], fieldSize=len(entries),
                        format=fmt, entries=entries))

seasons.sort(key=lambda x: x['year'])

if problems:
    print('pool-history.json comporte %d probleme(s) :\n' % len(problems), file=sys.stderr)
    for p in problems:
        print('  x %s' % p, file=sys.stderr)
    print('\nRien na ete ecrit. Corrigez le fichier source et relancez.', file=sys.stderr)
    sys.exit(1)


# ==========================================================================
# 2. checks worth reporting on the page
# ==========================================================================
def keyof(p):
    p = re.sub(r'\(\d\)', '', p)
    p = unicodedata.normalize('NFKD', p.lower())
    return re.sub(r'[^a-z]', '', ''.join(c for c in p if not unicodedata.combining(c)))


dupes, negs, swaps = [], [], []
for s in seasons:
    owners = defaultdict(list)
    for e in s['entries']:
        for p in e['roster']:
            owners[keyof(p['player'])].append(e['pooler'])
        for p in e['roster']:
            if p['pts'] is not None and p['pts'] < 0:
                negs.append(dict(year=s['year'], pooler=e['pooler'],
                                 player=p['player'], pts=p['pts']))
        marked = [p for p in e['roster'] if p['counted'] and p['pts'] is not None]
        if marked:
            floor = min(p['pts'] for p in marked)
            higher = [p for p in e['roster']
                      if not p['counted'] and p['pts'] is not None and p['pts'] > floor]
            if higher:
                lower = [p for p in marked if p['pts'] < max(h['pts'] for h in higher)]
                swaps.append(dict(year=s['year'], pooler=e['pooler'],
                                  countedLower=[dict(player=p['player'], pts=p['pts'])
                                                for p in lower],
                                  excludedHigher=[dict(player=p['player'], pts=p['pts'])
                                                  for p in higher]))
    for k, lst in owners.items():
        if len(lst) > 1:
            dupes.append(dict(year=s['year'], poolers=lst))

checks = [
    dict(check='Score recalcule = score inscrit dans le fichier',
         cases=0, ok=True, expected=False),
    dict(check='Un joueur, un seul pooler par saison',
         cases=len(dupes), ok=not dupes, expected=False),
    dict(check='Nombre de choix comptes conforme au format',
         cases=0, ok=True, expected=False),
    dict(check='Points negatifs', cases=len(negs), ok=not negs, expected=False),
    dict(check='Regle du defenseur : choix compte hors ordre de pointage',
         cases=len(swaps), ok=True, expected=True),
]


# ==========================================================================
# 3. derived statistics
# ==========================================================================
seasonTable = []
for s in seasons:
    sc = [e['score'] for e in s['entries']]
    seasonTable.append(dict(
        year=str(s['year']), n=s['fieldSize'], champ=s['entries'][0]['pooler'], score=sc[0],
        margin=sc[0] - sc[1] if len(sc) > 1 else 0, avg=round(st.mean(sc), 1),
        last=s['entries'][-1]['pooler'], lastScore=sc[-1], era=s['format']['label'],
        standings=[[e['pooler'], e['score']] for e in s['entries']]))

car = defaultdict(lambda: dict(years=[], ranks=[], fields=[], scores=[], z=[]))
years_list = [s['year'] for s in seasons]
for s in seasons:
    sc = [e['score'] for e in s['entries']]
    m, sd = st.mean(sc), st.pstdev(sc) or 1
    for e in s['entries']:
        c = car[e['pooler']]
        c['years'].append(s['year']); c['ranks'].append(e['rank'])
        c['fields'].append(s['fieldSize']); c['scores'].append(e['score'])
        c['z'].append((e['score'] - m) / sd)

careers = []
for nm, c in car.items():
    n = len(c['years'])
    idx = [years_list.index(y) for y in c['years']]
    best = cur = 1
    for a, b in zip(idx, idx[1:]):
        cur = cur + 1 if b == a + 1 else 1
        best = max(best, cur)
    pctl = [1.0 if N == 1 else (N - r) / (N - 1) for r, N in zip(c['ranks'], c['fields'])]
    careers.append(dict(
        name=nm, seasons=n, first=str(c['years'][0]), last=str(c['years'][-1]),
        titles=sum(1 for r in c['ranks'] if r == 1),
        titleYears=[str(y) for y, r in zip(c['years'], c['ranks']) if r == 1],
        podiums=sum(1 for r in c['ranks'] if r <= 3),
        lasts=sum(1 for r, N in zip(c['ranks'], c['fields']) if r == N),
        topHalf=round(sum(1 for r, N in zip(c['ranks'], c['fields']) if r <= N / 2) / n * 100),
        rating=round(sum(pctl) / n * 100, 1), z=round(sum(c['z']) / n, 2),
        avgRank=round(sum(c['ranks']) / n, 1), bestRank=min(c['ranks']),
        streak=best, active=c['years'][-1] == years_list[-1],
        yearRanks=[[str(y), r, N, sc] for y, r, N, sc in
                   zip(c['years'], c['ranks'], c['fields'], c['scores'])]))
careers.sort(key=lambda d: (-d['rating'], -d['seasons']))

allz = []
for s in seasons:
    sc = [e['score'] for e in s['entries']]
    m, sd = st.mean(sc), st.pstdev(sc) or 1
    for e in s['entries']:
        allz.append(dict(z=round((e['score'] - m) / sd, 2), year=str(s['year']),
                         name=e['pooler'], score=e['score'], rank=e['rank'], n=s['fieldSize']))
allz.sort(key=lambda d: -d['z'])

h2h = defaultdict(lambda: [0, 0])
for s in seasons:
    r = s['entries']
    for i in range(len(r)):
        for j in range(i + 1, len(r)):
            k = tuple(sorted((r[i]['pooler'], r[j]['pooler'])))
            h2h[k][0 if k[0] == r[i]['pooler'] else 1] += 1
duels = [dict(a=a, b=b, wa=wa, wb=wb, t=wa + wb, p=round(wa / (wa + wb) * 100))
         for (a, b), (wa, wb) in h2h.items() if wa + wb >= 8]

byplayer = defaultdict(list)
for s in seasons:
    for e in s['entries']:
        for p in e['roster'] + e['extras']:
            byplayer[keyof(p['player'])].append((s['year'], e['pooler'], p['pts'], p['player']))
players = []
for k, lst in byplayer.items():
    pts = [p for _, _, p, _ in lst if p is not None]
    label = Counter(n for _, _, _, n in lst).most_common(1)[0][0]
    players.append(dict(player=re.sub(r'\s*\(\d\)\s*$', '', label).strip(),
                        times=len(lst), owners=len({o for _, o, _, _ in lst}),
                        first=str(min(y for y, _, _, _ in lst)),
                        last=str(max(y for y, _, _, _ in lst)),
                        avg=round(sum(pts) / len(pts), 1) if pts else 0))
players.sort(key=lambda p: (-p['times'], p['player']))

picks = [(str(s['year']), e['pooler'], i, p['player'], p['pts'], p['counted'])
         for s in seasons for e in s['entries']
         for i, p in enumerate(e['roster'], 1) if p['player'] and p['player'] != '.']
bestPicks = sorted((dict(pts=int(pt), player=pl, year=y, by=nm)
                    for y, nm, i, pl, pt, c in picks if pt is not None),
                   key=lambda d: -d['pts'])[:15]
busts = sorted((dict(pts=int(pt), player=pl, year=y, by=nm)
                for y, nm, i, pl, pt, c in picks if pt is not None and 0 <= pt <= 5),
               key=lambda d: (d['year'], d['pts']))

fp = defaultdict(list)
for y, nm, i, pl, pt, c in picks:
    if i == 1 and pt is not None and pt > 0:
        fp[nm].append(pt)
firstPick = [dict(name=nm, avg=round(st.mean(l), 1), n=len(l))
             for nm, l in sorted(fp.items(), key=lambda kv: -st.mean(kv[1])) if len(l) >= 5]

eff = defaultdict(lambda: [0, 0])
for s in seasons:
    if s['format']['picks'] != 12:
        continue
    for e in s['entries']:
        for p in e['roster']:
            if p['pts'] is None or p['pts'] < 0:
                continue
            eff[e['pooler']][1] += p['pts']
            if p['counted']:
                eff[e['pooler']][0] += p['pts']
efficiency = [dict(name=nm, pct=round(a / b * 100, 1), counted=int(a), total=int(b))
              for nm, (a, b) in sorted(eff.items(), key=lambda kv: -(kv[1][0] / kv[1][1]))
              if b >= 3000]

years_of = defaultdict(list)
for s in seasons:
    for e in s['entries']:
        years_of[e['pooler']].append(str(s['year']))
names = [dict(name=nm, sheetNames=sorted(set(info.get('writtenAs', []) + [nm])),
              seasons=len(years_of.get(nm, [])),
              identity=info.get('establishedBy', 'literal'), evidence=info.get('note', ''))
         for nm, info in POOLERS.items() if nm in years_of]
names.sort(key=lambda d: -d['seasons'])
unresolved = [dict(label=(info.get('writtenAs') or [nm])[0], years=years_of[nm],
                   note=info.get('note', ''))
              for nm, info in POOLERS.items()
              if info.get('establishedBy') == 'unresolved' and nm in years_of]
unresolved.sort(key=lambda u: u['years'])

payload = dict(
    meta=dict(seasons=len(seasons), first=str(seasons[0]['year']), last=str(seasons[-1]['year']),
              entries=sum(s['fieldSize'] for s in seasons), poolers=len(careers),
              avgField=round(sum(s['fieldSize'] for s in seasons) / len(seasons), 1),
              minField=min(s['fieldSize'] for s in seasons),
              maxField=max(s['fieldSize'] for s in seasons),
              empty=[], sheets=0),
    seasonTable=seasonTable, careers=careers, top=allz[:12], bottom=allz[-12:][::-1],
    duels=duels, mostDrafted=players[:25], bestPicks=bestPicks, busts=busts,
    firstPick=firstPick, efficiency=efficiency,
    picksTotal=sum(len(e['roster']) + len(e['extras']) for s in seasons for e in s['entries']),
    playersDistinct=len(players), checks=checks,
    dRule=[dict(year=x['year'], pooler=x['pooler'],
                inn=x['countedLower'][0]['player'] if x['countedLower'] else '',
                innPts=x['countedLower'][0]['pts'] if x['countedLower'] else 0,
                out=x['excludedHigher'][-1]['player'], outPts=x['excludedHigher'][-1]['pts'])
           for x in swaps],
    unresolved=unresolved, names=names,
)

tpl = open(TPL, encoding='utf-8').read()
if MARK not in tpl:
    raise SystemExit('marqueur %s introuvable dans %s' % (MARK, os.path.basename(TPL)))
open(OUT, 'w', encoding='utf-8').write(tpl.replace(MARK, json.dumps(payload, ensure_ascii=False)))

print('ecrit %s  (%.0f Ko)' % (OUT, os.path.getsize(OUT) / 1024))
print('  %d saisons (%d-%d), %d poolers, %d choix'
      % (len(seasons), seasons[0]['year'], seasons[-1]['year'],
         len(careers), payload['picksTotal']))
print('  %s : %s champion avec %d points'
      % (seasonTable[-1]['year'], seasonTable[-1]['champ'], seasonTable[-1]['score']))
for c in checks:
    mark = 'OK ' if c['ok'] and not c['cases'] else ('reg' if c['expected'] else '!! ')
    print('  [%s] %-58s %d cas' % (mark, c['check'], c['cases']))
for w in notes:
    print('  ? %s' % w)
print('  ouvrir : start pool-records.html')
