/* Self-test harness for standings.html — injected into a throwaway copy and
   run in headless Chrome. Drives the real scoring and rendering code, not a
   reimplementation. Results land in #TESTOUT for --dump-dom to pick up. */
(function () {
  const out = [];
  let fails = 0;

  function ok(cond, msg) {
    if (!cond) fails++;
    out.push((cond ? 'PASS ' : 'FAIL ') + msg);
  }

  window.alert   = m => out.push('      (alert: ' + m + ')');
  window.confirm = () => true;

  const rows   = () => document.querySelectorAll('table.standings tbody tr:not(.detail)');
  const cell   = (tr, i) => tr.children[i].textContent.trim();
  // Per chart, not overall: the points chart and the bump chart each draw one
  // line per pooler, so a total would double-count.
  const lines  = () => document.querySelectorAll('svg.chart')[0].querySelectorAll('.line').length;

  /* Twelve real players with known positions, so scoreRoster resolves a
     position for each, while the points come from a stub. That keeps these
     assertions independent of whatever the NHL data file currently says. */
  const fwd = PLAYERS.filter(p => p.p === 'C' || p.p === 'L' || p.p === 'R').slice(0, 14);
  const def = PLAYERS.filter(p => p.p === 'D').slice(0, 4);
  const stub = map => id => map[id] || { g: 0, a: 0 };

  try {
    /* ---- 1. data files loaded ---- */
    ok(PLAYERS.length > 1000, 'player data loaded (' + PLAYERS.length + ')');
    ok(WEEK_COUNT > 10, 'weekly history loaded (' + WEEK_COUNT + ' weeks)');
    ok(HISTORY && HISTORY.ids.length > 500, 'history covers ' + (HISTORY ? HISTORY.ids.length : 0) + ' players');
    ok(fwd.length >= 14 && def.length >= 4, 'enough real forwards/defensemen to build fixtures');

    /* ---- 2. history is cumulative ---- */
    const sampleId = HISTORY.ids[0];
    let mono = true, prev = -1;
    for (let w = 0; w < WEEK_COUNT; w++) {
      const s = statsAtWeek(w)(sampleId);
      const p = s.g + s.a;
      if (p < prev) mono = false;
      prev = p;
    }
    ok(mono, 'season-to-date points never go down across weeks');
    ok(statsAtWeek(0)(sampleId).g + statsAtWeek(0)(sampleId).a <=
       statsAtWeek(WEEK_COUNT - 1)(sampleId).g + statsAtWeek(WEEK_COUNT - 1)(sampleId).a,
       'week 1 total <= final total');
    ok(statsAtWeek(5)(-1).g === 0, 'unknown id at a given week scores 0 rather than throwing');

    /* ---- 3. scoring: best 10 of 12 ---- */
    // Eleven forwards and one real defenceman, worth 100..89. The D sits
    // 5th, so the natural top 10 is already legal and no swap is needed.
    let ids = fwd.slice(0, 11).map(p => p.i);
    ids.splice(4, 0, def[0].i);
    let map = {};
    ids.forEach((id, i) => { map[id] = { g: 100 - i, a: 0 }; });
    let sc = scoreRoster(ids, stub(map));
    ok(sc.rows.length === 12, 'all 12 picks scored');
    ok(sc.counting.length === 10, 'exactly 10 count');
    ok(sc.pts === 955, 'counting total is the best 10 (100..91 = 955), got ' + sc.pts);
    ok(sc.total12 === 1134, 'all-12 total kept separately, got ' + sc.total12);
    ok(sc.bench.length === 2 && sc.bench[0].pts === 90, 'the two weakest are benched');
    ok(!sc.shortHanded, 'a roster with a defenceman is not short-handed');

    /* ---- 3b. no defenceman at all: only the 9 best count ----
       The written rule: "Si un participant n'a pas de defenseur dans son
       alignement, il devra se contenter du total de ses 9 meilleurs
       pointeurs." Twelve forwards, 100..89: 100..92 = 864, not 955. */
    let allFwd = fwd.slice(0, 12).map(p => p.i);
    let fmap = {};
    allFwd.forEach((id, i) => { fmap[id] = { g: 100 - i, a: 0 }; });
    let fsc = scoreRoster(allFwd, stub(fmap));
    ok(fsc.shortHanded, 'a roster with no defenceman is flagged short-handed');
    ok(fsc.counting.length === 9, 'only 9 count without a defenceman, got ' + fsc.counting.length);
    ok(fsc.pts === 864, 'the 10th slot is forfeited (100..92 = 864), got ' + fsc.pts);
    ok(!fsc.legal, 'and the roster is still flagged illegal');

    /* ---- 3c. tiebreak on the 11th then the 12th pick ---- */
    // Same ten counting players, different 11th and 12th: equal totals, but
    // the rule says the better 11th pick takes the higher rank.
    let aIds = fwd.slice(0, 11).map(p => p.i); aIds.splice(4, 0, def[0].i);
    let bIds = fwd.slice(0, 11).map(p => p.i); bIds.splice(4, 0, def[1].i);
    let amap = {}, bmap = {};
    aIds.forEach((id, i) => { amap[id] = { g: 100 - i, a: 0 }; });
    bIds.forEach((id, i) => { bmap[id] = { g: 100 - i, a: 0 }; });
    amap[aIds[10]] = { g: 90, a: 0 }; amap[aIds[11]] = { g: 89, a: 0 };
    bmap[bIds[10]] = { g: 80, a: 0 }; bmap[bIds[11]] = { g: 79, a: 0 };
    let aSc = scoreRoster(aIds, stub(amap)), bSc = scoreRoster(bIds, stub(bmap));
    ok(aSc.pts === bSc.pts, 'both rosters total the same, got ' + aSc.pts + ' and ' + bSc.pts);
    ok(aSc.p11 === 90 && bSc.p11 === 80, 'the 11th picks differ (' + aSc.p11 + ' vs ' + bSc.p11 + ')');
    ok(aSc.p11 > bSc.p11, 'the better 11th pick wins the tiebreak');

    /* ---- 4. the defenseman rule ---- */
    // Top 10 are all forwards; the only D is 12th. He must be promoted, and
    // the 10th-best forward is the one dropped — the cheapest legal swap.
    ids = fwd.slice(0, 11).map(p => p.i).concat([def[0].i]);
    map = {};
    ids.forEach((id, i) => { map[id] = { g: 100 - i, a: 0 }; });   // D is worth 89
    sc = scoreRoster(ids, stub(map));
    ok(sc.counting.some(r => r.pos === 'D'), 'a defenseman is forced into the counting 10');
    ok(sc.forcedD && sc.forcedD.in.id === def[0].i, 'the promoted player is the D');
    ok(sc.forcedD && sc.forcedD.out.pts === 91, 'the 10th-best forward (91) is the one dropped, got ' +
       (sc.forcedD ? sc.forcedD.out.pts : '?'));
    ok(sc.forcedD && sc.forcedD.cost === 2, 'the swap costs 91 - 89 = 2 pts, got ' +
       (sc.forcedD ? sc.forcedD.cost : '?'));
    ok(sc.pts === 953, 'total reflects the forced swap (955 - 2), got ' + sc.pts);
    ok(sc.legal, 'roster with one D is legal');

    // The BEST bench D is promoted, not just the first one found.
    ids = fwd.slice(0, 10).map(p => p.i).concat([def[0].i, def[1].i]);
    map = {};
    fwd.slice(0, 10).forEach((p, i) => { map[p.i] = { g: 100 - i, a: 0 }; });
    map[def[0].i] = { g: 20, a: 0 };
    map[def[1].i] = { g: 60, a: 0 };
    sc = scoreRoster(ids, stub(map));
    ok(sc.forcedD && sc.forcedD.in.id === def[1].i, 'the higher-scoring bench D (60) is promoted, not the 20');

    /* ---- 5. no swap when a D already counts ---- */
    ids = fwd.slice(0, 11).map(p => p.i).concat([def[0].i]);
    map = {};
    ids.forEach((id, i) => { map[id] = { g: 10, a: 0 }; });
    map[def[0].i] = { g: 500, a: 0 };            // best player on the roster
    sc = scoreRoster(ids, stub(map));
    ok(!sc.forcedD, 'no forced swap when the top 10 already contains a D');
    ok(sc.legal && sc.counting.some(r => r.id === def[0].i), 'the D counts on merit');

    /* ---- 6. rosters that cannot be scored ---- */
    ids = fwd.slice(0, 12).map(p => p.i);
    map = {}; ids.forEach(id => { map[id] = { g: 5, a: 0 }; });
    sc = scoreRoster(ids, stub(map));
    ok(!sc.legal, 'a roster with no defenseman at all is flagged illegal');
    ok(!sc.forcedD, 'nothing to promote when there is no D anywhere');

    /* ---- 7. partial rosters ---- */
    ids = fwd.slice(0, 4).map(p => p.i);
    map = {}; ids.forEach((id, i) => { map[id] = { g: 10 - i, a: 1 }; });
    sc = scoreRoster(ids, stub(map));
    ok(sc.rows.length === 4 && sc.counting.length === 4, 'fewer than 10 picks: everyone counts');
    ok(!sc.complete, 'partial roster reported as incomplete');
    ok(sc.pts === (10 + 9 + 8 + 7) + 4, 'goals and assists both count, got ' + sc.pts);
    ok(scoreRoster([], stub({})).pts === 0, 'an empty roster scores 0 rather than throwing');
    ok(scoreRoster([null, null], stub({})).rows.length === 0, 'empty slots are skipped');

    /* ---- 8. build a real pool and render it ---- */
    const pick = (fs, ds) => fs.map(p => p.i).concat(ds.map(p => p.i));
    state = {
      version: 2, rosterSize: 12,
      poolers: [
        { id: 'a', name: 'Alpha', picks: normalizePicks(pick(fwd.slice(0, 11), def.slice(0, 1))) },
        { id: 'b', name: 'Bravo', picks: normalizePicks(pick(fwd.slice(0, 11), def.slice(1, 2))) },
        { id: 'c', name: 'Chuck', picks: normalizePicks(pick(fwd.slice(2, 13), def.slice(2, 3))) }
      ]
    };
    weekIdx = WEEK_COUNT - 1;
    render();

    ok(rows().length === 3, 'one table row per pooler, got ' + rows().length);
    ok(document.querySelectorAll('.cards .card').length >= 3, 'summary cards rendered');
    ok(document.querySelectorAll('.legend .item').length === 3, 'legend has an entry per pooler');
    ok(document.querySelectorAll('svg.chart').length === 3, 'three charts drawn');

    /* ---- 9. the table is sorted by points, best first ---- */
    let pts = Array.from(rows()).map(tr => parseInt(cell(tr, 2), 10));
    ok(pts.every((v, i) => i === 0 || pts[i - 1] >= v), 'rows are in descending points order: ' + pts.join(', '));
    ok(cell(rows()[0], 0).indexOf('1') === 0, 'first row is rank 1');

    // Rank must follow points, not table position, when sorting changes.
    sortKey = 'name'; sortDir = 1; render();
    const names = Array.from(rows()).map(tr => cell(tr, 1).split('\n')[0]);
    ok(names[0].indexOf('Alpha') === 0, 'sorting by name puts Alpha first, got ' + names[0]);
    const alphaRank = cell(rows()[0], 0);
    sortKey = 'pts'; sortDir = -1; render();
    const alphaRow = Array.from(rows()).find(tr => cell(tr, 1).indexOf('Alpha') === 0);
    ok(cell(alphaRow, 0) === alphaRank, 'a pooler keeps the same rank when the table is re-sorted');

    /* ---- 10. clicking a row expands that roster ---- */
    rows()[0].click();
    ok(document.querySelectorAll('tr.detail').length === 1, 'clicking a row opens exactly one detail panel');
    ok(document.querySelectorAll('tr.detail .rline').length === 12, 'the detail lists all 12 players');
    ok(document.querySelectorAll('tr.detail .rline.counts').length === 10, '10 of them are marked as counting');
    ok(document.querySelectorAll('tr.detail .rline.benched').length === 2, '2 are marked as benched');
    rows()[0].click();
    ok(document.querySelectorAll('tr.detail').length === 0, 'clicking again collapses it');

    /* ---- 11. the week selector ---- */
    const lineCount = lines();
    const finalPts  = parseInt(cell(rows()[0], 2), 10);
    weekIdx = 0; render();
    const week1Pts = parseInt(cell(rows()[0], 2), 10);
    ok(week1Pts < finalPts, 'week 1 totals are lower than the final ones (' + week1Pts + ' < ' + finalPts + ')');
    ok(document.getElementById('toolbar').textContent.indexOf(WEEKS[0].d) > -1,
       'the toolbar names the selected week');
    weekIdx = WEEK_COUNT - 1; render();
    ok(parseInt(cell(rows()[0], 2), 10) === finalPts, 'returning to the last week restores the totals');
    ok(lines() === lineCount, 'chart line count is stable across week changes');

    /* ---- 12. a pooler's total never goes down over the season ---- */
    let series = [];
    for (let w = 0; w < WEEK_COUNT; w++) series.push(scoreAt(state.poolers[0], w).pts);
    ok(series.every((v, i) => i === 0 || series[i - 1] <= v),
       'cumulative pooler totals are monotonic (' + series[0] + ' -> ' + series[series.length - 1] + ')');

    /* ---- 13. ranks ---- */
    const ranked = state.poolers.map(pl => ({ n: pl.name, r: rankAt(pl, WEEK_COUNT - 1), p: scoreAt(pl, WEEK_COUNT - 1).pts }))
                                .sort((x, y) => x.r - y.r);
    ok(ranked[0].p >= ranked[ranked.length - 1].p, 'rank 1 has at least as many points as the last rank');
    ok(new Set(state.poolers.map(pl => rankAt(pl, 0))).size >= 1, 'ranks exist for week 1 too');

    // Two identical rosters would tie; competition ranking must share the rank.
    state.poolers[1].picks = state.poolers[0].picks.slice();
    computeSeries();
    ok(rankAt(state.poolers[0], WEEK_COUNT - 1) === rankAt(state.poolers[1], WEEK_COUNT - 1),
       'tied poolers share a rank');

    /* ---- 14. legend hides a line ---- */
    state.poolers[1].picks = normalizePicks(pick(fwd.slice(0, 11), def.slice(1, 2)));
    hidden.clear(); render();
    const before = lines();
    const beforeAll = document.querySelectorAll('svg.chart .line').length;
    document.querySelectorAll('.legend .item')[0].click();
    ok(lines() === before - 1, 'hiding a pooler drops its line from the points chart, ' + before + ' -> ' + lines());
    ok(document.querySelectorAll('svg.chart .line').length === beforeAll - 2,
       'it disappears from the bump chart too');
    document.querySelectorAll('.legend .item')[0].click();
    ok(lines() === before, 'showing it again puts the line back');

    document.querySelectorAll('.legend .item')[1].dispatchEvent(new MouseEvent('dblclick'));
    ok(lines() === 1, 'double-clicking a legend entry isolates that pooler');
    const iso = Array.from(document.querySelectorAll('.legend .item'))
                     .find(i => !i.classList.contains('off'));
    iso.dispatchEvent(new MouseEvent('dblclick'));
    ok(lines() === before, 'double-clicking the isolated one brings everybody back');

    /* ---- 15. empty pool ---- */
    state = { version: 2, rosterSize: 12, poolers: [] };
    render();
    ok(/Aucun pooler/.test(document.getElementById('content').textContent),
       'an empty pool shows guidance instead of an empty table');
    ok(document.querySelectorAll('svg.chart').length === 0, 'no charts drawn for an empty pool');

    /* ---- 16. le livre des records reste joignable ----
       Il a quitte la barre d'onglets parce qu'il ne depend d'aucune saison ;
       core.js pose l'icone a droite. Si ce lien disparait, la page devient
       inaccessible depuis les onglets et personne ne s'en apercoit : le scan
       du HTML statique ne peut pas le voir. */
    const recs = document.getElementById('recordsLink');
    ok(!!recs, 'le livre des records a son icone dans la barre');
    ok(recs && recs.tagName === 'A' && /pool-records\.html$/.test(recs.getAttribute('href') || ''),
       'et elle pointe vers pool-records.html');
    ok(recs && !document.querySelector('nav.tabs a[href="pool-records.html"]'),
       "et il ne reste pas d'onglet en double");

  } catch (e) {
    fails++;
    out.push('FAIL threw: ' + (e && e.stack ? e.stack : e));
  }

  out.push('---');
  out.push(fails === 0 ? 'ALL TESTS PASSED (' + (out.length - 1) + ' lines)' : fails + ' FAILURE(S)');

  const div = document.createElement('div');
  div.id = 'TESTOUT';
  div.textContent = '\n' + out.join('\n') + '\n';
  document.body.appendChild(div);
})();
