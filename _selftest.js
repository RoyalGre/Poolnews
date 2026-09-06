/* Self-test harness — injected into a throwaway copy of pool.html and run in
   headless Chrome. Drives the REAL app code (search/render/commit paths), not
   a reimplementation. Results land in #TESTOUT for --dump-dom to pick up. */
(function () {
  const out = [];
  let fails = 0;

  function ok(cond, msg) {
    if (!cond) fails++;
    out.push((cond ? 'PASS ' : 'FAIL ') + msg);
  }

  window.alert   = m => out.push('      (alert: ' + m + ')');
  window.confirm = () => true;

  const filled = pl => pl.picks.filter(x => x !== null).length;
  const box    = () => document.querySelector('.searchwrap input');
  const type   = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); };
  const key    = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const slots  = () => document.querySelectorAll('#rosterPanel .slot');

  try {
    /* ---- 0. start from a clean slate ----
       The site now ships a published pool (data/pool.js), so a browser with
       nothing saved opens with everyone's picks already in place. These tests
       want an empty pool; section 15 covers the published-pool behaviour. */
    state = blankState();
    selectedPoolerId = null;
    editingSlot = null;
    save();
    render();

    /* ---- 1. data ---- */
    ok(PLAYERS.length > 1000, 'player data loaded (' + PLAYERS.length + ')');
    ok(BY_ID.get(8478402) && BY_ID.get(8478402).n === 'Connor McDavid', 'lookup by id works');
    ok(document.getElementById('dataStamp').textContent.indexOf('NHL players') > -1,
       'header stamp rendered: "' + document.getElementById('dataStamp').textContent + '"');

    /* ---- 2. search tiers ---- */
    let r = search('mcdav');
    ok(r.length && r[0].n === 'Connor McDavid', 'partial "mcdav" -> ' + (r[0] || {}).n);
    r = search('makar');
    ok(r.length && r[0].n === 'Cale Makar', 'lastname "makar" -> ' + (r[0] || {}).n);
    r = search('bedard');
    ok(r.length && r[0].n === 'Connor Bedard', 'lastname "bedard" -> ' + (r[0] || {}).n);

    // Tier order is deliberate: a LAST-name match outranks a first-name match.
    r = search('connor');
    ok(r.length && r[0].n === 'Kyle Connor',
       'lastname beats firstname: "connor" -> ' + (r[0] || {}).n + ' (' + r.length + ' hits)');
    ok(r.some(p => p.n === 'Connor McDavid'), 'first-name matches still listed for "connor"');

    r = search('fransen');
    ok(r.some(p => p.n === 'Noel Fransén'), 'accent-insensitive "fransen" finds Fransén');
    r = search('valimaki');
    ok(r.some(p => p.n.indexOf('Välimäki') > -1), 'accent-insensitive "valimaki"');
    ok(search('a').length === 0, 'single char returns nothing (min 2)');
    r = search('mac');
    ok(r.findIndex(p => p.n === 'Nathan MacKinnon') > -1, 'MacKinnon findable via "mac"');

    /* ---- 3. poolers ---- */
    document.getElementById('newPoolerName').value = 'Yanick';
    document.getElementById('btnAddPooler').click();
    document.getElementById('newPoolerName').value = 'Marc';
    document.getElementById('btnAddPooler').click();
    ok(state.poolers.length === 2, 'two poolers added via button');
    // Regression guard: created in the same millisecond.
    ok(state.poolers[0].id !== state.poolers[1].id,
       'poolers created in the same ms get distinct ids');
    ok(state.poolers.find(p => p.id === state.poolers[1].id).name === 'Marc',
       'lookup by id resolves to the right pooler');

    document.getElementById('newPoolerName').value = 'yanick';
    document.getElementById('btnAddPooler').click();
    ok(state.poolers.length === 2, 'duplicate name (case-insensitive) rejected');

    const YAN = state.poolers[0], MARC = state.poolers[1];

    /* ---- 4. fixed-length slot model ---- */
    ok(YAN.picks.length === 12 && YAN.picks.every(x => x === null),
       'new pooler starts with 12 empty slots');
    ok(slots().length === 12, '12 slot rows always rendered');

    /* ---- 5. draft via keyboard ---- */
    selectedPoolerId = YAN.id; editingSlot = null; render();
    let inp = box();
    ok(!!inp, 'top search box present for a non-full roster');
    type(inp, 'mcdavid'); key(inp, 'Enter');
    ok(YAN.picks[0] === 8478402, 'Enter fills slot 1 with McDavid');
    ok(filled(YAN) === 1, 'exactly one slot filled');

    /* ---- 6. exclusivity ---- */
    selectedPoolerId = MARC.id; editingSlot = null; render();
    inp = box();
    type(inp, 'mcdavid'); key(inp, 'Enter');
    ok(filled(MARC) === 0, 'already-owned player cannot be drafted twice');
    const takenRow = document.querySelector('.res.taken');
    ok(!!takenRow && takenRow.textContent.indexOf('Yanick') > -1,
       'owned player shown greyed with owner name');

    /* ---- 7. keyboard selection must survive a hovering mouse ----
       Repro of the reported "arrowed to Nick Suzuki but Enter didn't take it"
       bug: the list opens under the pointer, so every redraw re-fired
       mouseenter on the row under the motionless cursor. */
    MARC.picks = emptyPicks(); render();
    inp = box();
    type(inp, 'nic');

    const nicHits  = search('nic');
    const suzukiAt = nicHits.findIndex(p => p.n === 'Nick Suzuki');
    ok(suzukiAt > 0, 'Nick Suzuki is in the "nic" results at index ' + suzukiAt);

    let rows = document.querySelectorAll('.res');
    ok(rows.length === nicHits.length, 'every match got a row (' + rows.length + ')');

    rows[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 170 }));
    for (let k = 0; k < suzukiAt; k++) key(inp, 'ArrowDown');

    // A real browser re-fires mouse events at UNCHANGED coordinates on the row
    // under the motionless pointer whenever the list changes.
    rows = document.querySelectorAll('.res');
    rows[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 170 }));
    rows[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    let hl = document.querySelector('.res.sel .nm');
    ok(hl && hl.textContent === 'Nick Suzuki',
       'keyboard selection survives mouse events at an unchanged position (got ' +
       (hl ? hl.textContent : 'none') + ')');

    key(inp, 'Enter');
    ok(MARC.picks[0] === 8480018,
       'Enter drafts the arrowed-to player, not the hovered one (got ' + MARC.picks[0] + ')');

    /* ---- 8. genuine mouse movement still selects ---- */
    MARC.picks = emptyPicks(); render();
    inp = box(); type(inp, 'nic');
    rows = document.querySelectorAll('.res');
    rows[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 480, clientY: 250 }));
    hl = document.querySelector('.res.sel .nm');
    ok(hl && hl.textContent === rows[2].querySelector('.nm').textContent,
       'real pointer movement still moves the selection');
    rows[2].click();
    ok(filled(MARC) === 1, 'clicking a row drafts that player');

    /* ---- 9. scroll-into-view ---- */
    MARC.picks = emptyPicks(); render();
    inp = box(); type(inp, 'nic');
    for (let k = 0; k < 12; k++) key(inp, 'ArrowDown');
    const selRow = document.querySelector('.res.sel');
    const listEl = document.querySelector('.results');
    ok(!!selRow, 'selection still exists after 12 ArrowDowns');
    if (selRow && listEl) {
      const rTop = selRow.offsetTop, rBot = rTop + selRow.offsetHeight;
      const vTop = listEl.scrollTop, vBot = vTop + listEl.clientHeight;
      ok(rTop >= vTop - 1 && rBot <= vBot + 1, 'selected row scrolled into view');
    }
    MARC.picks = emptyPicks();

    /* =====================================================================
       10. SLOT EDITING — the "x should let me enter a new name" behaviour
       ===================================================================== */
    const trio = PLAYERS.filter(p => p.p !== 'D' && p.p !== 'G').slice(0, 3).map(p => p.i);
    YAN.picks = normalizePicks(trio);
    selectedPoolerId = YAN.id; editingSlot = null; render();
    ok(filled(YAN) === 3, 'seeded 3 picks for slot-edit tests');

    /* 10a. x must NOT delete and must NOT reorder */
    const before = YAN.picks.slice();
    let xBtn = slots()[1].querySelector('.editbtn');
    ok(!!xBtn, 'slot 2 has an edit (pencil) button');
    xBtn.click();
    ok(JSON.stringify(YAN.picks) === JSON.stringify(before),
       'pressing x changes nothing on its own (no delete, no reorder)');
    ok(editingSlot === 1, 'pressing x opens the editor on that slot');
    ok(!!slots()[1].querySelector('input'), 'slot 2 now hosts an inline search box');
    ok(document.querySelectorAll('.searchwrap').length === 1,
       'top search box hides while a slot is being edited');

    /* 10b. replacing writes to the SAME slot, neighbours untouched */
    const replacement = PLAYERS.filter(p => p.p !== 'D' && p.p !== 'G' && trio.indexOf(p.i) === -1)[0];
    inp = slots()[1].querySelector('input');
    type(inp, replacement.n.split(' ').pop().toLowerCase());
    let hitIdx = search(replacement.n.split(' ').pop().toLowerCase())
                   .findIndex(p => p.i === replacement.i);
    for (let k = 0; k < hitIdx; k++) key(inp, 'ArrowDown');
    key(inp, 'Enter');

    ok(YAN.picks[1] === replacement.i, 'replacement landed in slot 2');
    ok(YAN.picks[0] === before[0], 'slot 1 untouched by the replacement');
    ok(YAN.picks[2] === before[2], 'slot 3 untouched by the replacement');
    ok(filled(YAN) === 3, 'still 3 picks after replacing');
    ok(editingSlot === null, 'editor closes after choosing');
    ok(!ownerMap().has(before[1]), 'the replaced player is released back to the pool');

    /* 10c. Escape cancels an edit and keeps the original */
    const keep = YAN.picks.slice();
    slots()[0].querySelector('.editbtn').click();
    inp = slots()[0].querySelector('input');
    type(inp, 'mac');
    key(inp, 'Escape');   // first Escape clears the typed text
    key(inp, 'Escape');   // second backs out of the edit
    ok(editingSlot === null, 'second Escape closes the editor');
    ok(JSON.stringify(YAN.picks) === JSON.stringify(keep), 'Escape keeps the original pick');

    /* 10d. "Keep" button also cancels */
    slots()[0].querySelector('.editbtn').click();
    const keepBtn = slots()[0].querySelector('.slotbtn');
    ok(keepBtn && keepBtn.textContent === 'Keep', 'editor offers a Keep button');
    keepBtn.click();
    ok(editingSlot === null && JSON.stringify(YAN.picks) === JSON.stringify(keep),
       'Keep cancels without changing anything');

    /* 10e. "Empty" clears only that slot, no reorder */
    slots()[1].querySelector('.editbtn').click();
    const emptyBtn = slots()[1].querySelector('.slotbtn.danger');
    ok(!!emptyBtn && emptyBtn.textContent === 'Empty', 'editor offers an Empty button');
    emptyBtn.click();
    ok(YAN.picks[1] === null, 'Empty clears slot 2');
    ok(YAN.picks[0] === keep[0], 'Empty leaves slot 1 in place');
    ok(YAN.picks[2] === keep[2], 'Empty does NOT shift slot 3 up');
    ok(filled(YAN) === 2, 'two picks remain');

    /* 10f. an empty slot in the middle is clickable and is what the top box fills */
    render();
    ok(slots()[1].classList.contains('empty'), 'slot 2 renders as empty');
    inp = box();
    ok(!!inp, 'top search box returns once no slot is being edited');
    const makar = search('makar')[0];
    type(inp, 'makar'); key(inp, 'Enter');
    ok(YAN.picks[1] === makar.i,
       'top box fills the middle hole (slot 2), not the end');
    ok(YAN.picks[2] === keep[2], 'filling the hole left slot 3 alone');
    ok(YAN.picks.slice(3).every(x => x === null), 'no pick leaked into a later slot');

    /* 10g. clicking an empty slot opens the editor there */
    editingSlot = null; render();
    slots()[5].click();
    ok(editingSlot === 5, 'clicking an empty slot opens its editor');
    ok(!!slots()[5].querySelector('input'), 'empty slot editor has a search box');
    editingSlot = null; render();

    /* ---- 11. warnings ---- */
    const forwards = PLAYERS.filter(p => p.p !== 'D' && p.p !== 'G').slice(0, 12).map(p => p.i);
    YAN.picks = normalizePicks(forwards);
    render();
    let banner = document.querySelector('#rosterPanel .banner');
    ok(!!banner && /No defenseman/i.test(banner.textContent),
       'full roster with zero D raises the warning');

    YAN.picks = normalizePicks(forwards.slice(0, 11));
    render();
    banner = document.querySelector('#rosterPanel .banner');
    ok(!!banner && /last pick must be a D/i.test(banner.textContent),
       '11 picks + no D warns that the last pick must be a D');

    const someD = PLAYERS.find(p => p.p === 'D');
    YAN.picks = normalizePicks(forwards.slice(0, 11).concat([someD.i]));
    render();
    banner = document.querySelector('#rosterPanel .banner');
    ok(!!banner && /Roster complete/i.test(banner.textContent),
       'complete roster with a D shows the OK banner');
    ok(!document.querySelector('.searchwrap'), 'top search box hidden once roster is full');
    ok(document.querySelectorAll('#rosterPanel .slot.empty').length === 0,
       'no empty slots when full');

    /* ---- 12. persistence ---- */
    save();
    const reloaded = JSON.parse(localStorage.getItem('hockeyPool.v1') || 'null');
    ok(reloaded && JSON.stringify(reloaded) === JSON.stringify(state),
       'state persisted to localStorage');
    ok(reloaded.poolers[0].picks.length === 12, 'nulls survive the JSON round-trip');

    /* ---- 13. migration from the old dense format ---- */
    const legacy = migrate({ poolers: [{ id: 'x', name: 'Old', picks: [8478402, 8480069] }] });
    ok(legacy.poolers[0].picks.length === 12, 'legacy dense picks padded to 12 slots');
    ok(legacy.poolers[0].picks[0] === 8478402 && legacy.poolers[0].picks[2] === null,
       'legacy picks keep their positions');

    /* ---- 14. unknown player id degrades gracefully ---- */
    MARC.picks = normalizePicks([999999999]);
    selectedPoolerId = MARC.id; editingSlot = null; render();
    ok(/Unknown player/.test(document.getElementById('rosterPanel').textContent),
       'unrecognised player id renders as "Unknown player" instead of crashing');

    /* ---- 15. the published pool ----
       What a pooler opening the site on their own machine gets. */
    ok(PUBLISHED && Array.isArray(PUBLISHED.poolers) && PUBLISHED.poolers.length > 0,
       'a published pool ships with the site (' + (PUBLISHED ? PUBLISHED.poolers.length : 0) + ' poolers)');
    ok(PUBLISHED.published && PUBLISHED.published.length >= 10,
       'it carries a published stamp: ' + (PUBLISHED || {}).published);

    // A browser with nothing saved shows the published pool, not an empty one.
    localStorage.removeItem(STORAGE_KEY);
    let fresh = load();
    ok(fresh.poolers.length === PUBLISHED.poolers.length,
       'a browser with nothing saved loads the published pool, not an empty page');
    ok(fresh.publishedAt === PUBLISHED.published, 'it records which publication it took');
    ok(fresh.poolers[0].picks.length === ROSTER_SIZE, 'published picks come through as 12 slots');

    // Someone who fiddled locally BEFORE this publication gets the new one.
    const stale = JSON.parse(JSON.stringify(fresh));
    stale.publishedAt = '1999-01-01 00:00';
    stale.poolers = stale.poolers.slice(0, 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    ok(load().poolers.length === PUBLISHED.poolers.length,
       'a browser holding an older publication picks up the new one');

    // ...but local edits made since the current publication are left alone.
    const current = JSON.parse(JSON.stringify(fresh));
    current.poolers = current.poolers.slice(0, 2);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    ok(load().poolers.length === 2,
       'local changes since the latest publication are kept, not overwritten');

    // And there is a way back.
    ok(typeof resetToPublished === 'function', 'resetToPublished() exists as the escape hatch');

    state = load();
    render();
    ok(document.getElementById('publishedBadge') !== null || !PUBLISHED,
       'the header shows which publication is on screen');

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
