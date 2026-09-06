/* Self-test harness for funfacts.html — injected into a throwaway copy and run
   in headless Chrome. Drives the real efficiency code, not a reimplementation.
   Results land in #TESTOUT for --dump-dom to pick up. */
(function () {
  const out = [];
  let fails = 0;

  function ok(cond, msg) {
    if (!cond) fails++;
    out.push((cond ? 'PASS ' : 'FAIL ') + msg);
  }
  function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + ' (got ' + a + ')'); }

  window.alert   = m => out.push('      (alert: ' + m + ')');
  window.confirm = () => true;

  const bars   = () => document.querySelectorAll('svg.chart .bar').length;
  const rows   = () => document.querySelectorAll('table.standings tbody tr');
  const byName = n => PLAYERS.find(p => p.n === n);

  try {
    /* ---- 1. data ---- */
    ok(ADV && ADV.ids.length > 500, 'advanced data loaded (' + (ADV ? ADV.ids.length : 0) + ' players)');
    ok(ADV.gp.length === ADV.ids.length && ADV.toi.length === ADV.ids.length,
       'every parallel array matches the id list');
    ok(adv(-1) === null, 'unknown player id returns null rather than throwing');

    /* ---- 2. the P/60 formula ---- */
    ok(p60(10, 3600) === 10, 'a point every 6 minutes is 10 P/60');
    ok(p60(1, 1800) === 2, 'one point in 30 minutes is 2 P/60');
    ok(p60(5, 0) === 0, 'zero ice time scores 0 instead of dividing by zero');
    ok(mins(3661) === 61, 'seconds convert to whole minutes');

    /* ---- 3. real numbers, checked against the old C++ report ---- */
    const kuch = adv(byName('Nikita Kucherov').i);
    ok(kuch && kuch.pts === 130, 'Kucherov: 130 points on the season, got ' + (kuch ? kuch.pts : '?'));
    near(mins(kuch.toi), 1545, 1, 'Kucherov: 1545 minutes of ice time');
    near(p60(kuch.pts, kuch.toi), 5.05, 0.01, 'Kucherov: 5.05 P/60 — matches the old report');

    const seider = adv(byName('Moritz Seider').i);
    near(p60(seider.pts, seider.toi), 1.71, 0.01, 'Seider: 1.71 P/60 — heavy minutes, fewer points');

    ok(kuch.gp > 0 && kuch.toi / kuch.gp > 600 && kuch.toi / kuch.gp < 1800,
       'ice time per game is in a sane range (' + Math.round(kuch.toi / kuch.gp / 60) + ' min)');
    ok(kuch.hPts + kuch.rPts === kuch.pts, 'home and road points add up to the season total');
    ok(kuch.hToi + kuch.rToi === kuch.toi, 'home and road ice time adds up to the season total');
    ok(kuch.streak >= 1 && kuch.streak <= kuch.gp, 'point streak is within the games played');
    ok(kuch.drought >= 0 && kuch.drought <= kuch.gp, 'drought is within the games played');
    ok(kuch.bestPts >= 1 && kuch.bestDate.length === 10, 'best game recorded with a date');

    /* ---- 4. a pool to render ---- */
    const fwd = PLAYERS.filter(p => (p.p === 'C' || p.p === 'L' || p.p === 'R') && adv(p.i) && adv(p.i).toi > 0)
                       .sort((a, b) => b._pts - a._pts).slice(0, 40);
    const def = PLAYERS.filter(p => p.p === 'D' && adv(p.i) && adv(p.i).toi > 0)
                       .sort((a, b) => b._pts - a._pts).slice(0, 6);
    ok(fwd.length >= 40 && def.length >= 6, 'enough real players with ice time to build fixtures');

    const roster = (fs, d) => normalizePicks(fs.map(p => p.i).concat([d.i]));
    state = {
      version: 2, rosterSize: 12,
      poolers: [
        { id: 'a', name: 'Alpha', picks: roster(fwd.slice(0, 11), def[0]) },
        { id: 'b', name: 'Bravo', picks: roster(fwd.slice(11, 22), def[1]) },
        { id: 'c', name: 'Chuck', picks: roster(fwd.slice(22, 33), def[2]) }
      ]
    };
    hidden.clear(); showAll = false; sortKey = 'p60'; sortDir = -1;
    render();

    ok(PLAYER_ROWS.length === 30, 'counting 10 per pooler makes 30 player rows, got ' + PLAYER_ROWS.length);
    ok(POOLER_ROWS.length === 3, 'one summary row per pooler');
    ok(document.querySelectorAll('.cards .card').length === 4, 'four summary cards');
    ok(document.querySelectorAll('svg.chart').length === 3, 'three charts drawn');
    ok(rows().length === 3, 'the table has a row per pooler');
    ok(document.querySelectorAll('.legend .item').length === 3, 'legend has an entry per pooler');
    ok(document.querySelectorAll('.facts .fact').length >= 6, 'odds-and-ends facts rendered');

    /* ---- 5. the leaderboard is ordered by rate, not by points ---- */
    const vals = PLAYER_ROWS.map(r => r.p60);
    ok(vals.every((v, i) => i === 0 || vals[i - 1] >= v), 'players are ordered by P/60 descending');
    const topByPts = PLAYER_ROWS.slice().sort((a, b) => b.pts - a.pts)[0];
    ok(PLAYER_ROWS[0].p60 >= p60(topByPts.pts, topByPts.toi) - 0.0001,
       'the most efficient player leads, whoever has the most points');

    /* ---- 6. pooler rate is roster points over roster minutes ---- */
    const A = POOLER_ROWS.find(r => r.pl.id === 'a');
    const sumPts = A.rows.reduce((t, r) => t + r.pts, 0);
    const sumToi = A.rows.reduce((t, r) => t + r.toi, 0);
    near(A.p60, sumPts * 3600 / sumToi, 0.0001, 'pooler P/60 is combined points over combined ice time');
    ok(A.toi === sumToi, 'pooler minutes are the sum of the counting 10');
    ok(A.scorePts === scoreRoster(state.poolers[0].picks, statsSeason()).pts,
       'the points column matches what the standings page scores');

    /* ---- 7. the leaderboard cap ---- */
    ok(bars() > 0, 'bars drawn');
    const capped = document.querySelectorAll('svg.chart')[0].querySelectorAll('.bar').length;
    ok(capped === 25, 'the player chart shows the top 25 by default, got ' + capped);
    showAll = true; render();
    ok(document.querySelectorAll('svg.chart')[0].querySelectorAll('.bar').length === 30,
       '"show all" reveals every counting player');
    showAll = false; render();

    /* ---- 8. legend filtering ---- */
    const before = document.querySelectorAll('svg.chart')[1].querySelectorAll('.bar').length;
    document.querySelectorAll('.legend .item')[0].click();
    ok(document.querySelectorAll('svg.chart')[1].querySelectorAll('.bar').length === before - 1,
       'hiding a pooler removes its bar from the pooler chart');
    ok(rows().length === 3, 'the table still lists every pooler when one is hidden from the charts');
    document.querySelectorAll('.legend .item')[0].click();
    ok(document.querySelectorAll('svg.chart')[1].querySelectorAll('.bar').length === before,
       'showing it again restores the bar');

    /* ---- 9. sorting ---- */
    sortKey = 'name'; sortDir = 1; render();
    ok(rows()[0].textContent.indexOf('Alpha') > -1, 'sorting by name puts Alpha first');
    sortKey = 'pim'; sortDir = -1; render();
    const pims = Array.from(rows()).map(tr => parseInt(tr.children[7].textContent, 10));
    ok(pims.every((v, i) => i === 0 || pims[i - 1] >= v), 'sorting by PIM is descending: ' + pims.join(', '));
    sortKey = 'p60'; sortDir = -1; render();

    /* ---- 10. players who never dressed are skipped, not counted as zero ---- */
    const ghost = PLAYERS.find(p => !adv(p.i));
    if (ghost) {
      // Exactly 10 picks, one of whom never dressed: with no 11th man to push
      // him out, he lands in the counting 10 and the page has to cope.
      state.poolers.push({ id: 'd', name: 'Delta',
        picks: normalizePicks(fwd.slice(0, 8).map(p => p.i).concat([def[3].i, ghost.i])) });
      render();
      const D = POOLER_ROWS.find(r => r.pl.id === 'd');
      ok(D.rows.every(r => r.toi > 0), 'a player with no ice time is left out of the rate');
      ok(D.missing >= 1, 'the missing player is counted, not silently ignored');
      ok(D.p60 > 0 && isFinite(D.p60), 'the pooler still gets a finite P/60 (' + fmt(D.p60) + ')');
      state.poolers.pop();
      render();
    } else {
      out.push('      (no player without ice time in the data — skipped that check)');
    }

    /* ---- 11. empty pool ---- */
    state = { version: 2, rosterSize: 12, poolers: [] };
    render();
    ok(/No poolers yet/.test(document.getElementById('content').textContent),
       'an empty pool shows guidance instead of empty charts');
    ok(document.querySelectorAll('svg.chart').length === 0, 'no charts for an empty pool');

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
