// Tests mit dem eingebauten Test-Runner von Node (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

// Lokale Zeitpunkte, damit die Tests in jeder Zeitzone gleich laufen
const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const session = (start, minutes, label = 'Mathe') => ({ id: start, start, minutes, label });

test('Uhr-Format rundet auf volle Sekunden auf', () => {
  assert.equal(L.formatClock(25 * 60000), '25:00');
  assert.equal(L.formatClock(1), '00:01');
  assert.equal(L.formatClock(0), '00:00');
  assert.equal(L.formatClock(-500), '00:00');
  assert.equal(L.formatClock(61 * 60000), '1:01:00');
});

test('Minuten lesbar formatieren', () => {
  assert.equal(L.formatMinutes(25), '25 Min.');
  assert.equal(L.formatMinutes(60), '1 Std.');
  assert.equal(L.formatMinutes(95), '1 Std. 35 Min.');
  assert.equal(L.formatMinutes(0), '0 Min.');
});

test('Modusfolge mit langer Pause nach jeder vierten Session', () => {
  assert.equal(L.nextMode('focus', 1, 4), 'short');
  assert.equal(L.nextMode('focus', 3, 4), 'short');
  assert.equal(L.nextMode('focus', 4, 4), 'long');
  assert.equal(L.nextMode('short', 2, 4), 'focus');
  assert.equal(L.nextMode('long', 0, 4), 'focus');
});

test('Restzeit für laufenden und pausierten Timer', () => {
  assert.equal(L.remainingMs({ status: 'running', endsAt: 10_000 }, 4_000), 6_000);
  assert.equal(L.remainingMs({ status: 'running', endsAt: 10_000 }, 12_000), 0);
  assert.equal(L.remainingMs({ status: 'paused', remainingMs: 1234 }, 99_999), 1234);
});

test('Einstellungen werden begrenzt und ergänzt', () => {
  const s = L.normalizeSettings({ focusMin: '50', shortMin: 0, longEvery: 99, sound: false, autoStartBreaks: 'ja' });
  assert.equal(s.focusMin, 50);
  assert.equal(s.shortMin, 1);
  assert.equal(s.longEvery, 12);
  assert.equal(s.longMin, L.DEFAULT_SETTINGS.longMin);
  assert.equal(s.sound, false);
  assert.equal(s.autoStartBreaks, false);
  assert.equal(L.durationMs('focus', s), 50 * 60000);
});

test('Woche beginnt am Montag', () => {
  assert.equal(L.dateKey(L.startOfWeek(new Date(2026, 10, 25))), '2026-11-23'); // Mittwoch
  assert.equal(L.dateKey(L.startOfWeek(new Date(2026, 10, 29, 23))), '2026-11-23'); // Sonntag spät
  assert.equal(L.dateKey(L.startOfWeek(new Date(2026, 10, 30))), '2026-11-30'); // Montag
});

test('Wochenübersicht pro Tag und Thema', () => {
  const sessions = [
    session(at(2026, 11, 23), 25), session(at(2026, 11, 23, 15), 25, 'Projekt'),
    session(at(2026, 11, 25), 50), session(at(2026, 11, 30), 25), session(at(2026, 11, 22), 25),
  ];
  const week = L.weekSummary(sessions, new Date(2026, 10, 26));
  assert.equal(week.start, '2026-11-23');
  assert.equal(week.end, '2026-11-29');
  assert.equal(week.totalMinutes, 100);
  assert.equal(week.sessionCount, 3);
  assert.deepEqual(week.days.map((d) => d.minutes), [50, 0, 50, 0, 0, 0, 0]);
  assert.deepEqual(week.byLabel.map((r) => [r.label, r.minutes]), [['Mathe', 75], ['Projekt', 25]]);
  assert.equal(week.byLabel[0].share, 0.75);
});

test('Serie zählt Tage am Stück, heute darf noch fehlen', () => {
  const sessions = [session(at(2026, 11, 22), 25), session(at(2026, 11, 23), 25), session(at(2026, 11, 24), 25)];
  assert.equal(L.streak(sessions, new Date(2026, 10, 24, 20)), 3);
  assert.equal(L.streak(sessions, new Date(2026, 10, 25, 9)), 3);
  assert.equal(L.streak(sessions, new Date(2026, 10, 26, 9)), 0);
  assert.equal(L.streak([], new Date()), 0);
});

test('Letzte Themen ohne Doppelte, neueste zuerst', () => {
  const sessions = [session(at(2026, 11, 20), 25, 'A'), session(at(2026, 11, 22), 25, 'B'), session(at(2026, 11, 23), 25, 'A'), session(at(2026, 11, 24), 25, '')];
  assert.deepEqual(L.recentLabels(sessions, 5), ['A', 'B']);
});

test('Import wird geprüft', () => {
  const ok = L.normalizeData({ sessions: [{ start: at(2026, 11, 23), minutes: 25.04, label: 'X' }], settings: { focusMin: 30 } });
  assert.equal(ok.sessions[0].minutes, 25);
  assert.ok(ok.sessions[0].id);
  assert.equal(ok.settings.focusMin, 30);
  assert.throws(() => L.normalizeData({}), /keine Sessions/);
  assert.throws(() => L.normalizeData({ sessions: [{ start: 'kaputt', minutes: 5 }] }), /Session 1/);
  assert.throws(() => L.normalizeData({ sessions: [{ start: at(2026, 1, 1), minutes: 0 }] }), /Session 1/);
});

test('Leere Einstellungsfelder behalten den Standardwert', () => {
  const s = L.normalizeSettings({ focusMin: '', shortMin: null, longMin: '20' });
  assert.equal(s.focusMin, L.DEFAULT_SETTINGS.focusMin);
  assert.equal(s.shortMin, L.DEFAULT_SETTINGS.shortMin);
  assert.equal(s.longMin, 20);
});

test('Nachsichtiges Laden überspringt kaputte Sessions', () => {
  const stored = { sessions: [session(at(2026, 11, 23), 25), { start: 5, minutes: 25 }, null] };
  const result = L.normalizeData(stored, { lenient: true });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.dropped, 2);
  assert.equal(JSON.stringify(result).includes('dropped'), false);
  assert.throws(() => L.normalizeData(stored), /Session 2/);
});
