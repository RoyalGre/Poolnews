/* =========================================================================
   draft.js — the pick-entry page.

   Rules enforced here:
     - each pooler drafts ROSTER_SIZE (12) players
     - a player can only be owned by ONE pooler
     - scoring uses the best 10, which must include >= 1 defenseman, so a
       roster with no D at all is flagged while there is still time to fix it

   State, storage, search and scoring live in core.js.
   ========================================================================= */

let selectedPoolerId = state.poolers[0] ? state.poolers[0].id : null;

// Slot index currently being edited in the roster pane, or null. Lives outside
// the render so it survives a redraw, and is cleared whenever the pane changes
// to a different pooler.
let editingSlot = null;

/* =========================================================================
   Rendering
   ========================================================================= */
function render() {
  renderStamp();
  renderPoolers();
  renderRoster();
}

/* Called by core.js after a successful Import. */
function onPoolImported() {
  selectedPoolerId = state.poolers[0] ? state.poolers[0].id : null;
  editingSlot = null;
  render();
}

function renderPoolers() {
  const box = $('poolerList');
  box.innerHTML = '';

  if (!state.poolers.length) {
    box.innerHTML = '<div class="hint">No poolers yet.</div>';
    return;
  }

  for (const pl of state.poolers) {
    const n     = filledCount(pl);
    const full  = n >= ROSTER_SIZE;
    const noD   = full && !filledIds(pl).some(id => (BY_ID.get(id) || {}).p === 'D');

    const row = el('div', 'pooler' + (pl.id === selectedPoolerId ? ' active' : ''));
    row.onclick = () => {
      if (pl.id !== selectedPoolerId) editingSlot = null;
      selectedPoolerId = pl.id;
      render();
    };

    const nm = el('span', 'nm', pl.name);
    const ct = el('span', 'ct' + (full ? ' full' : ''), n + '/' + ROSTER_SIZE);

    row.append(nm, ct);
    if (noD) {
      const f = el('span', 'flag', '⚠');
      f.title = 'No defenseman on this roster';
      row.append(f);
    }
    box.append(row);
  }
}

function renderRoster() {
  const panel = $('rosterPanel');
  const pl = state.poolers.find(p => p.id === selectedPoolerId);

  if (!pl) {
    panel.innerHTML = '<div class="empty-state">Add a pooler on the left to start entering picks.</div>';
    return;
  }

  panel.innerHTML = '';

  /* --- header row: name + delete --- */
  const head = el('div');
  head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px';
  const h = el('h2');
  h.style.cssText = 'margin:0;flex:1;font-size:16px;text-transform:none;letter-spacing:0;color:var(--text)';
  const filled = filledCount(pl);
  h.textContent = pl.name + ' — ' + filled + ' of ' + ROSTER_SIZE;
  const del = el('button', null, 'Delete pooler');
  del.onclick = () => {
    if (!confirm('Delete "' + pl.name + '" and all ' + filled + ' picks?')) return;
    state.poolers = state.poolers.filter(x => x.id !== pl.id);
    selectedPoolerId = state.poolers[0] ? state.poolers[0].id : null;
    editingSlot = null;
    save(); render();
  };
  head.append(h, del);
  panel.append(head);

  /* --- warnings --- */
  const dCount = filledIds(pl).filter(id => (BY_ID.get(id) || {}).p === 'D').length;
  if (filled >= ROSTER_SIZE && dCount === 0) {
    panel.append(banner('⚠ No defenseman on this roster. Scoring requires at least one D among the counting ' + COUNTING_SIZE + ' — this roster can never be scored legally.'));
  } else if (filled === ROSTER_SIZE - 1 && dCount === 0) {
    panel.append(banner('⚠ One pick left and no defenseman yet — the last pick must be a D.'));
  } else if (filled >= ROSTER_SIZE && dCount > 0) {
    panel.append(banner('✓ Roster complete — ' + dCount + ' ' +
      (dCount > 1 ? 'defensemen' : 'defenseman') + ' on board.', true));
  }

  /* --- top search box: fills the first empty slot ---
     Hidden while a specific slot is being edited, so there's only ever one
     search box on screen and no ambiguity about where a pick will land. */
  const nextSlot = firstEmptySlot(pl);
  if (nextSlot >= 0 && editingSlot === null) {
    panel.append(buildSearch(pl, nextSlot));
  }

  /* --- the 12 slots --- */
  for (let i = 0; i < ROSTER_SIZE; i++) {
    panel.append(buildSlot(pl, i));
  }
}

function banner(text, ok) {
  return el('div', 'banner' + (ok ? ' ok' : ''), text);
}

function buildSlot(pl, i) {
  const id  = pl.picks[i];
  const row = el('div');

  /* --- this slot is being edited: show a search box in place --- */
  if (editingSlot === i) {
    row.className = 'slot editing';

    const num = el('span', 'num', String(i + 1));
    const search = buildSearch(pl, i);

    const cancel = el('button', 'slotbtn', id === null ? 'Cancel' : 'Keep');
    cancel.title = id === null
      ? 'Leave this slot empty'
      : 'Cancel and keep the current player';
    cancel.onclick = () => { editingSlot = null; render(); };

    row.append(num, search, cancel);

    // Only offer "Empty" when there's actually somebody to clear out.
    if (id !== null) {
      const clear = el('button', 'slotbtn danger', 'Empty');
      clear.title = 'Clear this slot without replacing the player';
      clear.onclick = () => {
        pl.picks[i] = null;
        editingSlot = null;
        save(); render();
      };
      row.append(clear);
    }
    return row;
  }

  /* --- empty slot: click anywhere on it to start picking --- */
  if (id === null || id === undefined) {
    row.className = 'slot empty';
    row.innerHTML = '<span class="num">' + (i + 1) +
                    '</span><span class="who">— click to pick —</span>';
    row.title = 'Pick a player for slot ' + (i + 1);
    row.onclick = () => { editingSlot = i; render(); };
    return row;
  }

  const p = BY_ID.get(id);
  row.className = 'slot';

  const num = el('span', 'num', String(i + 1));
  const pos = el('span', 'pos ' + (p ? p.p : ''), p ? p.p : '?');

  const who = el('span', 'who');
  if (p) {
    who.innerHTML = '<div>' + esc(p.n) + '</div><div class="sub">' + esc(p.t) +
                    (p.s ? ' · #' + p.s : '') + '</div>';
  } else {
    // Player id isn't in the current data file (traded away, retired, or the
    // data was refreshed since the pick was made). Keep the pick, flag it.
    who.innerHTML = '<div>Unknown player</div><div class="sub">id ' + id + ' — not in current NHL data</div>';
  }

  const pts = el('span', 'pts', p ? p._pts + ' pt' : '');
  if (p) pts.title = (p.g || 0) + 'G + ' + (p.a || 0) + 'A (' + (DATA.statsSeason || 'prev season') + ')';

  // Opens an in-place search for THIS slot rather than deleting the pick.
  // Nothing is changed until a replacement is chosen (or "Empty" is clicked),
  // so a mis-click costs nothing and the rest of the roster never shifts.
  const edit = el('button', 'editbtn', '✎');
  edit.title = 'Change this pick';
  edit.onclick = () => { editingSlot = i; render(); };

  row.append(num, pos, who, pts, edit);
  return row;
}

/* =========================================================================
   Search widget — always focused, type + Enter fills slotIndex.
   The target slot is passed in explicitly rather than inferred, so the same
   widget serves both the top box (first empty slot) and an in-place slot edit.
   ========================================================================= */
function buildSearch(pl, slotIndex) {
  const wrap = el('div', 'searchwrap');

  const current = pl.picks[slotIndex];
  const currentPlayer = current !== null && current !== undefined ? BY_ID.get(current) : null;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = currentPlayer
    ? 'Replace ' + currentPlayer.n + ' in slot ' + (slotIndex + 1) + '…'
    : 'Type a player name, then Enter  (slot ' + (slotIndex + 1) + ')';

  const list = el('div', 'results');

  const hint = el('div', 'hint', currentPlayer
    ? '↑ ↓ to move · Enter to replace · Esc to keep ' + currentPlayer.n
    : '↑ ↓ to move · Enter to draft · Esc to clear · greyed-out players are already owned');

  wrap.append(input, list, hint);

  let results = [];
  let sel     = 0;
  let rowEls  = [];

  // The slot being edited counts as vacant: the player already in it must not
  // show as "owned" by this very pooler.
  const owners = ownerMap(pl, slotIndex);

  /* Rows are built ONCE per query and then reused; moving the selection only
     toggles a class. Rebuilding the list on every keystroke used to break
     keyboard navigation outright: the results panel opens directly under the
     mouse pointer, so tearing down and recreating the rows made the browser
     fire mouseenter on whatever row happened to sit under the (motionless)
     cursor, which reset the selection and triggered another rebuild. Arrowing
     to a player and pressing Enter would then draft the hovered row instead. */

  // Only a genuine pointer movement may take the selection away from the
  // keyboard. Events fired because the DOM moved underneath a still mouse are
  // ignored by comparing against the last known cursor position.
  let lastMouse = null;

  function paintSel(scrollIntoView) {
    rowEls.forEach((e, i) => e.classList.toggle('sel', i === sel));
    const e = rowEls[sel];
    if (scrollIntoView && e) {
      // block:'nearest' scrolls the results panel just enough to expose the
      // row, without yanking the whole page around.
      e.scrollIntoView({ block: 'nearest' });
    }
  }

  function draw() {
    list.innerHTML = '';
    rowEls = [];
    results.forEach((p, idx) => {
      const owner = owners.get(p.i);
      const taken = !!owner;

      const r = el('div', 'res' + (taken ? ' taken' : ''));
      r.append(el('span', 'pos ' + p.p, p.p), el('span', 'nm', p.n), el('span', 'team', p.t));

      if (taken) {
        r.append(el('span', 'owner', '✋ ' + owner.name));
      } else {
        const pts = el('span', 'pts', String(p._pts));
        pts.title = (p.g || 0) + 'G + ' + (p.a || 0) + 'A';
        r.append(pts);
      }

      r.addEventListener('mousemove', ev => {
        // Same coordinates as last time means the pointer never actually
        // moved — the event came from the list changing under it. Ignore.
        if (lastMouse && ev.clientX === lastMouse.x && ev.clientY === lastMouse.y) return;
        lastMouse = { x: ev.clientX, y: ev.clientY };
        if (sel !== idx) { sel = idx; paintSel(false); }
      });
      r.onclick = () => commit(idx);

      list.append(r);
      rowEls.push(r);
    });
    paintSel(false);
  }

  function commit(idx) {
    const p = results[idx];
    if (!p) return;
    if (owners.get(p.i)) {
      flash(input, 'Already owned by ' + owners.get(p.i).name);
      return;
    }
    if (slotIndex < 0 || slotIndex >= ROSTER_SIZE) return;

    pl.picks[slotIndex] = p.i;   // write into the slot; never reorder the rest
    editingSlot = null;
    save();
    render();

    // Re-focus the (freshly rebuilt) search box so picks can be entered
    // back-to-back without touching the mouse.
    const nextInput = document.querySelector('.searchwrap input');
    if (nextInput) nextInput.focus();
  }

  input.addEventListener('input', () => {
    results = search(input.value);
    sel = 0;
    draw();
    list.scrollTop = 0;   // a new query always starts at the top of the list
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(sel + 1, results.length - 1);
      paintSel(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
      paintSel(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(sel);
    } else if (e.key === 'Escape') {
      // First Escape clears what you typed; a second one backs out of an
      // in-place slot edit entirely, leaving that slot exactly as it was.
      if (input.value) {
        input.value = '';
        results = [];
        draw();
      } else if (editingSlot !== null) {
        editingSlot = null;
        render();
      }
    }
  });

  setTimeout(() => input.focus(), 0);
  return wrap;
}

function flash(e, msg) {
  const old = e.placeholder;
  e.style.borderColor = 'var(--danger)';
  e.placeholder = msg;
  setTimeout(() => { e.style.borderColor = ''; e.placeholder = old; }, 1400);
}

/* =========================================================================
   Toolbar actions
   ========================================================================= */
$('btnAddPooler').onclick = addPooler;
$('newPoolerName').addEventListener('keydown', e => { if (e.key === 'Enter') addPooler(); });

function addPooler() {
  const box  = $('newPoolerName');
  const name = box.value.trim();
  if (!name) { box.focus(); return; }
  if (state.poolers.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    alert('There is already a pooler named "' + name + '".');
    return;
  }
  const pooler = { id: newPoolerId(), name: name, picks: emptyPicks() };
  state.poolers.push(pooler);
  selectedPoolerId = pooler.id;
  editingSlot = null;
  box.value = '';
  save();
  render();
}

wireImportExport();   /* the hidden file input behind Data > Import */
wireDataMenu();
wireThemeToggle();
wireAutoRefresh();
wirePublishedBadge();

/* ---- Go ---------------------------------------------------------------- */
if (!PLAYERS.length) {
  document.querySelector('main').insertAdjacentHTML('afterbegin',
    '<div class="banner" style="grid-column:1/-1">No NHL player data loaded. ' +
    'Run <code>refresh-players.ps1</code> to populate <code>data/players.js</code>.</div>');
}
render();
