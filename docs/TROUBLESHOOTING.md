# Fehlerbehebung

| Problem | Lösung |
|---|---|
| `Port 4317 belegt` | RetroPost läuft schon (z. B. per Autostart). Öffne http://localhost:4317 |
| Agent-CLI nicht gefunden | `claude` / `codex` / `cursor-agent` muss im PATH liegen. Beim Autostart wird der PATH beim Installieren übernommen, nach Änderungen `npm run autostart:install` erneut ausführen. |
| Studio: „Freigabe nötig“ | Der Agent wollte einen Befehl ausführen, der nicht in der Allow-List steht. Gib ihn in der Karte frei oder trage ihn unter Projekte › Befehlsfreigaben ein. |
| Kein Short im Backlog | Der Ordner muss **direkt** im Content-Ordner liegen und ein Video oder Bild enthalten: `content/shorts/<name>/video.mp4` |
| YouTube: `invalid_grant` | Die Testmodus-Anmeldung ist nach 7 Tagen abgelaufen. Neu verbinden oder die OAuth-App auf „In Produktion“ stellen (docs/GOOGLE.md). |
| YouTube: `quotaExceeded` | Das Tageskontingent ist aufgebraucht (ca. 100 Uploads). RetroPost versucht es nach 1/5/15/60 Minuten erneut, danach planst du den Post neu. |
| Instagram: „Kein öffentlicher Tunnel“ | `PUBLIC_BASE_URL` setzen und unter System den Tunnel starten. Prüfen mit `https://<domain>/health` → `ok` |
| Instagram: `Media download failed` | Tunnel offline oder Video ungeeignet (Reels: H.264/AAC, 9:16, 3–90 s, ≤ 300 MB) |
| TikTok: `unaudited_client_can_only_post_to_private_accounts` | Vor dem Audit sind nur „Nur ich“ oder Entwürfe möglich. Für öffentliche Posts den Modus „TikTok Studio“ mit der Extension nutzen. |
| TikTok Studio: Feld nicht gefunden | TikTok hat die Seite geändert. Video und Caption einfügen, im Banner auf „✔ Gepostet“ klicken, oder in RetroPost im Post auf „Als gepostet markieren“. |
| Post „Verpasst“ | Der Rechner war länger aus als die Toleranz. Im Post neu planen oder „Erneut senden“ klicken. Die Toleranz stellst du unter System ein. |
| Rechner wecken funktioniert nicht | Die Befehle laufen mit `sudo -n`. Eine sudoers-Regel ohne Passwort für `pmset` bzw. `rtcwake` anlegen. Unter Windows „Reaktivierungstimer zulassen“ in den Energieoptionen aktivieren. |
| Wo liegen Daten und Logs? | Unter **System › Pfade**. Tokens sind verschlüsselt, der Schlüssel liegt im OS-Schlüsselbund. |

Ausprobieren ohne Risiko: `npm run dev` startet den Dry-Run. Eine Caption mit `#fail` simuliert einen Fehler mit Retries.
