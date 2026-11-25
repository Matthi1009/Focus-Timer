/*
 * Reine Funktionen für den Fokus-Timer, ohne DOM-Zugriff.
 * Läuft im Browser (window.FocusLogic) und in Node (require) für die Tests.
 */
(function (root) {
  'use strict';

  const MODES = {
    focus: { label: 'Fokus', settingKey: 'focusMin' },
    short: { label: 'Kurze Pause', settingKey: 'shortMin' },
    long: { label: 'Lange Pause', settingKey: 'longMin' },
  };

  const DEFAULT_SETTINGS = {
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    longEvery: 4,
    autoStartBreaks: false,
    autoStartFocus: false,
    sound: true,
  };

  const LIMITS = {
    focusMin: [1, 180],
    shortMin: [1, 60],
    longMin: [1, 90],
    longEvery: [2, 12],
  };

  const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeSettings(input) {
    const result = { ...DEFAULT_SETTINGS };
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
      const raw = input && input[key];
      if (raw === '' || raw == null) continue; // leeres Feld: Standardwert behalten
      const value = Math.round(Number(raw));
      if (Number.isFinite(value)) result[key] = clamp(value, min, max);
    }
    for (const key of ['autoStartBreaks', 'autoStartFocus', 'sound']) {
      if (input && typeof input[key] === 'boolean') result[key] = input[key];
    }
    return result;
  }

  function durationMs(mode, settings) {
    return settings[MODES[mode].settingKey] * 60 * 1000;
  }

  // Nach Fokus kommt eine Pause (jede n-te lang), nach jeder Pause wieder Fokus
  function nextMode(mode, completedFocusCount, longEvery) {
    if (mode !== 'focus') return 'focus';
    return completedFocusCount > 0 && completedFocusCount % longEvery === 0 ? 'long' : 'short';
  }

  function remainingMs(timer, now) {
    if (timer.status === 'running') return Math.max(0, timer.endsAt - now);
    return timer.remainingMs;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return hours ? `${hours}:${mmss}` : mmss;
  }

  function formatMinutes(minutes) {
    const rounded = Math.round(minutes);
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    if (!h) return `${m} Min.`;
    return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
  }

  // Lokales Datum als YYYY-MM-DD (nicht UTC, sonst rutschen Abend-Sessions auf den nächsten Tag)
  function dateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  // Wochenbeginn ist Montag
  function startOfWeek(date) {
    const d = startOfDay(date);
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function minutesByDay(sessions) {
    const map = new Map();
    for (const s of sessions) {
      const key = dateKey(s.start);
      map.set(key, (map.get(key) || 0) + s.minutes);
    }
    return map;
  }

  function weekSummary(sessions, weekStart) {
    const start = startOfWeek(weekStart);
    const keys = Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i)));
    const inWeek = sessions.filter((s) => keys.includes(dateKey(s.start)));
    const perDay = minutesByDay(inWeek);
    const labels = new Map();
    for (const s of inWeek) {
      const label = s.label || 'Ohne Thema';
      labels.set(label, (labels.get(label) || 0) + s.minutes);
    }
    const totalMinutes = inWeek.reduce((acc, s) => acc + s.minutes, 0);
    return {
      start: keys[0],
      end: keys[6],
      days: keys.map((key, i) => ({ key, weekday: WEEKDAYS_SHORT[i], minutes: perDay.get(key) || 0 })),
      byLabel: [...labels.entries()]
        .map(([label, minutes]) => ({ label, minutes, share: totalMinutes ? minutes / totalMinutes : 0 }))
        .sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label, 'de')),
      totalMinutes,
      sessionCount: inWeek.length,
    };
  }

  function dayTotal(sessions, key) {
    return sessions.filter((s) => dateKey(s.start) === key).reduce((acc, s) => acc + s.minutes, 0);
  }

  // Tage am Stück mit mindestens einer Session; heute ohne Session bricht die Serie noch nicht
  function streak(sessions, today) {
    const days = new Set(sessions.map((s) => dateKey(s.start)));
    let cursor = startOfDay(today);
    if (!days.has(dateKey(cursor))) cursor = addDays(cursor, -1);
    let count = 0;
    while (days.has(dateKey(cursor))) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function recentLabels(sessions, limit) {
    const seen = [];
    const sorted = [...sessions].sort((a, b) => String(b.start).localeCompare(String(a.start)));
    for (const s of sorted) {
      if (s.label && !seen.includes(s.label)) seen.push(s.label);
      if (seen.length >= limit) break;
    }
    return seen;
  }

  /*
   * Prüft Daten. Streng (Import): wirft beim ersten Fehler.
   * Nachsichtig (Laden aus dem Speicher): überspringt kaputte Sessions und zählt sie in `dropped`.
   */
  function normalizeData(input, options) {
    const lenient = Boolean(options && options.lenient);
    let dropped = 0;
    if (!input || typeof input !== 'object' || !Array.isArray(input.sessions)) {
      throw new Error('Die Datei enthält keine Sessions.');
    }
    const sessions = [];
    input.sessions.forEach((s, i) => {
      const ok = s && typeof s.start === 'string' && !Number.isNaN(Date.parse(s.start))
        && Number.isFinite(s.minutes) && s.minutes > 0 && s.minutes <= 24 * 60;
      if (!ok) {
        if (!lenient) throw new Error(`Session ${i + 1} ist ungültig.`);
        dropped += 1;
        return;
      }
      sessions.push({ id: String(s.id || uid()), label: String(s.label || '').slice(0, 60), start: new Date(s.start).toISOString(), minutes: Math.round(s.minutes * 10) / 10 });
    });
    const data = { version: 1, sessions, settings: normalizeSettings(input.settings) };
    if (lenient) Object.defineProperty(data, 'dropped', { value: dropped, enumerable: false });
    return data;
  }

  function emptyData() {
    return { version: 1, sessions: [], settings: { ...DEFAULT_SETTINGS } };
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const api = {
    MODES, DEFAULT_SETTINGS, LIMITS, WEEKDAYS_SHORT, normalizeSettings, durationMs, nextMode, remainingMs, formatClock,
    formatMinutes, dateKey, startOfDay, addDays, startOfWeek, weekSummary, dayTotal, streak, recentLabels,
    normalizeData, emptyData, uid,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FocusLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
