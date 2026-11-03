# AGENTS.md – RetroPost

Hinweise für Codex, Cursor und andere Agenten.

## Projekt
- Node.js ≥ 22.5, **keine npm-Abhängigkeiten**. Bitte keine hinzufügen.
- `server/` ist das Backend (HTTP-API, Worker, Plattform-Clients), `public/` das Vanilla-JS-Frontend ohne Build, `extension/` die Chrome-MV3-Extension.
- Start: `npm run dev` (Dry-Run). Check: `npm run doctor`.

## Setup-Assistent
Wenn der Nutzer um Hilfe beim Setup bittet: Folge `.claude/commands/setup.md` Schritt für Schritt.
**Lies und zeige niemals Inhalte von `.env`.** Prüfe nur mit `npm run doctor`, welche Werte leer sind.

## Studio-Übergabe (wenn du als Studio-Agent in einem Projekt-Repo arbeitest)
Für jeden fertigen Short legst du einen neuen Ordner an: `<content-dir>/<JJJJ-MM-TT>-<slug>/` mit `video.mp4` (1080x1920) und
`post.json` = `{"title","caption","hashtags":[],"format":"short|reel|story|carousel|video","platforms":["youtube","instagram","tiktok"],"notes"}`.
Prüfe das Video vorher mit ffprobe.
