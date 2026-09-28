(() => {
  'use strict';

  if (window.top !== window || document.getElementById('tf2-dual-demo-launcher')) return;

  const SITE = 'https://demos.tf2jump.xyz';
  const TICKS_PER_SECOND = 200 / 3;
  const LOAD_TIMEOUT_MS = 90000;
  let comparison = null;

  const launcher = document.createElement('button');
  launcher.id = 'tf2-dual-demo-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Compare runs';
  Object.assign(launcher.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '2147483646',
    padding: '10px 14px', border: '1px solid #65d6b1', borderRadius: '10px',
    background: '#102b2a', color: '#f0fff9', font: '600 14px system-ui, sans-serif',
    cursor: 'pointer', boxShadow: '0 6px 18px #0008'
  });
  launcher.addEventListener('click', openComparison);
  document.body.appendChild(launcher);

  function parseRunURL(input) {
    const value = input.trim().replace(/\\&/g, '&');
    if (/^\d+$/.test(value)) {
      return new URL(`${SITE}/?record=${value}&play=0`);
    }
    let url;
    try { url = new URL(value); } catch { throw new Error('Paste a Tempus record link, demo viewer link, or record ID.'); }
    const tempusRecord = url.origin === 'https://tempus2.xyz' &&
      /^\/records\/(\d+)\/?$/.exec(url.pathname);
    if (tempusRecord) {
      return new URL(`${SITE}/?record=${tempusRecord[1]}&play=0`);
    }
    if (url.origin !== SITE || !/^\d+$/.test(url.searchParams.get('record') || '')) {
      throw new Error('Use a tempus2.xyz/records/ID link, a demos.tf2jump.xyz run link, or a record ID.');
    }
    const tick = url.searchParams.get('tick');
    if (tick !== null && !/^\d+$/.test(tick)) throw new Error('The link has an invalid tick.');
    url.searchParams.set('play', '0');
    url.hash = '';
    return url;
  }

  function secondsFromText(value) {
    const match = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
    if (!match) return null;
    return (match[1] === '-' ? -1 : 1) *
      (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]));
  }

  function formatSeconds(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value < 0 ? '−' : '';
    const seconds = Math.abs(value);
    const mins = Math.floor(seconds / 60);
    return `${sign}${mins}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
  }

  function viewer(frame) {
    let doc;
    try { doc = frame.contentDocument; } catch { return null; }
    if (!doc?.body) return null;

    const group = doc.querySelector('.ui-layer.mb-4 .group.relative');
    const toolbar = group && [...group.children].find(child =>
      child.children.length >= 8 && child.textContent.includes('DEMO'));
    if (!toolbar) return null;

    const tick = Number(/DEMO\s*(\d+)/.exec(toolbar.children[0]?.textContent || '')?.[1]);
    const runText = group.textContent.match(/RUN\s*(-?\d+:\d{2}:\d{2}(?:\.\d+)?)/)?.[1];
    const elapsed = runText ? secondsFromText(runText) : null;
    const path = toolbar.children[3]?.querySelector('svg path')?.getAttribute('d') || '';
    const playing = path.startsWith('M96 448h106.7') ? true :
      path.startsWith('M96 52v408') ? false : null;
    if (!Number.isFinite(tick) || elapsed === null || playing === null) return null;
    return { doc, toolbar, tick, elapsed, playing };
  }

  function collapseViewOptions(frame) {
    let doc;
    try { doc = frame.contentDocument; } catch { return false; }
    if (!doc?.documentElement || doc.__tf2ViewOptionsCollapseStarted) return false;
    doc.__tf2ViewOptionsCollapseStarted = true;

    const closeWhenPresent = () => {
      const toggle = doc.querySelector('button[aria-controls="view-options-panel"]');
      if (!toggle) return false;
      if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
      return true;
    };
    if (closeWhenPresent()) return true;

    const Observer = doc.defaultView?.MutationObserver || MutationObserver;
    const observer = new Observer(() => {
      if (closeWhenPresent()) observer.disconnect();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
    return false;
  }

  function waitForViewer(frame, label) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!frame.isConnected) {
          clearInterval(timer);
          reject(new Error('Comparison closed while loading.'));
          return;
        }
        const current = viewer(frame);
        if (current) {
          clearInterval(timer);
          collapseViewOptions(frame);
          resolve(current);
        } else if (Date.now() - started > LOAD_TIMEOUT_MS) {
          clearInterval(timer);
          reject(new Error(`${label} did not load. Check that the record has an available demo and the site allows the viewer to open inside a pane.`));
        }
      }, 150);
    });
  }

  function navigateFrame(frame, url, label) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        frame.removeEventListener('load', onLoad);
        reject(new Error(`${label} did not navigate to the demo.`));
      }, LOAD_TIMEOUT_MS);
      function onLoad() {
        clearTimeout(timeout);
        collapseViewOptions(frame);
        waitForViewer(frame, label).then(resolve, reject);
      }
      frame.addEventListener('load', onLoad, { once: true });
      frame.src = url;
    });
  }

  function button(comparison, name) {
    return comparison.shadow.querySelector(`[data-action="${name}"]`);
  }

  function setBusy(comparison, busy) {
    comparison.busy = busy;
    comparison.shadow.querySelectorAll('[data-control]').forEach(element => {
      element.disabled = busy || !comparison.ready;
    });
    button(comparison, 'load').disabled = busy;
  }

  function setStatus(comparison, index, message, kind = '') {
    const element = comparison.shadow.querySelectorAll('.tf2c-status')[index];
    element.textContent = message;
    element.dataset.kind = kind;
  }

  function refreshTimes(comparison) {
    if (!comparison.ready || comparison.busy) return;
    comparison.frames.forEach((frame, index) => {
      const current = viewer(frame);
      setStatus(comparison, index,
        current ? `${formatSeconds(current.elapsed)} · ${current.playing ? 'Playing' : 'Paused'}` : 'Viewer unavailable',
        current ? 'ready' : 'error');
    });
  }

  function frameURL(source, tick) {
    const url = new URL(source.href);
    url.searchParams.set('tick', String(Math.max(0, Math.round(tick))));
    url.searchParams.set('play', '0');
    return url.href;
  }

  async function reloadAt(comparison, seconds) {
    if (!comparison.ready || comparison.busy) return;
    comparison.ready = false;
    setBusy(comparison, true);
    try {
      const requests = comparison.frames.map((frame, index) => {
        setStatus(comparison, index, 'Seeking…');
        return navigateFrame(frame, frameURL(comparison.sources[index],
          comparison.baseTicks[index] + seconds * TICKS_PER_SECOND), `Run ${index + 1}`);
      });
      await Promise.all(requests);
      comparison.frames.forEach((frame, index) => bindFrame(comparison, frame, index));
      comparison.ready = true;
    } catch (error) {
      showError(comparison, error);
    } finally {
      setBusy(comparison, false);
      refreshTimes(comparison);
    }
  }

  function showError(comparison, error) {
    const message = error instanceof Error ? error.message : String(error);
    comparison.shadow.querySelector('.tf2c-error').textContent = message;
    comparison.shadow.querySelector('.tf2c-fields').hidden = false;
    button(comparison, 'change').textContent = 'Hide links';
    comparison.ready = false;
    comparison.frames.forEach((_, index) => setStatus(comparison, index, 'Unable to load', 'error'));
  }

  async function loadBoth(comparison) {
    let sources;
    try {
      sources = [...comparison.shadow.querySelectorAll('.tf2c-url')]
        .map(field => parseRunURL(field.value));
    } catch (error) { showError(comparison, error); return; }

    comparison.shadow.querySelector('.tf2c-error').textContent = '';
    comparison.ready = false;
    comparison.sources = sources;
    setBusy(comparison, true);
    try {
      const requests = comparison.frames.map((frame, index) => {
        setStatus(comparison, index, 'Loading demo…');
        return navigateFrame(frame, sources[index].href, `Run ${index + 1}`);
      });
      const initial = await Promise.all(requests);

      // The site's RUN clock is relative to the actual record start. A copied URL
      // may point anywhere in the demo, so derive that start from its current tick.
      comparison.baseTicks = initial.map(state =>
        Math.max(0, Math.round(state.tick - state.elapsed * TICKS_PER_SECOND)));
      const alignments = [];
      comparison.frames.forEach((frame, index) => {
        if (Math.abs(initial[index].tick - comparison.baseTicks[index]) > 2) {
          setStatus(comparison, index, 'Aligning run start…');
          alignments.push(navigateFrame(frame,
            frameURL(sources[index], comparison.baseTicks[index]), `Run ${index + 1}`));
        }
      });
      await Promise.all(alignments);
      comparison.frames.forEach((frame, index) => bindFrame(comparison, frame, index));
      comparison.ready = true;
      comparison.shadow.querySelector('.tf2c-fields').hidden = true;
      button(comparison, 'change').textContent = 'Change runs';
    } catch (error) {
      showError(comparison, error);
    } finally {
      setBusy(comparison, false);
      refreshTimes(comparison);
    }
  }

  function clickControl(frame, index) {
    const current = viewer(frame);
    const control = current?.toolbar.children[index];
    if (!control) return false;
    control.click();
    return true;
  }

  function setPlayback(comparison, shouldPlay) {
    if (!comparison.ready || comparison.busy) return;
    comparison.frames.forEach(frame => {
      const current = viewer(frame);
      if (current && current.playing !== shouldPlay) clickControl(frame, 3);
    });
    refreshTimes(comparison);
  }

  function seek(comparison, direction) {
    if (!comparison.ready || comparison.busy) return;
    comparison.frames.forEach(frame => clickControl(frame, direction < 0 ? 2 : 4));
    refreshTimes(comparison);
  }

  async function syncTo(comparison, sourceIndex) {
    if (!comparison.ready || comparison.busy) return;
    setPlayback(comparison, false);
    const reference = viewer(comparison.frames[sourceIndex]);
    if (!reference) return;
    const targetIndex = 1 - sourceIndex;
    comparison.ready = false;
    setBusy(comparison, true);
    try {
      setStatus(comparison, targetIndex, `Matching Run ${sourceIndex === 0 ? 'A' : 'B'}…`);
      await navigateFrame(comparison.frames[targetIndex],
        frameURL(comparison.sources[targetIndex], comparison.baseTicks[targetIndex] +
          Math.max(0, reference.elapsed) * TICKS_PER_SECOND), `Run ${targetIndex + 1}`);
      bindFrame(comparison, comparison.frames[targetIndex], targetIndex);
      comparison.ready = true;
    } catch (error) {
      showError(comparison, error);
    } finally {
      setBusy(comparison, false);
      refreshTimes(comparison);
    }
  }

  function applyLayout(comparison) {
    const mode = comparison.shadow.querySelector('.tf2c-layout').value;
    comparison.shadow.querySelector('.tf2c').dataset.layout = mode === 'stacked' ? 'stacked' : 'side';
    const ratio = mode === 'wide' ? 16 / 9 : mode === 'cinema' ? 21 / 9 : null;
    comparison.frames.forEach(frame => {
      const box = frame.parentElement.getBoundingClientRect();
      if (!box.width || !box.height) return;
      let width = box.width;
      let height = box.height;
      if (ratio && width / height > ratio) width = height * ratio;
      else if (ratio) height = width / ratio;
      frame.style.width = `${Math.floor(width)}px`;
      frame.style.height = `${Math.floor(height)}px`;
    });
  }

  function toggleRunFields(comparison) {
    const fields = comparison.shadow.querySelector('.tf2c-fields');
    fields.hidden = !fields.hidden;
    button(comparison, 'change').textContent = fields.hidden ? 'Change runs' : 'Hide links';
  }

  function jumpTo(comparison) {
    const value = comparison.shadow.querySelector('.tf2c-jump').value.trim();
    const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) :
      secondsFromText(value.includes(':') && value.split(':').length === 2 ?
        `0:${value.split(':')[0].padStart(2, '0')}:${value.split(':')[1]}` : value);
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
      comparison.shadow.querySelector('.tf2c-error').textContent = 'Enter seconds (12.5) or a clock time (1:12.5).';
      return;
    }
    comparison.shadow.querySelector('.tf2c-error').textContent = '';
    void reloadAt(comparison, seconds);
  }

  function onKey(comparison, event) {
    if (!comparison.ready || comparison.busy || event.repeat) return;
    const tag = event.target?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) ||
        event.target?.isContentEditable || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const allPlaying = comparison.frames.every(frame => viewer(frame)?.playing);
      setPlayback(comparison, !allPlaying);
    } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      event.stopImmediatePropagation();
      seek(comparison, event.code === 'ArrowLeft' ? -1 : 1);
    }
  }

  function bindFrame(comparison, frame, index) {
    const doc = frame.contentDocument;
    if (!doc || doc.__tf2DualBound) return;
    doc.__tf2DualBound = true;
    doc.addEventListener('keydown', event => onKey(comparison, event), true);
    doc.addEventListener('click', event => {
      if (!event.isTrusted || !comparison.ready || comparison.busy) return;
      const current = viewer(frame);
      if (!current) return;
      const node = event.target && typeof event.target.closest === 'function' ? event.target : null;
      const control = node?.closest('.cursor-pointer');
      if (!control || control.parentElement !== current.toolbar) return;
      const controlIndex = [...current.toolbar.children].indexOf(control);
      const other = comparison.frames[1 - index];
      if (controlIndex === 3) {
        const shouldPlay = !current.playing;
        const otherState = viewer(other);
        if (otherState && otherState.playing !== shouldPlay) clickControl(other, 3);
      } else if (controlIndex === 2 || controlIndex === 4) {
        clickControl(other, controlIndex);
      }
    }, true);
  }

  function closeComparison() {
    if (!comparison) return;
    clearInterval(comparison.timer);
    comparison.resizeObserver.disconnect();
    comparison.host.remove();
    comparison.root?.style.setProperty('visibility', comparison.oldRootVisibility);
    document.body.style.overflow = comparison.oldBodyOverflow;
    launcher.hidden = false;
    comparison = null;
  }

  function openComparison() {
    if (comparison) return;
    const root = document.getElementById('root');
    const oldRootVisibility = root?.style.visibility || '';
    const oldBodyOverflow = document.body.style.overflow;
    const current = root && viewer({ contentDocument: document });
    if (current?.playing) current.toolbar.children[3].click();

    const host = document.createElement('div');
    host.id = 'tf2-dual-demo-overlay';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647' });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .tf2c { width: 100%; height: 100%; display: flex; flex-direction: column; background: #081316; color: #e8f4ef; font: 14px system-ui, sans-serif; }
        .tf2c-header { padding: 12px 16px; background: #102126; border-bottom: 1px solid #315159; }
        .tf2c-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .tf2c-heading-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .tf2c-heading-actions label { min-width: 0; flex: none; }
        h1 { margin: 0; font-size: 18px; }
        .tf2c-fields, .tf2c-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
        .tf2c-fields[hidden], .tf2c-error:empty { display: none; }
        label { display: flex; align-items: center; gap: 6px; min-width: min(360px, 100%); flex: 1; }
        input { min-width: 0; width: 100%; padding: 8px 10px; border: 1px solid #547178; border-radius: 7px; background: #081316; color: #fff; font: inherit; }
        .tf2c-jump { width: 100px; }
        select { padding: 7px 9px; border: 1px solid #547178; border-radius: 7px; background: #081316; color: #fff; font: inherit; }
        button { padding: 8px 12px; border: 1px solid #547178; border-radius: 7px; background: #1a343b; color: #f0fff9; font: 600 13px system-ui, sans-serif; cursor: pointer; }
        button:hover:enabled { background: #28515a; }
        button:disabled { opacity: .42; cursor: not-allowed; }
        a { color: #82e0bb; font-weight: 600; text-decoration: underline; }
        .tf2c-primary { background: #126e5d; border-color: #49d6a8; }
        .tf2c-error { margin-top: 6px; color: #ffb4a6; }
        .tf2c-panes { min-height: 0; flex: 1; display: grid; grid-template-columns: 1fr 1fr; }
        .tf2c-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid #315159; }
        .tf2c-pane:last-child { border-right: 0; }
        .tf2c[data-layout="stacked"] .tf2c-panes { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
        .tf2c[data-layout="stacked"] .tf2c-pane { border-right: 0; border-bottom: 1px solid #315159; }
        .tf2c[data-layout="stacked"] .tf2c-pane:last-child { border-bottom: 0; }
        .tf2c-pane-head { display: flex; justify-content: space-between; padding: 7px 12px; background: #13262b; font-weight: 600; }
        .tf2c-status { font-weight: 400; color: #b4d5dc; }
        .tf2c-status[data-kind="ready"] { color: #82e0bb; }
        .tf2c-status[data-kind="error"] { color: #ffb4a6; }
        .tf2c-viewport { flex: 1; min-height: 0; min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #050909; }
        iframe { flex: none; display: block; border: 0; background: #050909; }
        @media (max-width: 800px) { .tf2c-panes { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; } .tf2c-pane { border-right: 0; border-bottom: 1px solid #315159; } }
      </style>
      <main class="tf2c" data-layout="side">
        <header class="tf2c-header">
          <div class="tf2c-heading"><h1>Compare TF2 jump runs</h1><div class="tf2c-heading-actions">
            <label for="tf2c-layout">View</label>
            <select id="tf2c-layout" class="tf2c-layout" aria-label="Viewer layout">
              <option value="wide">Side by side · 16:9</option>
              <option value="cinema">Side by side · 21:9</option>
              <option value="stacked">Stacked · full width</option>
              <option value="fill">Side by side · fill panes</option>
            </select>
            <button data-action="change">Hide links</button>
            <button data-action="close" aria-label="Close comparison">Close</button>
          </div></div>
          <div class="tf2c-fields">
            <label>Run A <input class="tf2c-url" type="text" placeholder="Tempus record link, demo link, or ID"></label>
            <label>Run B <input class="tf2c-url" type="text" placeholder="Tempus record link, demo link, or ID"></label>
            <button class="tf2c-primary" data-action="load">Load both</button>
            <a href="https://tempus2.xyz/maps" target="_blank" rel="noopener">Browse Tempus maps ↗</a>
          </div>
          <div class="tf2c-controls">
            <button data-control data-action="play" disabled>▶ Play</button>
            <button data-control data-action="pause" disabled>Ⅱ Pause</button>
            <button data-control data-action="back" disabled>⏪ Seek back</button>
            <button data-control data-action="forward" disabled>⏩ Seek forward</button>
            <button data-control data-action="start" disabled>↩ Run start</button>
            <button data-control data-action="sync-a" disabled>Match A time</button>
            <button data-control data-action="sync-b" disabled>Match B time</button>
            <input class="tf2c-jump" aria-label="Run time to jump to" placeholder="1:12.5">
            <button data-control data-action="jump" disabled>Jump to</button>
            <span>Space: play/pause · ←/→: seek</span>
          </div>
          <div class="tf2c-error" role="alert"></div>
        </header>
        <div class="tf2c-panes">
          <section class="tf2c-pane"><div class="tf2c-pane-head"><span>Run A</span><span class="tf2c-status">Waiting for link</span></div><div class="tf2c-viewport"><iframe title="Run A viewer"></iframe></div></section>
          <section class="tf2c-pane"><div class="tf2c-pane-head"><span>Run B</span><span class="tf2c-status">Waiting for link</span></div><div class="tf2c-viewport"><iframe title="Run B viewer"></iframe></div></section>
        </div>
      </main>`;
    document.body.appendChild(host);
    if (root) root.style.visibility = 'hidden';
    document.body.style.overflow = 'hidden';
    launcher.hidden = true;

    comparison = {
      host, shadow, root, oldRootVisibility, oldBodyOverflow,
      frames: [...shadow.querySelectorAll('iframe')], sources: [], baseTicks: [],
      ready: false, busy: false, timer: null, resizeObserver: null
    };
    const layout = shadow.querySelector('.tf2c-layout');
    const defaultLayout = innerWidth / innerHeight >= 2.2 ? 'stacked' : 'wide';
    let savedLayout = null;
    try { savedLayout = localStorage.getItem('tf2-dual-demo-layout'); } catch { /* Use the screen-based default. */ }
    layout.value = ['wide', 'cinema', 'stacked', 'fill'].includes(savedLayout) ? savedLayout : defaultLayout;
    if (location.search.includes('record=')) {
      shadow.querySelector('.tf2c-url').value = location.href;
    }
    button(comparison, 'close').addEventListener('click', closeComparison);
    button(comparison, 'load').addEventListener('click', () => void loadBoth(comparison));
    button(comparison, 'play').addEventListener('click', () => setPlayback(comparison, true));
    button(comparison, 'pause').addEventListener('click', () => setPlayback(comparison, false));
    button(comparison, 'back').addEventListener('click', () => seek(comparison, -1));
    button(comparison, 'forward').addEventListener('click', () => seek(comparison, 1));
    button(comparison, 'start').addEventListener('click', () => void reloadAt(comparison, 0));
    button(comparison, 'sync-a').addEventListener('click', () => void syncTo(comparison, 0));
    button(comparison, 'sync-b').addEventListener('click', () => void syncTo(comparison, 1));
    button(comparison, 'jump').addEventListener('click', () => jumpTo(comparison));
    button(comparison, 'change').addEventListener('click', () => toggleRunFields(comparison));
    layout.addEventListener('change', () => {
      try { localStorage.setItem('tf2-dual-demo-layout', layout.value); } catch { /* Layout still applies this session. */ }
      applyLayout(comparison);
    });
    shadow.querySelector('.tf2c-jump').addEventListener('keydown', event => {
      if (event.key === 'Enter') jumpTo(comparison);
    });
    shadow.addEventListener('keydown', event => onKey(comparison, event), true);
    comparison.timer = setInterval(() => refreshTimes(comparison), 200);
    comparison.resizeObserver = new ResizeObserver(() => applyLayout(comparison));
    shadow.querySelectorAll('.tf2c-viewport').forEach(element => comparison.resizeObserver.observe(element));
    applyLayout(comparison);
  }

  const picked = /^#tf2compare=(\d+),(\d+)$/.exec(location.hash);
  if (picked) {
    openComparison();
    const fields = comparison.shadow.querySelectorAll('.tf2c-url');
    fields[0].value = `https://tempus2.xyz/records/${picked[1]}`;
    fields[1].value = `https://tempus2.xyz/records/${picked[2]}`;
    void loadBoth(comparison);
  }
})();
