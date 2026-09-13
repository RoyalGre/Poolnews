/* Self-test harness for poolers.html — injected into a throwaway copy and run
   in headless Chrome. Drives the real page code, not a reimplementation.
   Results land in #TESTOUT for --dump-dom to pick up.

   The claim this page makes is arithmetic: "these rondelles ARE your points."
   Most of what follows checks that claim against data/history.js, which
   computes the same totals a completely different way. */
(function () {
  const out = [];
  let fails = 0;

  function ok(cond, msg) {
    if (!cond) fails++;
    out.push((cond ? 'PASS ' : 'FAIL ') + msg);
  }

  window.alert   = m => out.push('      (alert: ' + m + ')');
  window.confirm = () => true;

  const pucks = () => document.querySelectorAll('svg.rink .puck').length;
  const rows  = () => document.querySelectorAll('.pl-roster .pl-row');
  const text  = () => document.getElementById('content').textContent;

  try {
    /* ---- 1. the goal file ---- */
    ok(GOALS_DATA && GOAL_LIST.length > 1000,
       'goal data loaded (' + (GOALS_DATA ? GOAL_LIST.length : 0) + ' goals)');
    ok(Object.keys(GAME_INFO).length > 500,
       'the game table carries dates for ' + Object.keys(GAME_INFO).length + ' games');
    ok(GOAL_LIST.every(g => typeof g.x === 'number' && typeof g.y === 'number'),
       'every goal has coordinates');
    ok(GOAL_LIST.every(g => goalDate(g).length === 10),
       'every goal resolves to a date through its game id');

    /* Coordinates are normalized to attack toward +x. A few long empty-netters
       legitimately come from the defensive half, but not many. */
    const behind = GOAL_LIST.filter(g => g.x < 0).length;
    ok(behind / GOAL_LIST.length < 0.10,
       'coordinates are end-normalized (' +
       (100 * behind / GOAL_LIST.length).toFixed(1) + '% from the far half)');

    /* ---- 2. the player index ---- */
    ok(BY_PLAYER.size > 500, 'the per-player index covers ' + BY_PLAYER.size + ' players');
    const roleTotal = [...BY_PLAYER.values()].reduce((t, a) => t + a.length, 0);
    const expectRoles = GOAL_LIST.reduce((t, g) =>
      t + 1 + (g.a1 ? 1 : 0) + (g.a2 ? 1 : 0), 0);
    ok(roleTotal === expectRoles,
       'every scorer and assist is indexed exactly once (' + roleTotal + ')');

    /* ---- 3. clip URLs rebuild correctly ---- */
    const withClip = GOAL_LIST.find(g => g.c);
    ok(withClip && goalClip(withClip).indexOf('https://') === 0,
       'a highlight link rebuilds from the stored prefix');
    ok(goalClip({ gid: 1 }) === null, 'a goal with no clip returns null rather than a broken link');

    /* ---- 4. the week window ---- */
    ok(WEEK_COUNT > 10, 'weekly history is loaded (' + WEEK_COUNT + ' weeks)');
    const w5 = weekWindow(5);
    ok(w5.start && w5.end && w5.start < w5.end, 'a week window runs start -> end');
    ok(inWindow(w5.end, w5), 'the closing Sunday belongs to its own week');
    ok(!inWindow(w5.start, w5),
       'the previous week’s Sunday does NOT fall in this one — no double counting');
    const w0 = weekWindow(0);
    ok(!w0.start, 'the first week is open at the start, so opening night is included');

    /* ---- 5. the real pool ---- */
    ok(state.poolers.length > 0, 'a pool is loaded (' + state.poolers.length + ' poolers)');

    /* ---- 6. THE claim: the rondelles equal the standings ----
       collect() walks individual goals; expectedPoints() sums the weekly
       cumulative deltas in history.js. They share no code. */
    let checked = 0, mismatch = 0, firstBad = null;
    for (const pl of state.poolers) {
      for (let wi = 0; wi < WEEK_COUNT; wi++) {
        const exp = expectedPoints(pl, wi);
        if (exp === null) continue;
        const ev = collect(pl, weekWindow(wi));
        const got = ev.reduce((t, e) => t + e.roles.length, 0);
        checked++;
        if (got !== exp) {
          mismatch++;
          if (!firstBad) firstBad = pl.name + ' week ' + (wi + 1) +
            ': rink ' + got + ' vs standings ' + exp;
        }
      }
    }
    ok(mismatch === 0,
       'every pooler-week matches the standings (' + checked + ' checked' +
       (firstBad ? '; first gap ' + firstBad : '') + ')');

    /* A goal touched by two of the same roster counts twice — the case that
       makes "points" and "goals" different numbers. */
    let twoPointGoals = 0;
    for (const pl of state.poolers) {
      const ev = collect(pl, { start: null, end: null });
      twoPointGoals += ev.filter(e => e.roles.length > 1).length;
    }
    ok(twoPointGoals > 0,
       'goals worth two points to one roster are counted as two (' + twoPointGoals + ' this season)');

    /* ---- 7. rendering ---- */
    curPooler = state.poolers[0];
    curWeek = -1; curPlayer = null; curDay = null; curRole = 'tous';
    render();
    const seasonEvents = collect(curPooler, { start: null, end: null });
    ok(pucks() === seasonEvents.length,
       'one rondelle per goal touched (' + pucks() + ')');
    ok(rows().length === filledCount(curPooler),
       'the roster panel lists every pick (' + rows().length + ')');
    ok(document.querySelectorAll('svg.rink').length === 1, 'exactly one rink is drawn');

    /* ---- 8. filters actually filter ---- */
    const before = pucks();
    curRole = 'B';
    render();
    const onlyGoals = pucks();
    ok(onlyGoals > 0 && onlyGoals < before,
       'the Buts filter narrows the view (' + onlyGoals + ' of ' + before + ')');

    curRole = 'tous';
    const busiest = [...BY_PLAYER.keys()]
      .filter(pid => curPooler.picks.indexOf(pid) >= 0)
      .sort((a, b) => (BY_PLAYER.get(b) || []).length - (BY_PLAYER.get(a) || []).length)[0];
    if (busiest) {
      curPlayer = busiest;
      render();
      const solo = pucks();
      ok(solo > 0 && solo <= before, 'isolating one player narrows the rink (' + solo + ')');
      const soloEvents = collect(curPooler, { start: null, end: null })
        .filter(e => e.roles.some(r => r.pid === busiest));
      ok(solo === soloEvents.length, 'the isolated count matches that player’s goals');
      curPlayer = null;
    }

    /* ---- 9. a week with the day strip ---- */
    curWeek = Math.min(12, WEEK_COUNT - 1);
    render();
    ok(document.querySelectorAll('.pl-days .pl-day').length === 7,
       'a week shows seven days');
    const dayTotal = [...document.querySelectorAll('.pl-days .pl-day .dn')]
      .reduce((t, e) => t + parseInt(e.textContent, 10), 0);
    const weekPts = expectedPoints(curPooler, curWeek);
    ok(dayTotal === weekPts,
       'the seven days add up to the week’s points (' + dayTotal + ' vs ' + weekPts + ')');

    /* ---- 10. every pooler renders without throwing ---- */
    let rendered = 0;
    for (const pl of state.poolers) {
      curPooler = pl; curPlayer = null; curDay = null;
      render();
      rendered++;
    }
    ok(rendered === state.poolers.length,
       'every pooler renders (' + rendered + ')');

    /* ---- 11. a roster nobody drafted ---- */
    curPooler = state.poolers[0];
    const ghost = { id: 'ghost', name: 'Fantôme', picks: normalizePicks([]) };
    const ghostEvents = collect(ghost, { start: null, end: null });
    ok(ghostEvents.length === 0, 'an empty roster collects no goals instead of throwing');

    /* ---- 12. empty pool ---- */
    state = { version: 2, rosterSize: 12, poolers: [] };
    curPooler = null;
    render();
    ok(/Aucun pooleur/.test(text()),
       'an empty pool shows guidance instead of a blank rink');
    ok(pucks() === 0, 'no rondelles for an empty pool');

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
