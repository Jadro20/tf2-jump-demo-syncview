(() => {
  'use strict';

  if (window.top !== window || document.getElementById('tf2c-tempus-picker')) return;

  const STORAGE_KEY = 'tf2-dual-demo-tempus-picks';
  const selection = { A: null, B: null };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    for (const side of ['A', 'B']) {
      if (/^\d+$/.test(saved[side]?.id || '')) selection[side] = saved[side];
    }
  } catch { /* Start with an empty selection. */ }

  const style = document.createElement('style');
  style.textContent = `
    #tf2c-tempus-picker { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(340px, calc(100vw - 32px)); padding: 14px; border: 1px solid #65d6b1; border-radius: 12px; background: #102126; color: #eefaf5; box-shadow: 0 8px 30px #000a; font: 13px system-ui, sans-serif; }
    #tf2c-tempus-picker * { box-sizing: border-box; }
    #tf2c-tempus-picker strong { display: block; margin-bottom: 7px; font-size: 15px; }
    #tf2c-tempus-picker .tf2c-choice { display: flex; align-items: center; gap: 6px; margin: 5px 0; }
    #tf2c-tempus-picker .tf2c-choice span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #tf2c-tempus-picker .tf2c-hint { margin: 8px 0; color: #b8d8d1; }
    #tf2c-tempus-picker .tf2c-current-label { display: block; margin-bottom: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #tf2c-tempus-picker .tf2c-current-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    #tf2c-tempus-picker button, .tf2c-inline-pick button { border: 1px solid #65d6b1; border-radius: 5px; background: #155e56; color: #f4fff9; font: 600 12px system-ui, sans-serif; cursor: pointer; }
    #tf2c-tempus-picker button { padding: 4px 7px; }
    #tf2c-tempus-picker button:hover, .tf2c-inline-pick button:hover { background: #218778; }
    #tf2c-tempus-picker a.tf2c-open { display: block; margin-top: 10px; padding: 8px; border-radius: 6px; background: #49bd9a; color: #062820; text-align: center; font-weight: 700; text-decoration: none; }
    #tf2c-tempus-picker a.tf2c-open[aria-disabled="true"] { opacity: .5; pointer-events: none; }
    #tf2c-tempus-picker a.tf2c-watch { padding: 7px 10px; border: 1px solid #7ae7c3; border-radius: 6px; background: #49bd9a; color: #062820; font-weight: 800; text-decoration: none; }
    #tf2c-tempus-picker a.tf2c-watch:hover { background: #76dfbd; }
    .tf2c-inline-pick { display: inline-flex; gap: 3px; margin-left: 7px; vertical-align: middle; }
    .tf2c-inline-pick button { padding: 2px 5px; line-height: 1.2; }
    .tf2c-inline-pick button[aria-pressed="true"] { background: #dfab49; border-color: #ffe0a3; color: #29200c; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('aside');
  panel.id = 'tf2c-tempus-picker';
  panel.innerHTML = `
    <strong>Compare two Tempus runs</strong>
    <div class="tf2c-choice"><b>A</b><span data-label="A">Choose a record</span><button type="button" data-clear="A" aria-label="Clear Run A">×</button></div>
    <div class="tf2c-choice"><b>B</b><span data-label="B">Choose a record</span><button type="button" data-clear="B" aria-label="Clear Run B">×</button></div>
    <div class="tf2c-hint"></div>
    <div class="tf2c-current" hidden>
      <span class="tf2c-current-label"></span>
      <div class="tf2c-current-actions">
        <a class="tf2c-watch" target="_blank" rel="noopener">▶ Watch single demo ↗</a>
        <button type="button" data-current="A">Use as A</button>
        <button type="button" data-current="B">Use as B</button>
      </div>
    </div>
    <a class="tf2c-open" target="_blank" rel="noopener" aria-disabled="true">Open comparison ↗</a>`;
  document.body.appendChild(panel);

  function mapName() {
    const fromURL = /^\/maps\/([^/]+)/.exec(location.pathname)?.[1];
    if (fromURL) {
      try { return decodeURIComponent(fromURL); } catch { return fromURL; }
    }
    const link = document.querySelector('a[href^="/maps/"]');
    return link?.textContent?.trim() || '';
  }

  function currentRecord() {
    const id = /^\/records\/(\d+)\/?$/.exec(location.pathname)?.[1];
    if (!id) return null;
    const player = document.querySelector('h1')?.textContent?.trim() || `Record ${id}`;
    return { id, player, time: '', map: mapName() };
  }

  function save() {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }

  function choose(side, run) {
    if (!/^\d+$/.test(run.id)) return;
    selection[side] = run;
    save();
    updatePanel();
    updateRowButtons();
  }

  function label(run) {
    if (!run) return 'Choose a record';
    return [run.player || `Record ${run.id}`, run.time, run.map].filter(Boolean).join(' · ');
  }

  function updatePanel() {
    panel.hidden = !/^\/(maps|records)(\/|$)/.test(location.pathname);
    for (const side of ['A', 'B']) {
      panel.querySelector(`[data-label="${side}"]`).textContent = label(selection[side]);
    }
    const current = currentRecord();
    const currentArea = panel.querySelector('.tf2c-current');
    currentArea.hidden = !current;
    const watch = panel.querySelector('.tf2c-watch');
    if (current) {
      panel.querySelector('.tf2c-current-label').textContent = `This record: ${label(current)}`;
      watch.href = `https://demos.tf2jump.xyz/?record=${current.id}&play=0`;
      watch.setAttribute('aria-label', `Watch ${current.player}'s run in the demo viewer`);
    } else {
      watch.removeAttribute('href');
    }

    const hint = panel.querySelector('.tf2c-hint');
    const open = panel.querySelector('.tf2c-open');
    const a = selection.A, b = selection.B;
    let valid = Boolean(a && b);
    if (valid && a.id === b.id) {
      hint.textContent = 'Choose two different records.';
      valid = false;
    } else if (valid && a.map && b.map && a.map !== b.map) {
      hint.textContent = 'Choose records from the same map.';
      valid = false;
    } else if (/^\/maps\/[^/]+/.test(location.pathname)) {
      hint.textContent = 'Use A and B beside the leaderboard times.';
    } else if (current) {
      hint.textContent = 'Use this record as A or B, then open the comparison.';
    } else {
      hint.textContent = 'Pick a map, open its leaderboard, then choose two runs.';
    }
    open.setAttribute('aria-disabled', String(!valid));
    if (valid) {
      open.href = `https://demos.tf2jump.xyz/#tf2compare=${a.id},${b.id}`;
    } else {
      open.removeAttribute('href');
    }
  }

  function updateRowButtons() {
    document.querySelectorAll('.tf2c-inline-pick').forEach(group => {
      for (const side of ['A', 'B']) {
        group.querySelector(`[data-side="${side}"]`)?.setAttribute(
          'aria-pressed', String(selection[side]?.id === group.dataset.recordId));
      }
    });
  }

  function decorateRows() {
    if (!/^\/maps\/[^/]+/.test(location.pathname)) return;
    const map = mapName();
    document.querySelectorAll('table tbody tr').forEach(row => {
      if (row.querySelector('.tf2c-inline-pick')) return;
      const recordLink = row.querySelector('td.duration a[href^="/records/"]');
      const id = /^\/records\/(\d+)\/?$/.exec(recordLink?.getAttribute('href') || '')?.[1];
      if (!id) return;
      const run = {
        id,
        player: row.querySelector('td.name a')?.textContent?.trim() || `Record ${id}`,
        time: recordLink.textContent.trim(),
        map
      };
      const group = document.createElement('span');
      group.className = 'tf2c-inline-pick';
      group.dataset.recordId = id;
      for (const side of ['A', 'B']) {
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.dataset.side = side;
        pick.textContent = side;
        pick.title = `Use ${run.player}'s ${run.time} run as ${side}`;
        pick.setAttribute('aria-label', pick.title);
        pick.setAttribute('aria-pressed', String(selection[side]?.id === id));
        pick.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          choose(side, run);
        });
        group.appendChild(pick);
      }
      recordLink.parentElement.appendChild(group);
    });
  }

  panel.querySelectorAll('[data-clear]').forEach(button => {
    button.addEventListener('click', () => {
      selection[button.dataset.clear] = null;
      save();
      updatePanel();
      updateRowButtons();
    });
  });
  panel.querySelectorAll('[data-current]').forEach(button => {
    button.addEventListener('click', () => {
      const run = currentRecord();
      if (run) choose(button.dataset.current, run);
    });
  });

  let previousPath = location.pathname;
  const observer = new MutationObserver(() => {
    if (location.pathname !== previousPath) {
      previousPath = location.pathname;
      updatePanel();
    }
    decorateRows();
    const current = currentRecord();
    if (current) {
      const text = `This record: ${label(current)}`;
      const target = panel.querySelector('.tf2c-current-label');
      if (target.textContent !== text) target.textContent = text;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  decorateRows();
  updatePanel();
})();
