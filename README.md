# Focus Timer

Ein Pomodoro-Timer, der mitschreibt, woran du gearbeitet hast. Am Ende der Woche siehst du, wohin deine Zeit gegangen ist.

**Live ausprobieren:** https://matthi1009.github.io/focus-timer/ *(nachdem GitHub Pages aktiviert ist)*

## Funktionen

- **Pomodoro-Ablauf**: Fokus, kurze Pause und nach jeder vierten Session eine lange Pause. Alle Zeiten sind einstellbar.
- **Thema pro Session**, zum Beispiel „Mathe“ oder „Projekt“. Deine letzten Themen werden vorgeschlagen.
- **Wochenstatistik**: Fokuszeit pro Tag, Aufteilung nach Thema und Vergleich mit der Vorwoche
- **Serie**: wie viele Tage du am Stück fokussiert gearbeitet hast
- **Läuft weiter**, auch wenn du den Tab schließt oder neu lädst. Eine Session, die in der Zwischenzeit fertig wurde, wird nachgetragen.
- **Früher fertig?** „Beenden & speichern“ speichert die Zeit bis dahin.
- **Ton und Desktop-Benachrichtigung**, wenn eine Phase endet
- **Tastenkürzel**: Leertaste startet und pausiert, `R` setzt zurück, `S` überspringt
- Die verbleibende Zeit steht im Tab-Titel
- **Backup** als JSON herunterladen und wieder einspielen
- Heller und dunkler Modus, funktioniert auf dem Handy

## Datenschutz

Alle Sessions liegen nur im `localStorage` deines Browsers. Es gibt keinen Server, kein Tracking und keine externen Skripte oder Schriften.

## Starten

Ohne Installation: `index.html` im Browser öffnen.

Oder mit einem lokalen Server:

```bash
npm start          # startet python3 -m http.server auf Port 8080
```

### Auf GitHub Pages veröffentlichen

1. Repo auf GitHub öffnen, dann **Settings → Pages**
2. Unter *Build and deployment* als Quelle **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`
3. Nach ungefähr einer Minute läuft der Timer unter `https://<dein-name>.github.io/focus-timer/`

## Entwicklung

Reines HTML, CSS und JavaScript, ohne Build-Schritt und ohne Abhängigkeiten.

```
index.html      Aufbau der Seite
css/style.css   Gestaltung, Akzentfarbe je Modus, Dark Mode
js/logic.js     Zeitrechnung, Statistik, Serie, Import-Prüfung, ohne DOM-Zugriff
js/app.js       Timer-Ablauf, Speichern, Ton, Benachrichtigungen, Oberfläche
tests/          Tests für logic.js
```

```bash
npm test           # Node ab Version 18
```

Der Timer zählt nicht einfach Sekunden herunter, sondern merkt sich den Zeitpunkt, an dem die Phase endet. So bleibt er auch dann genau, wenn der Browser einen Tab im Hintergrund drosselt.

## Lizenz

[MIT](LICENSE)
