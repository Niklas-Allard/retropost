# ▓▓ RetroPost ▓▓

Ein privates, selbst gehostetes Tool, das Shorts **erstellt, plant, postet und auswertet** – für YouTube, Instagram und TikTok. Die Oberfläche ist im Pixel-Retro-Stil gehalten.
RetroPost läuft komplett auf deinem Rechner. Die Videos erstellt dein KI-Agent (Claude Code, Codex oder Cursor) in deinem eigenen Repo.

```
npm start            → http://localhost:4317
npm run dev          → dasselbe im Dry-Run (es wird nichts wirklich gepostet)
npm run doctor       → Setup-Check (zeigt nur, welche .env-Werte fehlen)
npm run autostart:install
```

Voraussetzungen: **Node.js ≥ 22.5**. Es gibt keine npm-Abhängigkeiten, `npm install` ist also nicht nötig.

## Funktionen

| Bereich | Was es tut |
|---|---|
| **Studio** | Chats pro Projekt. Dein Agent arbeitet im Projekt-Repo und erzeugt Render-Code, Video und Texte. Ein Prompt kann eine ganze **Serie** erzeugen. Presets: Brand-Setup (`brand/` + Render-Vorlage), App-Demo, Erklärvideo, Quiz, Profil-Kit. Optionaler Helfer-Agent (z. B. Codex für Bilder). Bis zu **4 Sessions gleichzeitig**. |
| **Freigaben** | Befehle außerhalb der Allow-List des Projekts erscheinen als Karte. Du wählst „Einmal“, „Immer (Muster)“ oder „Nein“, danach läuft die Session weiter. Catch-all-Regeln (`Bash`, `Bash(*)`) werden abgelehnt. |
| **Backlog** | Fertige Shorts sind Ordner (`video.mp4` + `post.json`). Auch andere Render-Tools können Ordner ablegen. |
| **Automation** | Ein Short dient als Rezept. Zu festen Zeiten an gewählten Tagen entstehen N neue Shorts mit neuem Blickwinkel, aufbauend auf der neuesten Analyse. Die Ergebnisse landen in Review. |
| **Planen** | Monat, Woche und Queue über alle Projekte. Per Drag & Drop wandern alle Konten eines Posts mit. Posting-Slots, „Freie Slots füllen“. Editor mit Hook-Check, KI-Rewrite, Hashtag-Vorschlägen und Undo. Review: einzeln oder alle freigeben. Fehlgeschlagene Posts kannst du direkt beheben. |
| **Posten** | Lokaler Worker über die offiziellen APIs, ohne Cloud. Retries nach 1/5/15/60 Minuten. Toleranz für verpasste Posts (Standard 120 Minuten). Weckt den Rechner. YouTube lädt vorab mit `publishAt` hoch (resumable, 8-MB-Chunks). Instagram und TikTok holen Medien über deinen Cloudflare Tunnel (signierte Links, 1 h gültig). TikTok Studio über die Chrome-Extension. |
| **Wachsen** | Stats der letzten 90 Tage, auch für Posts von außerhalb RetroPost. Rating gegen den Median (stark ≥ ×1,5, schwach ≤ ×0,5). Analyse von Hooks, CTA, Länge, Hashtags und besten Zeiten. Die wöchentliche KI-Analyse schlägt Learnings vor, du gibst sie frei. Dazu: „Im Studio nachbauen“, „Backlog-Texte verbessern“, Antwortvorschläge, Profil-Kit, „Nächste 2 Wochen planen“. |
| **Projekte & Konten** | Mehrere Projekte, jedes mit eigenem Repo, Content-Ordnern, Konten, Slots, KI-Notizen und Learnings. Mehrere Konten pro Plattform, jedes mit eigenem Chrome-Profil. Tokens werden verschlüsselt (Keychain/DPAPI/Keyring) und automatisch erneuert. |
| **MCP** | `server/mcp.js` gibt dem Agenten Werkzeuge: Backlog, Handoff, Planen, Queue, Learnings. |

## Plattformen
- **Instagram:** Reel, Story, Feed-Bild, Karussell (2–20). Braucht ein Professional-Konto und eine Meta-App. Etwa 50–100 Posts pro Tag.
- **YouTube:** Shorts und normale Videos. Etwa 100 Uploads pro Tag und Google-Cloud-Projekt. Vorab-Upload sorgt für Veröffentlichung auch bei ausgeschaltetem Rechner. Der Testmodus-Login läuft nach 7 Tagen ab.
- **TikTok:** Video und Foto-Karussell (1–35 Bilder, braucht Tunnel und verifizierte Domain). Etwa 15 Posts pro Tag. Modi: *TikTok Studio* (öffentlich, du klickst „Posten“), *Entwürfe* oder *Nur ich* (bis zum App-Audit).

## Grenzen
- Gepostet wird nur, solange der Rechner an ist. Verpasste Posts holt RetroPost innerhalb der Toleranz nach. YouTube-Vorab-Uploads gehen trotzdem raus.
- Es gibt keinen geteilten Web-Workspace. Teams teilen das Projekt-Repo über Git, Slots, Queue und Learnings liegen pro Rechner.
- Keine Werbeanzeigen, keine Profiländerungen, keine Strategieentscheidungen. Es werden keine Menschen gefilmt. Facebook, Threads, LinkedIn und X fehlen.
- Kein eingebauter Videoeditor und keine Musikbibliothek. Musik kommt nur aus deinem `music/`-Ordner.

Setup: **[docs/SETUP.md](docs/SETUP.md)** · Google: [docs/GOOGLE.md](docs/GOOGLE.md) · Probleme: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
