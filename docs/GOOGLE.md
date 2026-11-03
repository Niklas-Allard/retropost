# YouTube / Google Cloud einrichten

1. https://console.cloud.google.com öffnen und ein neues Projekt anlegen (z. B. „RetroPost“).
2. Unter **APIs & Dienste › Bibliothek** die **YouTube Data API v3** aktivieren.
3. Den **OAuth-Zustimmungsbildschirm** einrichten: Typ „Extern“, App-Name, deine E-Mail-Adresse. Unter Testnutzer dein Google-Konto eintragen.
   Scopes: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`.
4. Unter **Anmeldedaten › OAuth-Client-ID** den Typ „Webanwendung“ wählen.
   Autorisierte Weiterleitungs-URI: `http://localhost:4317/oauth/youtube/callback`
5. Client-ID und Secret in `.env` als `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` eintragen und RetroPost neu starten.
6. In RetroPost unter **Konten** ein YouTube-Konto anlegen und „Verbinden“ klicken. Bei mehreren Kanälen wählst du den Kanal im Google-Dialog aus.

**Wichtig:**
- Im **Testmodus** läuft die Anmeldung nach **7 Tagen** ab. Danach musst du neu verbinden. Abhilfe: App unter „Veröffentlichungsstatus“ auf **In Produktion** stellen. Für den privaten Gebrauch ist keine Verifizierung nötig, Google zeigt dann nur einen Warnhinweis.
- Kontingent: 10.000 Einheiten pro Tag und Projekt, ein Upload kostet etwa 100. Das ergibt **ca. 100 Uploads pro Tag**, geteilt über alle Kanäle dieses Projekts.
- Uploads aus nicht geprüften API-Projekten setzt YouTube teilweise auf „privat“, bis das Projekt den API-Audit bestanden hat. Das passiert über das „YouTube API Services – Audit and Quota Extension Form“.
