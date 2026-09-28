(() => {
  'use strict';

  if (window.top !== window || document.getElementById('tf2-dual-demo-launcher')) return;

  const SITE = 'https://demos.tf2jump.xyz';
  const TICKS_PER_SECOND = 200 / 3;
  const LOAD_TIMEOUT_MS = 90000;
  const PLAYBACK_SPEEDS = [0.1, 0.5, 1, 2, 3];
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
    const speed = Number((toolbar.children[6]?.textContent || '').replace('×', ''));
    if (!Number.isFinite(tick) || elapsed === null || playing === null) return null;
    return { doc, toolbar, tick, elapsed, playing,
      speed: Number.isFinite(speed) ? speed : 1 };
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
    const states = comparison.frames.map(frame => viewer(frame));
    states.forEach((current, index) => {
      setStatus(comparison, index,
        current ? `${formatSeconds(current.elapsed)} · ${current.playing ? 'Playing' : 'Paused'}` : 'Viewer unavailable',
        current ? 'ready' : 'error');
    });
    const allPlaying = states.every(state => state?.playing);
    const toggle = button(comparison, 'toggle-playback');
    toggle.textContent = allPlaying ? 'Ⅱ Pause both' : '▶ Play both';
    toggle.setAttribute('aria-pressed', String(allPlaying));
    comparison.shadow.querySelector('.tf2c-speed').value = String(comparison.playbackSpeed);
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
      await applyPlaybackSpeed(comparison, comparison.playbackSpeed);
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
    button(comparison, 'change').textContent = 'Hide runs';
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
      await applyPlaybackSpeed(comparison, comparison.playbackSpeed);
      comparison.frames.forEach((frame, index) => bindFrame(comparison, frame, index));
      comparison.ready = true;
      comparison.shadow.querySelector('.tf2c-fields').hidden = true;
      button(comparison, 'change').textContent = 'Runs';
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

  function togglePlayback(comparison) {
    const allPlaying = comparison.frames.every(frame => viewer(frame)?.playing);
    setPlayback(comparison, !allPlaying);
  }

  function seek(comparison, direction) {
    if (!comparison.ready || comparison.busy) return;
    comparison.frames.forEach(frame => clickControl(frame, direction < 0 ? 2 : 4));
    refreshTimes(comparison);
  }

  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function setViewerSpeed(frame, speed) {
    let current = viewer(frame);
    if (!current) return false;
    if (Math.abs(current.speed - speed) < .001) return true;

    current.toolbar.children[6]?.click();
    const label = `${speed}×`;
    let option = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      option = [...current.doc.querySelectorAll('button')]
        .find(candidate => candidate.textContent.trim() === label);
      if (option) break;
      await delay(25);
    }
    if (!option) return false;
    option.click();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(25);
      current = viewer(frame);
      if (current && Math.abs(current.speed - speed) < .001) {
        current.toolbar.children[6]?.click();
        await delay(50);
        return true;
      }
    }
    current?.toolbar.children[6]?.click();
    return false;
  }

  async function applyPlaybackSpeed(comparison, speed) {
    const results = await Promise.all(comparison.frames.map(frame => setViewerSpeed(frame, speed)));
    if (results.every(Boolean)) {
      comparison.playbackSpeed = speed;
      comparison.shadow.querySelector('.tf2c-speed').value = String(speed);
      return true;
    }
    return false;
  }

  async function changePlaybackSpeed(comparison, speed) {
    if (!comparison.ready || comparison.busy || !PLAYBACK_SPEEDS.includes(speed)) return;
    const previous = comparison.playbackSpeed;
    setBusy(comparison, true);
    const changed = await applyPlaybackSpeed(comparison, speed);
    if (!changed) {
      await applyPlaybackSpeed(comparison, previous);
      comparison.shadow.querySelector('.tf2c-speed').value = String(previous);
      comparison.shadow.querySelector('.tf2c-error').textContent =
        'Unable to change both replay speeds. Try again after both demos finish loading.';
    } else {
      comparison.shadow.querySelector('.tf2c-error').textContent = '';
    }
    setBusy(comparison, false);
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
      await applyPlaybackSpeed(comparison, comparison.playbackSpeed);
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
    button(comparison, 'change').textContent = fields.hidden ? 'Runs' : 'Hide runs';
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
      togglePlayback(comparison);
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
      const speedOption = node?.closest('button');
      const speedMatch = /^(0\.1|0\.5|1|2|3)×$/.exec(speedOption?.textContent.trim() || '');
      if (speedMatch) {
        const speed = Number(speedMatch[1]);
        comparison.playbackSpeed = speed;
        comparison.shadow.querySelector('.tf2c-speed').value = String(speed);
        setTimeout(() => {
          void setViewerSpeed(comparison.frames[1 - index], speed).then(() => refreshTimes(comparison));
        }, 0);
        return;
      }
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
        .tf2c-header { padding: 9px 12px 10px; background: #0d2025; border-top: 2px solid #49bd9a; border-bottom: 1px solid #315159; box-shadow: 0 8px 24px #0005; }
        .tf2c-topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .tf2c-brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .tf2c-brand-mark { padding: 4px 7px; border-radius: 5px; background: #49bd9a; color: #062820; font-size: 10px; font-weight: 900; letter-spacing: .1em; }
        .tf2c-brand-copy { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .tf2c-brand-copy strong { font-size: 15px; white-space: nowrap; }
        .tf2c-brand-copy span { color: #a9c5c5; font-size: 12px; white-space: nowrap; }
        .tf2c-heading-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .tf2c-action-label { color: #a9c5c5; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
        .tf2c-fields { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; padding: 8px; border: 1px solid #315159; border-radius: 9px; background: #09171b; }
        .tf2c-fields[hidden], .tf2c-error:empty { display: none; }
        .tf2c-fields label { display: flex; align-items: center; gap: 6px; min-width: min(320px, 100%); flex: 1; font-weight: 700; }
        input { min-width: 0; width: 100%; padding: 8px 10px; border: 1px solid #547178; border-radius: 7px; background: #081316; color: #fff; font: inherit; }
        select { padding: 7px 9px; border: 1px solid #547178; border-radius: 7px; background: #081316; color: #fff; font: inherit; }
        button { padding: 7px 10px; border: 1px solid #547178; border-radius: 7px; background: #1a343b; color: #f0fff9; font: 700 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
        button:hover:enabled { background: #28515a; }
        button:disabled { opacity: .42; cursor: not-allowed; }
        a { color: #82e0bb; font-weight: 600; text-decoration: underline; }
        .tf2c-primary { background: #126e5d; border-color: #49d6a8; }
        .tf2c-control-deck { display: flex; align-items: stretch; gap: 7px; margin-top: 8px; flex-wrap: wrap; }
        .tf2c-control-group { min-width: 0; display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid #284951; border-radius: 10px; background: #09181c; }
        .tf2c-control-group[data-group="playback"] { flex: 1 1 530px; }
        .tf2c-control-group[data-group="align"] { flex: 1 1 430px; }
        .tf2c-group-label { padding: 0 5px; color: #7ed9bf; font-size: 10px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; white-space: nowrap; }
        .tf2c-playback { min-width: 104px; background: #49bd9a; border-color: #78e1bf; color: #062820; }
        .tf2c-playback:hover:enabled { background: #72d9b8; }
        .tf2c-playback[aria-pressed="true"] { background: #e5b968; border-color: #f1d59c; color: #2c2109; }
        .tf2c-speed-wrap { display: flex; align-items: center; gap: 5px; margin-left: 2px; color: #a9c5c5; font-size: 11px; font-weight: 700; white-space: nowrap; }
        .tf2c-speed { width: 66px; padding: 6px 7px; }
        .tf2c-jump { width: 108px; padding: 7px 9px; }
        .tf2c-shortcuts { align-self: center; padding: 0 4px; color: #8da9ac; font-size: 11px; white-space: nowrap; }
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
        @media (max-width: 800px) { .tf2c-brand-copy span, .tf2c-shortcuts { display: none; } .tf2c-panes { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; } .tf2c-pane { border-right: 0; border-bottom: 1px solid #315159; } }
      </style>
      <main class="tf2c" data-layout="side">
        <header class="tf2c-header">
          <div class="tf2c-topbar">
            <div class="tf2c-brand"><span class="tf2c-brand-mark">SYNCVIEW</span><div class="tf2c-brand-copy"><strong>Linked replay controls</strong><span>Every control below affects both replays</span></div></div>
            <div class="tf2c-heading-actions">
            <label class="tf2c-action-label" for="tf2c-layout">Layout</label>
            <select id="tf2c-layout" class="tf2c-layout" aria-label="Viewer layout">
              <option value="wide">Side by side · 16:9</option>
              <option value="cinema">Side by side · 21:9</option>
              <option value="stacked">Stacked · full width</option>
              <option value="fill">Side by side · fill panes</option>
            </select>
            <button data-action="change">Hide runs</button>
            <button data-action="close" aria-label="Close comparison">Close</button>
          </div></div>
          <div class="tf2c-fields">
            <label>Run A <input class="tf2c-url" type="text" placeholder="Tempus record link, demo link, or ID"></label>
            <label>Run B <input class="tf2c-url" type="text" placeholder="Tempus record link, demo link, or ID"></label>
            <button class="tf2c-primary" data-action="load">Load both</button>
            <a href="https://tempus2.xyz/maps" target="_blank" rel="noopener">Browse Tempus maps ↗</a>
          </div>
          <div class="tf2c-control-deck">
            <div class="tf2c-control-group" data-group="playback">
              <span class="tf2c-group-label">Both replays</span>
              <button class="tf2c-playback" data-control data-action="toggle-playback" aria-pressed="false" disabled>▶ Play both</button>
              <button data-control data-action="back" title="Seek both replays back 50 ticks" disabled>−50 ticks</button>
              <button data-control data-action="forward" title="Seek both replays forward 50 ticks" disabled>+50 ticks</button>
              <button data-control data-action="start" title="Return both replays to their run starts" disabled>↶ Run start</button>
              <label class="tf2c-speed-wrap">Speed
                <select class="tf2c-speed" data-control aria-label="Playback speed for both replays" disabled>
                  <option value="0.1">0.1×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="3">3×</option>
                </select>
              </label>
            </div>
            <div class="tf2c-control-group" data-group="align">
              <span class="tf2c-group-label">Align & inspect</span>
              <button data-control data-action="sync-a" title="Move Run B to Run A's current time" disabled>Match B to A</button>
              <button data-control data-action="sync-b" title="Move Run A to Run B's current time" disabled>Match A to B</button>
              <input class="tf2c-jump" aria-label="Run time to jump both replays to" placeholder="Time 1:12.5">
              <button data-control data-action="jump" disabled>Jump both</button>
            </div>
            <span class="tf2c-shortcuts">Space · play/pause&nbsp;&nbsp; ← / → · seek</span>
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
      ready: false, busy: false, playbackSpeed: 1, timer: null, resizeObserver: null
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
    button(comparison, 'toggle-playback').addEventListener('click', () => togglePlayback(comparison));
    button(comparison, 'back').addEventListener('click', () => seek(comparison, -1));
    button(comparison, 'forward').addEventListener('click', () => seek(comparison, 1));
    button(comparison, 'start').addEventListener('click', () => void reloadAt(comparison, 0));
    button(comparison, 'sync-a').addEventListener('click', () => void syncTo(comparison, 0));
    button(comparison, 'sync-b').addEventListener('click', () => void syncTo(comparison, 1));
    button(comparison, 'jump').addEventListener('click', () => jumpTo(comparison));
    button(comparison, 'change').addEventListener('click', () => toggleRunFields(comparison));
    shadow.querySelector('.tf2c-speed').addEventListener('change', event => {
      void changePlaybackSpeed(comparison, Number(event.target.value));
    });
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
