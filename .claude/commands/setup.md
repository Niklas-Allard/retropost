---
description: RetroPost geführt einrichten (ca. 10 Schritte, jeder wird geprüft)
---
Du richtest RetroPost für den Nutzer ein. Arbeite die Schritte aus docs/SETUP.md **nacheinander** ab und prüfe jeden, bevor du zum nächsten gehst.

Regeln:
- **Lies, schreibe oder zeige niemals Secrets.** Der Nutzer trägt alle Werte selbst in `.env` ein. Zum Prüfen nutzt du ausschließlich `npm run doctor`, das nur „gesetzt/LEER“ ausgibt. Öffne `.env` nicht mit Read oder cat.
- Wenn `.env` fehlt, führe `cp .env.example .env` aus.
- Erkläre jeden Schritt kurz und nenne die exakten Redirect-URIs. Warte dann, bis der Nutzer „fertig“ meldet, und prüfe erneut mit `npm run doctor`.

Schritte:
1. Node-Version und Agent-CLI prüfen (`npm run doctor`).
2. `.env` anlegen.
3. RetroPost im Dry-Run starten (`npm run dev`) und den Nutzer bitten, http://localhost:4317 zu öffnen und ein Projekt anzulegen.
4. Cloudflare Tunnel: cloudflared installieren, Tunnel und Hostname auf http://localhost:4318 einrichten, Token und PUBLIC_BASE_URL eintragen lassen.
5. Google Cloud / YouTube nach docs/GOOGLE.md.
6. Meta-App / Instagram.
7. TikTok-App und die Chrome-Extension aus `extension/`.
8. Konten in der Oberfläche verbinden (Chrome-Profile empfehlen).
9. Posting-Slots definieren und einen Test-Post im Dry-Run durchspielen.
10. Dry-Run beenden (`npm start`) und `npm run autostart:install` ausführen.

Zum Schluss fasst du zusammen, was funktioniert und was offen ist.
