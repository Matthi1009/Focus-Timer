/* Oberfläche des Fokus-Timers: Timer-Ablauf, Speichern, Statistik */
(function () {
  'use strict';

  const L = window.FocusLogic;
  const DATA_KEY = 'focus-timer:data:v1';
  const TIMER_KEY = 'focus-timer:timer:v1';
  const RESCUE_KEY = 'focus-timer:data:v1:rescue';
  const RING_LENGTH = 2 * Math.PI * 88;
  const $ = (id) => document.getElementById(id);

  let loadWarning = '';
  let data = loadData();
  let timer = loadTimer();
  let weekAnchor = new Date();
  let audioContext = null;
  let endTimeout = 0;
  let shownDay = L.dateKey(new Date());
  let beforeImport = null;

  // ---------- Speichern ----------

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      $('data-status').textContent = 'Speichern fehlgeschlagen. Ist der Browser-Speicher voll oder gesperrt?';
    }
  }

  // Kaputte Daten nie still verwerfen: Rohdaten sichern und Bescheid geben
  function loadData() {
    let raw = null;
    try {
      raw = localStorage.getItem(DATA_KEY);
    } catch {
      loadWarning = 'Der Browser-Speicher ist gesperrt. Sessions werden nicht gespeichert.';
      return L.emptyData();
    }
    if (!raw) return L.emptyData();
    try {
      const result = L.normalizeData(JSON.parse(raw), { lenient: true });
      if (result.dropped) {
        writeRaw(RESCUE_KEY, raw);
        loadWarning = `${result.dropped} beschädigte Sessions wurden ausgeblendet. Die Originaldaten sind unter „${RESCUE_KEY}“ gesichert.`;
      }
      return result;
    } catch {
      writeRaw(RESCUE_KEY, raw);
      loadWarning = `Die gespeicherten Daten sind beschädigt und wurden unter „${RESCUE_KEY}“ gesichert.`;
      return L.emptyData();
    }
  }

  function writeRaw(key, raw) {
    try {
      localStorage.setItem(key, raw);
    } catch {
      // Dann bleibt nur die Meldung
    }
  }

  function freshTimer(mode, focusCount) {
    return {
      mode,
      status: 'idle',
      remainingMs: L.durationMs(mode, data.settings),
      totalMs: L.durationMs(mode, data.settings),
      endsAt: null,
      startedAt: null,
      focusCount: focusCount || 0,
    };
  }

  function loadTimer() {
    const raw = readJSON(TIMER_KEY);
    const valid = raw && L.MODES[raw.mode] && ['idle', 'running', 'paused'].includes(raw.status)
      && Number.isFinite(raw.remainingMs) && raw.remainingMs >= 0
      && Number.isFinite(raw.totalMs) && raw.totalMs > 0
      && Number.isInteger(raw.focusCount) && raw.focusCount >= 0
      && (raw.status !== 'running' || Number.isFinite(raw.endsAt))
      && (raw.startedAt == null || !Number.isNaN(Date.parse(raw.startedAt)));
    return valid ? raw : freshTimer('focus', 0);
  }

  const saveData = () => writeJSON(DATA_KEY, data);
  const saveTimer = () => writeJSON(TIMER_KEY, timer);

  // ---------- Hilfen ----------

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) Object.assign(node, props);
    for (const child of children || []) node.append(child);
    return node;
  }

  function timeOf(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function shortDate(date) {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  }

  function armConfirm(button, label, action) {
    if (button.dataset.armed === '1') {
      button.dataset.armed = '';
      button.textContent = button.dataset.label;
      action();
      return;
    }
    button.dataset.label = button.textContent;
    button.dataset.armed = '1';
    button.textContent = label;
    setTimeout(() => {
      if (button.dataset.armed === '1') {
        button.dataset.armed = '';
        button.textContent = button.dataset.label;
      }
    }, 4000);
  }

  // ---------- Ton und Benachrichtigung ----------

  function chime() {
    if (!data.settings.sound) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioContext.currentTime;
      // Drei weiche Töne als Dreiklang
      [660, 880, 990].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.22);
        gain.gain.linearRampToValueAtTime(0.25, now + i * 0.22 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.9);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.22);
        osc.stop(now + i * 0.22 + 1);
      });
    } catch {
      // Ohne Audio geht es auch
    }
  }

  // Muss nach einem Klick passieren, sonst blockiert der Browser den Ton
  function unlockAudio() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
    } catch {
      audioContext = null;
    }
  }

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, tag: 'focus-timer', silent: true });
    } catch {
      // Manche Browser erlauben Notification nur über einen Service Worker
    }
  }

  // ---------- Timer-Ablauf ----------

  // Zusätzlich zum Intervall ein Timeout genau zum Ende, weil Browser Intervalle im Hintergrund drosseln
  function scheduleEnd() {
    clearTimeout(endTimeout);
    if (timer.status === 'running') endTimeout = setTimeout(tick, Math.max(0, timer.endsAt - Date.now()) + 30);
  }

  // Minuten, die in der aktuellen Fokus-Session schon vergangen sind
  function focusProgressMin() {
    if (timer.mode !== 'focus' || !timer.startedAt) return 0;
    return (timer.totalMs - L.remainingMs(timer, Date.now())) / 60000;
  }

  function start() {
    unlockAudio();
    if (timer.status === 'running') return;
    const now = Date.now();
    timer.status = 'running';
    timer.endsAt = now + timer.remainingMs;
    if (!timer.startedAt) timer.startedAt = new Date(now).toISOString();
    timer.label = $('session-label').value.trim().slice(0, 60);
    saveTimer();
    scheduleEnd();
    render();
  }

  function pause() {
    if (timer.status !== 'running') return;
    timer.remainingMs = L.remainingMs(timer, Date.now());
    timer.status = 'paused';
    timer.endsAt = null;
    saveTimer();
    scheduleEnd();
    render();
  }

  // Bei laufender Fokus-Session ab einer Minute erst nach zweitem Klick verwerfen
  function guardDiscard(button, action) {
    if (focusProgressMin() >= 1) armConfirm(button, 'Zeit verwerfen?', action);
    else action();
  }

  function reset() {
    guardDiscard($('btn-reset'), () => {
      timer = freshTimer(timer.mode, timer.focusCount);
      saveTimer();
      scheduleEnd();
      render();
    });
  }

  function switchMode(mode, button) {
    if (mode === timer.mode && timer.status === 'idle') return;
    guardDiscard(button, () => {
      // Nach einer (abgebrochenen) langen Pause beginnt ein neuer Zyklus
      timer = freshTimer(mode, timer.mode === 'long' ? 0 : timer.focusCount);
      saveTimer();
      scheduleEnd();
      render();
    });
  }

  function logSession(minutes, startIso) {
    if (minutes < 1) return;
    // Neu laden, damit Sessions aus anderen Tabs nicht überschrieben werden
    // (nur wenn der Speicher lesbar ist, sonst gingen die Sessions im Speicher verloren)
    if (readJSON(DATA_KEY)) data.sessions = loadData().sessions;
    // Thema vom Start der Session, falls der Tab zwischendurch geschlossen war
    const label = timer.label != null ? timer.label : $('session-label').value.trim();
    data.sessions.push({
      id: L.uid(),
      label: String(label).slice(0, 60),
      start: startIso || new Date(Date.now() - minutes * 60000).toISOString(),
      minutes: Math.round(minutes * 10) / 10,
    });
    saveData();
  }

  // Abgelaufene Phase abschließen; bei Fokus wird die Session gespeichert
  function complete(silent) {
    // Hat ein anderer Tab die Phase schon abgeschlossen? Dann nur dessen Stand übernehmen.
    // Ohne lesbaren Speicher gibt es keine anderen Tabs, dann einfach weitermachen.
    if (readJSON(TIMER_KEY)) {
      const stored = loadTimer();
      if (stored.status !== 'running' || stored.endsAt !== timer.endsAt) {
        timer = stored;
        scheduleEnd();
        render();
        return;
      }
    }
    const finished = timer.mode;
    let focusCount = timer.focusCount;
    if (finished === 'focus') {
      logSession(timer.totalMs / 60000, timer.startedAt);
      focusCount += 1;
    }
    const next = L.nextMode(finished, focusCount, data.settings.longEvery);
    // Nach der langen Pause beginnt ein neuer Zyklus
    timer = freshTimer(next, finished === 'long' ? 0 : focusCount);
    saveTimer();

    if (!silent) {
      chime();
      notify(finished === 'focus' ? 'Fokus geschafft!' : 'Pause vorbei', `Weiter mit: ${L.MODES[next].label}`);
    }
    const auto = next === 'focus' ? data.settings.autoStartFocus : data.settings.autoStartBreaks;
    if (auto && !silent) start();
    else {
      scheduleEnd();
      render();
    }
  }

  // Fokus vorzeitig beenden: bisherige Zeit wird gespeichert, Pause überspringen: einfach weiter
  function skip() {
    if (timer.mode === 'focus' && timer.startedAt) {
      const done = (timer.totalMs - L.remainingMs(timer, Date.now())) / 60000;
      logSession(done, timer.startedAt);
      const focusCount = done >= 1 ? timer.focusCount + 1 : timer.focusCount;
      const next = done >= 1 ? L.nextMode('focus', focusCount, data.settings.longEvery) : 'short';
      timer = freshTimer(next, focusCount);
    } else {
      const next = timer.mode === 'focus' ? 'short' : 'focus';
      timer = freshTimer(next, timer.mode === 'long' ? 0 : timer.focusCount);
    }
    saveTimer();
    scheduleEnd();
    render();
  }

  function tick() {
    if (timer.status === 'running' && L.remainingMs(timer, Date.now()) <= 0) {
      complete(false);
      return;
    }
    // Nach Mitternacht "Heute" und Serie neu berechnen
    const day = L.dateKey(new Date());
    if (day !== shownDay) {
      shownDay = day;
      render();
    } else {
      renderClock();
    }
  }

  // ---------- Darstellung ----------

  function renderClock() {
    const remaining = L.remainingMs(timer, Date.now());
    const clock = L.formatClock(remaining);
    $('clock').textContent = clock;
    const progress = timer.totalMs ? 1 - remaining / timer.totalMs : 0;
    $('ring-progress').style.strokeDashoffset = String(RING_LENGTH * (1 - progress));
    document.title = timer.status === 'idle' ? 'Focus Timer' : `${clock} · ${L.MODES[timer.mode].label}`;
  }

  function renderTimer() {
    document.body.dataset.mode = timer.mode;
    document.body.dataset.status = timer.status;
    $('mode-label').textContent = timer.status === 'paused' ? `${L.MODES[timer.mode].label} · pausiert` : L.MODES[timer.mode].label;
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      const active = btn.dataset.mode === timer.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    $('btn-start').textContent = timer.status === 'running' ? 'Pause' : timer.status === 'paused' ? 'Weiter' : 'Start';
    $('btn-skip').textContent = timer.mode === 'focus' && timer.startedAt ? 'Beenden & speichern' : 'Überspringen';

    const every = data.settings.longEvery;
    const filled = timer.focusCount % every === 0 && timer.focusCount > 0 ? every : timer.focusCount % every;
    $('cycle').replaceChildren(...Array.from({ length: every }, (_, i) => el('span', { className: i < filled ? 'pip on' : 'pip' })));
    $('cycle').setAttribute('aria-label', `${filled} von ${every} Sessions bis zur langen Pause`);
    renderClock();
  }

  function renderToday() {
    const todayKey = L.dateKey(new Date());
    $('today-total').textContent = L.formatMinutes(L.dayTotal(data.sessions, todayKey));
    const days = L.streak(data.sessions, new Date());
    $('streak').textContent = String(days);
    $('streak-word').textContent = days === 1 ? 'Tag' : 'Tage';

    const today = data.sessions.filter((s) => L.dateKey(s.start) === todayKey)
      .sort((a, b) => b.start.localeCompare(a.start));
    $('session-list').replaceChildren(...today.map((s) => {
      const del = el('button', { type: 'button', className: 'icon-btn small', textContent: '×', title: 'Session löschen' });
      del.setAttribute('aria-label', `Session von ${timeOf(s.start)} löschen`);
      del.addEventListener('click', () => armConfirm(del, '?', () => {
        data.sessions = data.sessions.filter((x) => x.id !== s.id);
        saveData();
        render();
      }));
      return el('li', { className: 'session' }, [
        el('span', { className: 'session-time', textContent: timeOf(s.start) }),
        el('span', { className: 'session-label', textContent: s.label || 'Ohne Thema' }),
        el('span', { className: 'session-min', textContent: L.formatMinutes(s.minutes) }),
        del,
      ]);
    }));
    $('session-empty').hidden = today.length > 0;

    $('label-list').replaceChildren(...L.recentLabels(data.sessions, 8).map((label) => el('option', { value: label })));
  }

  function renderWeek() {
    const week = L.weekSummary(data.sessions, weekAnchor);
    const previous = L.weekSummary(data.sessions, L.addDays(weekAnchor, -7));
    const isCurrent = week.start === L.weekSummary([], new Date()).start;
    $('week-label').textContent = isCurrent ? 'Diese Woche' : `${shortDate(week.start)} – ${shortDate(week.end)}`;
    $('week-next').disabled = isCurrent;
    $('week-total').textContent = L.formatMinutes(week.totalMinutes);
    $('week-count').textContent = String(week.sessionCount);

    const delta = week.totalMinutes - previous.totalMinutes;
    const deltaEl = $('week-delta');
    deltaEl.textContent = previous.totalMinutes || week.totalMinutes
      ? `${delta >= 0 ? '+' : '−'}${L.formatMinutes(Math.abs(delta))}`
      : '—';
    deltaEl.classList.toggle('up', delta > 0);
    deltaEl.classList.toggle('down', delta < 0);

    renderWeekChart(week);

    $('label-stats').replaceChildren(...week.byLabel.map((row) => el('li', { className: 'label-row' }, [
      el('span', { className: 'label-name', textContent: row.label }),
      el('span', { className: 'label-min', textContent: L.formatMinutes(row.minutes) }),
      el('span', { className: 'label-bar' }, [el('span', { className: 'label-fill', style: `width:${(row.share * 100).toFixed(1)}%` })]),
    ])));
    $('label-empty').hidden = week.byLabel.length > 0;
  }

  function renderWeekChart(week) {
    const box = $('week-chart');
    const ns = 'http://www.w3.org/2000/svg';
    const width = Math.max(box.clientWidth, 260);
    const height = 170;
    const pad = { top: 22, bottom: 24 };
    const innerH = height - pad.top - pad.bottom;
    const max = Math.max(60, ...week.days.map((d) => d.minutes));
    const slot = width / 7;
    const barW = Math.min(34, slot * 0.55);
    const todayKey = L.dateKey(new Date());

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Fokuszeit pro Tag, insgesamt ${L.formatMinutes(week.totalMinutes)}`);
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      svg.append(n);
      return n;
    };

    add('line', { x1: 0, x2: width, y1: pad.top + innerH, y2: pad.top + innerH, class: 'axis' });
    week.days.forEach((day, i) => {
      const cx = slot * i + slot / 2;
      const h = day.minutes ? Math.max(3, (day.minutes / max) * innerH) : 0;
      const isToday = day.key === todayKey;
      add('rect', { x: cx - barW / 2, y: pad.top + innerH - h, width: barW, height: h, rx: 4, class: isToday ? 'bar today' : 'bar' });
      if (day.minutes) {
        // Wert über dem Balken, damit er auch ohne Maus lesbar ist
        const label = day.minutes >= 60 ? `${(day.minutes / 60).toFixed(1).replace('.', ',')} h` : `${Math.round(day.minutes)}′`;
        add('text', { x: cx, y: pad.top + innerH - h - 6, 'text-anchor': 'middle', class: 'val' }, label);
      }
      add('text', { x: cx, y: height - 6, 'text-anchor': 'middle', class: isToday ? 'tick today' : 'tick' }, day.weekday);
    });
    box.replaceChildren(svg);
  }

  function renderSettings() {
    const form = $('settings-form');
    for (const key of ['focusMin', 'shortMin', 'longMin', 'longEvery']) form[key].value = data.settings[key];
    for (const key of ['autoStartBreaks', 'autoStartFocus', 'sound']) form[key].checked = data.settings[key];
    const btn = $('btn-notify');
    if (!('Notification' in window)) {
      btn.hidden = true;
    } else if (Notification.permission === 'granted') {
      btn.textContent = 'Benachrichtigungen sind an';
      btn.disabled = true;
    } else if (Notification.permission === 'denied') {
      btn.textContent = 'Benachrichtigungen im Browser blockiert';
      btn.disabled = true;
    }
  }

  function render() {
    renderTimer();
    renderToday();
    renderWeek();
  }

  // ---------- Ereignisse ----------

  $('btn-start').addEventListener('click', () => (timer.status === 'running' ? pause() : start()));
  $('btn-reset').addEventListener('click', reset);
  $('btn-skip').addEventListener('click', skip);
  document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', () => switchMode(btn.dataset.mode, btn)));

  document.addEventListener('keydown', (ev) => {
    // Kürzel nur, wenn kein Eingabefeld und kein Button den Fokus hat
    const busy = ev.target.closest('input, textarea, select, button, summary, label, [contenteditable="true"]');
    if (busy || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      if (timer.status === 'running') pause(); else start();
    } else if (ev.key === 'r' || ev.key === 'R') {
      reset();
    } else if (ev.key === 's' || ev.key === 'S') {
      skip();
    }
  });

  $('settings-form').addEventListener('change', (ev) => {
    const form = ev.currentTarget;
    data.settings = L.normalizeSettings({
      focusMin: form.focusMin.value, shortMin: form.shortMin.value, longMin: form.longMin.value, longEvery: form.longEvery.value,
      autoStartBreaks: form.autoStartBreaks.checked, autoStartFocus: form.autoStartFocus.checked, sound: form.sound.checked,
    });
    saveData();
    // Ein ruhender Timer übernimmt die neue Dauer sofort
    if (timer.status === 'idle') timer = freshTimer(timer.mode, timer.focusCount);
    saveTimer();
    renderSettings();
    render();
  });

  $('btn-notify').addEventListener('click', async () => {
    try {
      await Notification.requestPermission();
    } catch {
      // Ältere Browser ohne Promise-API
    }
    renderSettings();
  });

  $('week-prev').addEventListener('click', () => { weekAnchor = L.addDays(weekAnchor, -7); renderWeek(); });
  $('week-next').addEventListener('click', () => { weekAnchor = L.addDays(weekAnchor, 7); renderWeek(); });
  $('week-label').addEventListener('click', () => { weekAnchor = new Date(); renderWeek(); });

  $('export-json').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = el('a', { href: url, download: `focus-timer-backup-${L.dateKey(new Date())}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('data-status').textContent = 'Backup heruntergeladen.';
  });

  $('import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const imported = L.normalizeData(JSON.parse(await file.text()));
      beforeImport = data;
      data = imported;
      saveData();
      // Ein ruhender Timer übernimmt die importierten Einstellungen
      if (timer.status === 'idle') { timer = freshTimer(timer.mode, timer.focusCount); saveTimer(); }
      renderSettings();
      render();
      $('data-status').textContent = `Backup eingespielt: ${data.sessions.length} Sessions.`;
      $('import-undo').hidden = false;
    } catch (err) {
      $('data-status').textContent = `Import fehlgeschlagen: ${err instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : err.message}`;
    }
  });

  $('import-undo').addEventListener('click', () => {
    if (!beforeImport) return;
    data = beforeImport;
    beforeImport = null;
    saveData();
    if (timer.status === 'idle') { timer = freshTimer(timer.mode, timer.focusCount); saveTimer(); }
    renderSettings();
    render();
    $('import-undo').hidden = true;
    $('data-status').textContent = 'Import rückgängig gemacht.';
  });

  $('reset-all').addEventListener('click', (ev) => armConfirm(ev.currentTarget, 'Wirklich alle löschen?', () => {
    beforeImport = null;
    $('import-undo').hidden = true;
    data.sessions = [];
    saveData();
    render();
    $('data-status').textContent = 'Alle Sessions gelöscht.';
  }));

  // Diagramm bei Größenänderung neu zeichnen
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => renderWeekChart(L.weekSummary(data.sessions, weekAnchor)));
  }).observe($('week-chart'));

  // Andere Tabs auf dem gleichen Stand halten
  window.addEventListener('storage', (ev) => {
    if (ev.key === DATA_KEY) data = loadData();
    if (ev.key === TIMER_KEY) { timer = loadTimer(); scheduleEnd(); }
    if (ev.key === DATA_KEY || ev.key === TIMER_KEY) { renderSettings(); render(); }
  });

  // ---------- Start ----------

  $('ring-progress').style.strokeDasharray = String(RING_LENGTH);
  if (timer.label) $('session-label').value = timer.label;
  // Thema während einer laufenden Session ändern
  $('session-label').addEventListener('change', () => {
    if (timer.startedAt) { timer.label = $('session-label').value.trim().slice(0, 60); saveTimer(); }
  });
  // Lief der Timer beim Schließen und ist inzwischen abgelaufen, wird die Session nachgetragen
  if (timer.status === 'running' && L.remainingMs(timer, Date.now()) <= 0) complete(true);
  renderSettings();
  render();
  scheduleEnd();
  if (loadWarning) {
    $('data-status').textContent = loadWarning;
    $('settings').open = true;
  }
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', tick);
})();
