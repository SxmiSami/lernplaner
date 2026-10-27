# Lernplaner

Ein Planer für Klausuren: Termine eintragen, Stoff hochladen, Themen nach Schwierigkeit gewichten, auf die Tage vor der Klausur verteilen und den Lernfortschritt in Prozent verfolgen.

## Funktionen

- **Klausuren** mit Fach, Datum, Lernbeginn und Farbe
- **Stoff** als PDF oder Text hochladen. Aus Überschriften und Nummerierungen werden Themen vorgeschlagen
- **Schwierigkeit 1–5** pro Thema. Daraus ergibt sich der Anteil am Stoff, z. B. 3 von insgesamt 15 Punkten = 20 %
- **Automatisch verteilen:** Schwere Themen bekommen mehr Tage. Wenn genug Zeit ist, bleibt der letzte Tag als Wiederholungstag frei. Die Lerntage lassen sich danach von Hand ändern
- **Abhaken:** An jedem Lerntag hakst du ab, ob du das Thema gelernt hast. Erst der Haken „verstanden“ zählt zum Fortschritt
- **Übersicht** mit der Liste für heute, einem „Nachholen“-Bereich und dem Gesamtfortschritt
- **Kalender** als Monatsansicht
- **Sync über GitHub**, damit Handy, Laptop und Tablet dieselben Daten haben

## Einrichtung (einmalig, ca. 10 Minuten)

### 1. Website veröffentlichen (GitHub Pages)

1. Auf GitHub ein **neues, öffentliches** Repository anlegen, z. B. `lernplaner`.
2. Alle Dateien aus diesem Ordner hochladen: `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `icon.svg`, `.nojekyll`, `README.md`. Das geht über **Add file → Upload files**.
3. Im Repo: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)`, dann **Save**.
4. Nach etwa 1 Minute ist der Planer erreichbar unter `https://DEIN-NAME.github.io/lernplaner/`.

> In diesem Repo liegt nur das Programm. Deine Daten liegen nicht hier.

### 2. Privates Daten-Repo anlegen

1. Ein **zweites** Repository anlegen, z. B. `lernplaner-daten`, und **Private** auswählen.
2. Das Häkchen **„Add a README file“** setzen, damit das Repo nicht leer ist.

Hier speichert der Planer `data.json` (Klausuren und Themen) und den Ordner `files/` (deine PDFs).

### 3. Token erstellen

1. Öffne <https://github.com/settings/personal-access-tokens/new> (Fine-grained token).
2. Gib einen Namen ein, z. B. „Lernplaner“, und wähle ein Ablaufdatum, z. B. 1 Jahr.
3. Bei **Repository access** wählst du **Only select repositories** und dann `lernplaner-daten`.
4. Bei **Permissions → Repository permissions → Contents** stellst du **Read and write** ein.
5. Klicke auf **Generate token** und kopiere den Token. Er beginnt mit `github_pat_…`.

Dieser Token kann nur dein Daten-Repo lesen und schreiben, sonst nichts.

### 4. Verbinden

1. Öffne den Planer und tippe oben rechts auf das Regler-Symbol (Einstellungen).
2. Trag deinen GitHub-Benutzernamen, `lernplaner-daten` und den Token ein und klicke auf **Verbinden & synchronisieren**.

**Weitere Geräte:** Klicke in den Einstellungen auf **Einrichtungscode kopieren** und schick den Code an dich selbst, z. B. per Notiz oder Messenger an dich. Auf dem anderen Gerät fügst du ihn ein und klickst auf **Verbinden**. Der Code enthält deinen Token, behandle ihn also wie ein Passwort.

**Als App aufs Handy:** Öffne die Seite im Browser und wähle „Zum Home-Bildschirm hinzufügen“ (iPhone: Teilen-Menü, Android: Browser-Menü).

## Wie der Sync funktioniert

- Jede Änderung wird sofort auf dem Gerät gespeichert und nach etwa 1 Sekunde zu GitHub hochgeladen.
- Beim Öffnen der Seite und beim Zurückwechseln in den Tab holt der Planer den neuesten Stand.
- Ohne Internet läuft alles normal weiter. Die Änderungen werden später abgeglichen.
- Hast du dieselbe Klausur auf zwei Geräten gleichzeitig offline bearbeitet, gewinnt die zuletzt geänderte Version.
- Oben rechts siehst du den Status: grün = synchronisiert, rot = Fehler (für Details darauf tippen).
- Backup: **Einstellungen → Exportieren** speichert alles als JSON-Datei.

## Wenn etwas nicht klappt

| Meldung | Lösung |
|---|---|
| Token ungültig oder abgelaufen | Neuen Token erstellen (Schritt 3) und neu verbinden |
| Repo nicht gefunden | Benutzername oder Repo-Name prüfen. Hat der Token Zugriff auf genau dieses Repo? |
| Keine Berechtigung | Beim Token fehlt „Contents: Read and write“ |
| PDF noch nicht hochgeladen | Das Gerät, auf dem die PDF hinzugefügt wurde, einmal mit Internet öffnen |
