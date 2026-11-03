# Setup (einmalig, ca. 2 Stunden)

> Am schnellsten geht es mit `/setup` in Claude Code im RetroPost-Ordner. Alternativ bittest du Codex oder Cursor, `AGENTS.md` zu folgen.
> **Secrets trägst du immer selbst in `.env` ein.** Der Agent prüft nur mit `npm run doctor`, welche Werte leer sind.

## 1. Grundlagen
1. Node.js ≥ 22.5 installieren.
2. Einen KI-Agenten installieren und einloggen: `claude` (Claude Code), `codex` oder `cursor-agent`. RetroPost nutzt deinen bestehenden Login, ein eigener API-Key ist nicht nötig.
3. ffmpeg installieren (empfohlen).
4. `cp .env.example .env`, dann `npm run dev` ausführen und http://localhost:4317 öffnen. Damit läuft alles im Dry-Run.

## 2. Projekt anlegen
In der Oberfläche unter **Projekte** legst du Name, Repo-Pfad (dort arbeitet der Agent) und Content-Ordner fest (Standard `content/shorts`).
Danach im Studio das Preset **Brand-Setup** ausführen. Der Agent sammelt Logos, Farben und Fonts in `brand/` und baut eine Render-Vorlage.

## 3. Cloudflare Tunnel (für Instagram und TikTok)
Instagram und TikTok laden Videos per URL und verlangen HTTPS-Callbacks. RetroPost gibt dafür **nur das Gateway** (Port 4318) frei, das ausschließlich signierte Medien-Links (1 h gültig) und OAuth-Callbacks ausliefert.
1. `cloudflared` installieren.
2. Im Cloudflare-Dashboard unter Zero Trust › Networks › Tunnels einen Tunnel anlegen. Public Hostname, z. B. `retropost.deinedomain.de` → `http://localhost:4318`.
3. In `.env` den Tunnel-Token als `CLOUDFLARE_TUNNEL_TOKEN` eintragen und `PUBLIC_BASE_URL=https://retropost.deinedomain.de` setzen.
4. Unter **System** den Tunnel starten. Ab dann startet er automatisch mit.

## 4. YouTube
Siehe [GOOGLE.md](GOOGLE.md). Redirect-URI: `http://localhost:4317/oauth/youtube/callback`

## 5. Instagram
1. Unter developers.facebook.com eine App anlegen (Typ „Business“) und das Produkt **Instagram › API setup with Instagram login** hinzufügen.
2. Berechtigungen: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights`.
3. Redirect-URI: `https://<PUBLIC_BASE_URL>/oauth/instagram/callback`
4. In `.env` `INSTAGRAM_APP_ID` und `INSTAGRAM_APP_SECRET` eintragen (Instagram-App-ID, nicht die Facebook-App-ID).
5. Dein Instagram-Konto muss ein **Professional-Konto** (Creator oder Business) sein. Im Entwicklungsmodus trägst du es als Tester ein.

## 6. TikTok
1. Unter developers.tiktok.com eine App anlegen und **Login Kit** sowie **Content Posting API** hinzufügen (Direct Post aktivieren).
2. Scopes: `user.info.basic`, `video.publish`, `video.upload`, `video.list`.
3. Redirect-URI: `https://<PUBLIC_BASE_URL>/oauth/tiktok/callback`
4. Für Foto-Karussells per URL muss die Domain verifiziert sein. Die Verifizierungsdatei (`tiktok….txt`) legst du in den RetroPost-Datenordner (siehe **System**). Das Gateway liefert sie aus.
5. Ohne bestandenes Audit gehen API-Posts nur privat („Nur ich“) oder als Entwurf raus. Für öffentliche Posts gibt es den Modus **TikTok Studio**:
   - In Chrome unter `chrome://extensions` den Entwicklermodus aktivieren, „Entpackte Erweiterung laden“ wählen und den Ordner `extension/` laden.
   - Den Token aus **System** und das Konto in den Extension-Optionen eintragen.
   - Wenn ein Post fällig ist, öffnet sich TikTok Studio mit Video und Caption. Du klickst „Posten“ und danach in der Extension „✔ Gepostet“.
6. Nach bestandenem Audit setzt du `TIKTOK_AUDITED=1`.

## 7. Konten verbinden
Unter **Konten** pro Plattform ein Konto anlegen und optional ein **Chrome-Profil** angeben (z. B. `Profile 2`). Dann „Verbinden“ klicken. Jedes Konto meldet sich in seinem eigenen Profil an.

## 8. Slots, Autostart, fertig
- Unter **Projekte** die Posting-Slots definieren.
- `npm run autostart:install` sorgt dafür, dass RetroPost beim Login startet und nach Abstürzen neu startet.
- Unter **System** optional „Rechner aufwecken“ aktivieren. Dafür braucht es `sudo`-Rechte für `pmset` (macOS) oder `rtcwake` (Linux) ohne Passwort.

## Headless-Server (Linux)
RetroPost läuft auch auf Servern ohne Desktop. Den Browser öffnest du per SSH-Tunnel: `ssh -L 4317:localhost:4317 server`. TikTok geht dort nur über die API (Entwurf oder „Nur ich“), weil TikTok Studio eine Desktop-Chrome braucht. Für den Autostart ohne Login: `sudo loginctl enable-linger $USER`.
