# RUNBOOK – TEILEKLAR.shop vorübergehend offline nehmen

**Status dieses Pakets: `OFFLINE_VORBEREITET`.**
Es wurde kein Cutover ausgeführt. teileklar.shop ist unverändert online
(Vergleichsstand: `pruefung/vorher-2026-11-22.txt`, 22.11.2026, 18:42–18:45 UTC).

Dieses Runbook führt der Inhaber aus. Jeder Schritt in Abschnitt 3 verändert
die Produktion; Abschnitt 2 muss vorher vollständig erledigt sein.

Grundlage: Inhaberentscheidung vom 22.11.2026.

---

## 1. Was das Paket tut

| Anfrage | Antwort im Offline-Zustand |
|---|---|
| `GET/HEAD /` | 200, Offline-Seite, `X-Robots-Tag: noindex`, `Cache-Control: no-store` |
| `GET/HEAD /impressum /datenschutz /agb /widerruf /versand` | 200, Rechtsseite |
| `GET/HEAD /robots.txt /sitemap.xml /.well-known/security.txt` | 200 |
| `GET/HEAD /sw.js` und `/<markt>/sw.js` | 200, Abschalt-Service-Worker |
| `POST /api/revolut/webhook` | unverändert an den API-Dienst (Port 8905) |
| alles andere unter `/api/` (jede Methode) | 503, kurze JSON-Antwort |
| alles andere (jede Methode) | 503, Offline-Seite als Inhalt |

Jede 503-Antwort trägt `Retry-After: 86400`, `Cache-Control: no-store`,
`X-Robots-Tag: noindex`. Es gibt keine Weiterleitung (301) und kein 410.

Die Sperre sitzt im Webserver (nginx) vor dem API-Dienst. Bestellung,
Checkout, Registrierung, Anmeldung, Gastkonto, Gutschein, Werkstatt- und
Terminanfrage, Partnerantrag, Kontaktformular und Chat erreichen den Dienst
nicht mehr – unabhängig davon, was eine Seite im Browser anzeigt.
Der API-Dienst und die Datenbank werden nicht angehalten und nicht verändert.

Dateien:

| Datei | Zweck |
|---|---|
| `offline.html` | Offline-Seite (eine Datei, keine externen Ressourcen) |
| `sw.js` | löscht Browser-Caches, meldet den alten Service Worker ab, lädt neu |
| `robots.txt`, `sitemap.xml` | Stand für den Offline-Zustand |
| `nginx/teileklar-offline.conf` | Regelblock zum Einbinden (Allowlist) |
| `nginx/teileklar-offline.server.example.conf` | Beispiel, wo die Zeilen stehen |
| `nginx/test/` | lokaler Test samt Ergebnisprotokoll |
| `cloudflare/` | Alternative am Rand (Abschnitt 5) |
| `pruefung/readback.sh`, `pruefung/pfade.tsv` | Soll-Ist-Prüfung |
| `pruefung/vorher-2026-11-22.txt` | Stand vor dem Cutover (Vergleich für den Rückweg) |
| `pruefung/sw-lokaltest.mjs` | Browsertest des Abschalt-Service-Workers |

Warum `robots.txt` die 503-Pfade **nicht** per `Disallow` sperrt: Ein
`Disallow` verbietet Suchmaschinen den Abruf. Sie würden den 503 mit
`Retry-After` dann gar nicht sehen und die Adressen mit ihrem alten Stand
weiterführen. Ohne `Disallow` rufen sie die Adressen ab und erkennen den
vorübergehenden Zustand. (Die bisherige Datei sperrt `/api/`; auch das entfällt.)

---

## 2. Voraussetzungen und Stop-Kriterien

Jeder Punkt wird abgehakt. **Ist ein Punkt nicht erfüllt: nicht weitermachen.**

### 2.1 Kein laufendes Hostinger-Backup
- [ ] Im Hostinger-Panel für den Server prüfen: Es läuft gerade kein Backup.
      Läuft eines, abwarten, bis es abgeschlossen ist.
- [ ] Datum des letzten abgeschlossenen Ganzserver-Backups notieren
      (zuletzt belegt: 20.11.2026).
- **Stop:** Backup läuft oder das letzte Backup ist fehlgeschlagen.
- Nicht belegt: ob sich ein Hostinger-Backup wiederherstellen lässt (kein Restore-Test).

### 2.2 Freier Speicher
- [ ] `df -h` auf dem Server. Die Platte war zuletzt zu etwa 90 % belegt.
- [ ] Größe von Webroot und Datenbank ermitteln (`du -sh <pfad>`), bevor
      gesichert wird.
- **Stop:** Die Sicherungen aus 2.3 und 2.4 passen nicht auf die Platte.
      Dann zuerst ein Ziel außerhalb des Servers bereitstellen.

### 2.3 Eigener Datenbank-Dump
- [ ] Dump der Shop-Datenbank erzeugen, Prüfsumme bilden (`sha256sum`),
      Datei außerhalb des Servers ablegen.
- [ ] Dump stichprobenartig öffnen: Er enthält die Tabellen für
      Bestellungen, Zahlungen und Konten.
- **Stop:** Kein Dump, leerer Dump oder Dump liegt nur auf demselben Server.
- Nicht belegt: Art und Ort der Datenbank. Der Quellcode des Dienstes liegt
  in keinem Repository. Deshalb steht hier kein fertiger Befehl.

### 2.4 Sicherung von nginx-Konfiguration und Webroot mit Prüfsummen
```bash
sudo mkdir -p /root/tk-sicherung && cd /root/tk-sicherung
ZEIT=$(date -u +%Y%m%dT%H%M%SZ)
sudo nginx -T > nginx-T-$ZEIT.txt                      # wirksame Gesamtkonfiguration
sudo tar -C / -czf nginx-$ZEIT.tar.gz etc/nginx
sudo tar -C / -czf webroot-$ZEIT.tar.gz <webroot-ohne-führenden-schrägstrich>
sha256sum nginx-$ZEIT.tar.gz webroot-$ZEIT.tar.gz nginx-T-$ZEIT.txt | sudo tee SHA256SUMS-$ZEIT
```
- [ ] Den Webroot-Pfad aus `nginx-T-…txt` ablesen (Zeilen `root`/`alias`).
- [ ] Archive und Prüfsummen zusätzlich außerhalb des Servers ablegen.
- [ ] Probe: `tar -tzf nginx-$ZEIT.tar.gz | head` listet Dateien.
- **Stop:** Archiv nicht lesbar oder Prüfsumme fehlt.
- Achtung: `nginx-T-…txt` kann Pfade zu Schlüsseln enthalten, aber keine
  Schlüssel. Die Archive nicht in ein Repository legen.

### 2.5 Bestandszählung (Stand unmittelbar vor dem Cutover)
Zahlen mit Datum und Uhrzeit (UTC) notieren – nur Anzahlen, keine Kundendaten:
- [ ] Bestellungen gesamt und davon offen (nicht versandt / nicht abgeschlossen)
- [ ] offene Zahlungen (begonnen, nicht bestätigt)
- [ ] offene Rückgaben, Widerrufe, Erstattungen
- [ ] Kundenkonten, Gastkonten, Partner-/Werkstattkonten
- [ ] Kontaktanfragen und offene Werkstatt-/Terminanfragen
- [ ] verkaufte, noch nicht eingelöste Gutscheine

Hinweis: Ein Monitor sendet alle 15 Minuten Test-Anfragen an
`/api/auth/guest`, `/api/ai/chat` und `/api/contact/submit`. Diese Einträge
können in den Zählungen für Gastkonten und Kontaktanfragen enthalten sein.

- **Stop:** Es gibt offene Bestellungen oder Rückgaben, für die noch nicht
  feststeht, wer sie während der Offline-Zeit bearbeitet.
- Nicht belegt: Tabellen und Felder. Die Zahlen muss der Inhaber aus der
  Datenbank oder der Verwaltungsoberfläche ziehen.

### 2.6 Revolut-Händlerkonto
- [ ] Im Händlerkonto nachsehen: offene Zahlungen, laufende Erstattungen,
      offene Streitfälle (Disputes/Chargebacks). Anzahl notieren.
- [ ] Eingetragene Webhook-Adresse notieren. Der Regelblock reicht genau
      `POST /api/revolut/webhook` durch. Steht dort eine andere Adresse
      (anderer Pfad, `www`, Schrägstrich am Ende), kommt die Meldung im
      Offline-Zustand **nicht** an.
- **Stop:** Die eingetragene Adresse weicht ab. Dann zuerst
      `teileklar-offline.conf` anpassen und lokal neu testen.

### 2.7 Rechtsseiten und Supportkontakt (Inhaberentscheidung nötig, siehe Abschnitt 8)
Befund vom 22.11.2026 (per GET geprüft):

- `/impressum`, `/datenschutz`, `/agb`, `/widerruf` liefern Seiten mit dem
  Titel „… | NeXify AI". Das dortige Impressum nennt Telefon
  +31 6 38 12 71 86, eine Adresse unter nexifyai.cloud und richtet sich nur
  an Unternehmer.
- Das Impressum von TEILEKLAR (Firma „TEILEKLAR – ein Geschäftsbereich von
  NeXify AI by NeXify", `mail@teileklar.shop`, Telefon +31 6 133 188 56)
  steht **nur innerhalb der Shop-Startseite**. Diese Startseite gibt es im
  Offline-Zustand nicht mehr.
- `/versand` ist eine TEILEKLAR-Seite (Versand, Zahlung, Rückgabe).
- Die Rechtsseiten verlinken `/avv`, `/cookie`, `/ki-hinweise`,
  `/barrierefreiheit`, `/security`, `/status`, `/sla`. Diese Pfade stehen
  nicht auf der Allowlist und antworten im Offline-Zustand mit 503.

Deshalb nennt `offline.html` die Anbieterangaben aus dem Shop selbst und die
dort veröffentlichte Telefonnummer.

- [ ] Telefonnummer +31 6 133 188 56 anrufen: erreichbar und zugeordnet.
      Die Seite nennt sie „verifizierter Supportkontakt".
- [ ] Sprechzeit „Mo–Fr 09:00–18:00 Uhr (MEZ)" stimmt für die Offline-Zeit.
      Sonst die Zeile aus `offline.html` entfernen.
- [ ] Anbieterangaben in `offline.html` gegenlesen.
- [ ] Entscheiden, ob die vier NeXify-Rechtsseiten für die Offline-Zeit so
      bleiben (Abschnitt 8, Punkt 1).
- [ ] E-Mail: `mail@teileklar.shop` ist **nicht** auf der Seite. Die Domain
      hat keinen MX-Eintrag. Erst nach bestätigter Zustellung an der mit
      `SUPPORT-MAIL` markierten Stelle in `offline.html` einsetzen.
- **Stop:** Telefonnummer nicht erreichbar und kein anderer bestätigter Kontakt.

Kopien der Rechtsseiten erzeugen (nur bei Variante B, der Vorgabe im Regelblock).
Auf dem Server, direkt am Ursprung, nicht über Cloudflare – sonst enthält die
Kopie von Cloudflare umgeschriebene E-Mail-Verweise:
```bash
sudo mkdir -p /var/www/teileklar-offline/legal /var/www/teileklar-offline/.well-known
cd /var/www/teileklar-offline
for s in impressum datenschutz agb widerruf versand; do
  sudo curl -sS --fail --resolve teileklar.shop:443:127.0.0.1 -k \
       -o legal/$s.html https://teileklar.shop/$s
done
sudo curl -sS --fail --resolve teileklar.shop:443:127.0.0.1 -k \
     -o .well-known/security.txt https://teileklar.shop/.well-known/security.txt
grep -c '<title>' legal/*.html        # je Datei 1
sha256sum legal/*.html .well-known/security.txt
```
(`-k`: Das Zertifikat am Ursprung ist möglicherweise nur für Cloudflare gültig.
Die Verbindung bleibt auf dem Server selbst.)
- [ ] Jede Kopie im Browser oder mit `less` ansehen: vollständiger Text.
- **Stop:** Eine Kopie ist leer, eine Fehlerseite oder unvollständig.

### 2.8 Monitor und Zeitfenster
- [ ] Den 15-Minuten-Monitor für die Offline-Zeit pausieren oder auf die
      neue Erwartung umstellen (Abschnitt 6).
- [ ] Zeitfenster wählen, in dem kein Bezahlvorgang läuft (so gut es sich
      aus 2.5 und 2.6 erkennen lässt).

---

## 3. Ausführung

Kein Neustart des API-Dienstes. Keine Änderung an Daten, DNS, TLS oder Cloudflare.

**3.1 Dateien ablegen**
```bash
sudo mkdir -p /var/www/teileklar-offline
sudo cp offline.html sw.js robots.txt sitemap.xml /var/www/teileklar-offline/
sudo cp nginx/teileklar-offline.conf /etc/nginx/snippets/teileklar-offline.conf
sudo chmod -R a+rX /var/www/teileklar-offline
ls -la /var/www/teileklar-offline /var/www/teileklar-offline/legal /var/www/teileklar-offline/.well-known
```
Erwartet: `offline.html`, `sw.js`, `robots.txt`, `sitemap.xml`, fünf Dateien
in `legal/`, `security.txt` in `.well-known/`.

**3.2 Annahmen im Regelblock gegen die bisherige Konfiguration prüfen**
(Annahmen A1–A7 stehen am Anfang von `teileklar-offline.conf`.)
- [ ] A1: bisherige `proxy_pass`-Zeile für `/api/` – Adresse und Port
      (angenommen `http://127.0.0.1:8905`), kein abgeschnittenes Präfix.
- [ ] A2: bisherige `proxy_set_header`-Zeilen in den Webhook-Block übernehmen.
- [ ] A3: ein server-Block für beide Hostnamen oder zwei – dann in beiden einbinden.
- [ ] A4: `add_header`-Zeilen im server-Block (HSTS, CSP …)? Dann an den
      markierten Stellen wieder einbinden.
- [ ] A5: Wie wurden die Rechtsseiten bisher geliefert? Entscheidet zwischen
      Variante B (statische Kopie, Vorgabe) und Variante A (Durchreichen).

**3.3 Server-Block ändern** (Vorlage: `nginx/teileklar-offline.server.example.conf`)
1. Alle bisherigen `location`-Blöcke im server-Block für teileklar.shop
   auskommentieren. `listen`, `server_name`, `ssl_*` bleiben.
2. Diese drei Zeilen einfügen:
   ```nginx
   set $tk_offline_root  /var/www/teileklar-offline;
   set $tk_api_upstream  http://127.0.0.1:8905;
   include /etc/nginx/snippets/teileklar-offline.conf;
   ```

**3.4 Syntax prüfen**
```bash
sudo nginx -t
```
- **Stop bei jeder Fehlermeldung.** Es ist noch nichts aktiv. Typisch:
  „duplicate location" (ein alter location-Block steht noch),
  „unknown … variable" (eine der beiden `set`-Zeilen fehlt).
  Kommt keine Lösung zustande: gesicherte Datei zurückkopieren (Abschnitt 7).

**3.5 Aktivieren**
```bash
sudo nginx -s reload      # oder: sudo systemctl reload nginx   – kein restart
date -u                   # Zeitpunkt notieren
```

**3.6 Sofortprobe auf dem Server (am Ursprung, an Cloudflare vorbei)**
```bash
curl -sS -k -o /dev/null -w '%{http_code}\n' --resolve teileklar.shop:443:127.0.0.1 https://teileklar.shop/          # 200
curl -sS -k -o /dev/null -w '%{http_code}\n' --resolve teileklar.shop:443:127.0.0.1 https://teileklar.shop/shop      # 503
curl -sS -k -o /dev/null -w '%{http_code}\n' --resolve teileklar.shop:443:127.0.0.1 https://teileklar.shop/impressum # 200
```
Weicht ein Wert ab: Rückweg (Abschnitt 7).

---

## 4. Readback

Das Skript sendet nur GET, HEAD und OPTIONS und folgt keinen Weiterleitungen.

```bash
# von außen, über Cloudflare (maßgeblich für die Abnahme)
./pruefung/readback.sh --modus nachher | tee nachher-$(date -u +%Y-%m-%dT%H%MZ).txt

# auf dem Server, direkt am Ursprung
./pruefung/readback.sh --modus nachher --verbinde 127.0.0.1:443 --ohne-tls-pruefung \
  | tee nachher-ursprung-$(date -u +%Y-%m-%dT%H%MZ).txt
```
Rückgabewert 0 und `GESAMT: IM SOLL` = bestanden. Jede Zeile mit
`ABWEICHUNG` nennt den Grund. 73 Pfade × 2 Hostnamen × 3 Methoden = 438 Abrufe.

Das Skript prüft **nicht**:
- `POST /api/revolut/webhook` (es sendet kein POST). Nachweis: Im
  Revolut-Händlerkonto die Zustellung der nächsten echten Meldung ansehen
  (Status 2xx) oder im Zugriffsprotokoll von nginx die Zeile
  `POST /api/revolut/webhook` mit dem Status des Dienstes.
- den Inhalt der Rechtsseiten (nur: 200, nicht leer, nicht die Offline-Seite).
- ob der Ursprung von außen direkt erreichbar ist (Abschnitt 5).

Zusätzlich von Hand: teileklar.shop in einem Browser öffnen, der den Shop
schon einmal geladen hatte. Erwartet: Offline-Seite, auch nach erneutem Laden.

---

## 5. Alternative / Überbrückung: Cloudflare Worker

`cloudflare/worker.js` setzt dieselbe Allowlist am Rand um
(`wrangler.example.toml` als Vorlage). Unterschiede zu nginx:

- Rechtsseiten und `security.txt` holt der Worker unverändert vom Ursprung
  (entspricht Variante A). Offline-Seite, `robots.txt`, `sitemap.xml` und
  `sw.js` liefert er selbst.
- Der Webhook wird per `fetch` unverändert zum Ursprung gereicht.

**Der Worker allein erfüllt „serverseitig deaktiviert" nicht**, solange der
Ursprungsserver direkt erreichbar ist: Wer die Adresse des Servers kennt,
umgeht Cloudflare und erreicht den unveränderten Shop samt Bestellung.
Ob der Server nur Verbindungen von Cloudflare annimmt, ist **nicht belegt**.
Der Worker eignet sich als Überbrückung (schnell an- und abschaltbar) oder
als zweite Schicht vor dem nginx-Regelblock – nicht als Ersatz.

Vor einem Deploy durch den Inhaber:
```bash
cd cloudflare
node build-assets.mjs && node --test worker.test.mjs   # muss bestehen
wrangler deploy --dry-run
```
Nicht getestet: der Worker in der Cloudflare-Laufzeit (nur lokal mit Node).

---

## 6. Bekannte Folgewirkungen

- **Monitor:** Ein Monitor sendet alle 15 Minuten POST an `/api/auth/guest`,
  `/api/ai/chat` und `/api/contact/submit`. Nach dem Cutover erhält er 503
  und meldet Störung. Vorher pausieren oder umstellen (2.8).
- **Altpfade von nexifyai.de:** Verweise und Weiterleitungen von dort auf
  teileklar.shop enden auf der Offline-Seite (`/`) oder mit 503 (alle
  anderen Pfade). Welche Pfade das sind, wurde hier nicht erhoben.
- **Service-Worker-Cache:** Wiederkehrende Besucher haben den alten Service
  Worker (Cache `teileklar-v4`) im Browser. Er lädt Seiten zuerst aus dem
  Netz, sie sehen also die Offline-Seite. Der neue `sw.js` löscht die Caches
  und meldet den alten Worker ab – beim ersten Besuch nach dem Cutover,
  wenige Sekunden nach dem Laden, mit einem automatischen Neuladen. Wer die
  Seite nicht mehr besucht, behält den Cache, ohne dass er etwas bewirkt.
  Beim Wiederöffnen muss der Shop seinen Service Worker wieder ausliefern.
- **Installierte Web-App:** `/manifest.webmanifest` und die Icons antworten
  mit 503. Eine installierte App zeigt die Offline-Seite.
- **Suchmaschinen:** 503 mit `Retry-After` gilt als vorübergehend. Bleibt
  der Zustand länger bestehen, können Suchmaschinen die Adressen dennoch aus
  dem Index nehmen. Ab welcher Dauer, wurde hier nicht nachgeprüft. Die
  Startseite trägt `noindex` und fällt damit absehbar aus dem Index.
- **Sitemap:** Sie nennt `/`, obwohl `/` `noindex` trägt (Vorgabe: Start- und
  Rechtsseiten). Das ist widersprüchlich, aber unschädlich.
- **Rechtsseiten:** Verweise von dort auf `/avv`, `/cookie`, `/ki-hinweise`,
  `/barrierefreiheit`, `/security`, `/status`, `/sla` und auf die Stildateien
  unter `/assets/css/` antworten mit 503. Die Seiten bleiben lesbar (eigene
  Stilangaben im Dokument), sehen aber leicht anders aus.
- **Sicherheits-Header:** Heute trägt jede Antwort
  `Strict-Transport-Security` und weitere Header. Stammen sie aus
  `add_header`-Zeilen im server-Block, fehlen sie nach dem Cutover, bis sie
  an den markierten Stellen eingebunden sind (Annahme A4). Das Readback
  zählt Antworten ohne HSTS als Hinweis, nicht als Abweichung.
- **Hilfsadressen:** `/__tk_offline_503.html` und `/__tk_offline_503.json`
  sind intern. Von außen antworten sie mit 404, nicht mit 503.
- **Antworten des Dienstes auf den Webhook** gehen unverändert zurück. Fällt
  der Dienst aus, antwortet nginx mit 502/504; der Zahlungsdienst wiederholt
  nach seinen eigenen Regeln.
- **Laufende Sitzungen:** Angemeldete Kunden können ihr Konto nicht mehr
  aufrufen (`/konto`, `/api/account/data` → 503). Daten bleiben erhalten.
- **Zahlung in Arbeit:** Wer im Moment des Cutovers bezahlt, landet nach der
  Zahlung auf einer 503-Seite. Der Webhook kommt trotzdem an. Solche Fälle
  über 2.6 und die Bestandszählung nachhalten.

---

## 7. Rückweg

```bash
cd /root/tk-sicherung
sha256sum -c SHA256SUMS-<ZEIT>                       # Sicherung unverändert?
sudo tar -C / -xzf nginx-<ZEIT>.tar.gz               # stellt /etc/nginx wieder her
sudo nginx -t                                        # Stop bei Fehler
sudo nginx -s reload
```
Alternativ von Hand: die drei eingefügten Zeilen entfernen, die
auskommentierten `location`-Blöcke wieder aktivieren, `nginx -t`, `reload`.

Danach prüfen:
```bash
./pruefung/readback.sh --modus vorher > rueckweg.txt
diff <(awk '{print $1,$2,$3,$5}' pruefung/vorher-2026-11-22.txt | grep teileklar) \
     <(awk '{print $1,$2,$3,$5}' rueckweg.txt | grep teileklar) && echo "Status wie vorher"
```
- `/var/www/teileklar-offline` kann liegen bleiben; es wird nicht mehr ausgeliefert.
- Der Shop liefert danach wieder seinen eigenen `sw.js`.
- Monitor wieder einschalten.
- Kam der Worker zum Einsatz: Routen entfernen oder `wrangler delete`.

---

## 8. Entscheidungen, die nur der Inhaber treffen kann

1. **Rechtsseiten:** Bleiben `/impressum`, `/datenschutz`, `/agb`,
   `/widerruf` in der heutigen Fassung (NeXify AI, nur B2B, andere
   Telefonnummer) erreichbar, oder werden vorher TEILEKLAR-Fassungen
   hinterlegt? Mit Variante B genügt es, andere Dateien nach `legal/` zu legen.
2. **Supportkontakt:** Ist +31 6 133 188 56 der bestätigte Kontakt für
   bestehende Anliegen? Stimmt die Sprechzeit?
3. **Supportadresse/MX:** Wird für teileklar.shop Mailempfang eingerichtet
   (MX-Eintrag, SPF steht auf `-all`) und `mail@teileklar.shop` nach
   bestätigter Zustellung auf die Seite gesetzt?
4. **Weitere Pfade mit 200:** Sollen `/cookie`, `/barrierefreiheit`, `/avv`,
   `/ki-hinweise` zusätzlich erreichbar bleiben?
5. **Variante A oder B** für die Rechtsseiten.
6. **Zeitpunkt** des Cutovers und wer offene Bestellungen, Rückgaben und
   Streitfälle währenddessen bearbeitet.
7. **Information an Bestandskunden und Partner** (ob, wann, auf welchem Weg).
8. **Worker** als Überbrückung oder zweite Schicht: ja oder nein.
9. **Ursprungsschutz:** Soll der Server nur noch Verbindungen von Cloudflare annehmen?
10. **Monitor:** pausieren oder auf den Offline-Zustand umstellen.
11. **Öffentlich erreichbare Verwaltungsseiten** (`/myadmin`,
    `/myADMIN%20v2.dc.html`, `/Investoren-PowerPoint.dc.html`): Im
    Offline-Zustand gesperrt. Ob sie beim Wiederöffnen erneut öffentlich
    sein sollen, ist getrennt zu entscheiden.
12. **`Retry-After`:** 86400 Sekunden (1 Tag) ist die Vorgabe. Ein
    Wiederöffnungstermin wird nirgends genannt.

---

## 9. Was NICHT belegt ist

- Die echte nginx-Konfiguration des Servers (Aufbau, Anzahl der
  server-Blöcke, bisherige `location`- und `proxy_*`-Zeilen, Herkunft der
  Sicherheits-Header). Annahmen A1–A7 im Regelblock.
- Ob die Rechtsseiten vom API-Dienst oder aus Dateien kommen.
- Quellcode, Datenbank und Datenmodell des API-Dienstes.
- Ob der Dienst unter Port 8905 den Webhook-Pfad genau so erwartet, und
  welche Adresse bei Revolut eingetragen ist.
- Ob der Ursprungsserver an Cloudflare vorbei erreichbar ist.
- Ob sich ein Hostinger-Backup wiederherstellen lässt; ob es einen eigenen
  Datenbank-Dump gibt.
- Zustellbarkeit von `mail@teileklar.shop` (kein MX-Eintrag).
- Erreichbarkeit der Telefonnummer +31 6 133 188 56 (nur als veröffentlicht belegt).
- Wie Cloudflare 503-Antworten des Ursprungs an Besucher weitergibt
  (zeigt sich erst im Readback über Cloudflare).
- Verhalten des Abschalt-Service-Workers außerhalb von Chromium.
- Verhalten des Regelblocks unter nginx 1.28.3 (getestet mit 1.24.0).
- Markenfarben und -schrift von TEILEKLAR: Die Shop-Startseite verwendet
  `#0E1315`/`#C8F04B` mit Archivo und IBM Plex Mono; dieselben Farben sind im
  Quelltext der Rechtsseiten als „Hausfarben von www.nexifyai.cloud"
  bezeichnet. `/versand` verwendet andere Farben (`#7BD64B`/`#3E7C1E`).
  Ein eindeutiger eigener Markenwert ließ sich nicht belegen. Die
  Offline-Seite ist deshalb neutral: Schwarz/Weiß, Systemschrift.

---

## 10. Abnahmekriterien für `OFFLINE_VERIFIZIERT`

Alle Punkte müssen mit Datum, Uhrzeit (UTC) und Beleg erfüllt sein:

1. Abschnitt 2 vollständig abgehakt; Sicherungen mit Prüfsummen liegen
   außerhalb des Servers.
2. `readback.sh --modus nachher` über Cloudflare: Rückgabewert 0, Ausgabe abgelegt.
3. `readback.sh --modus nachher --verbinde …` direkt am Ursprung:
   Rückgabewert 0, Ausgabe abgelegt.
4. Eine echte Webhook-Zustellung von Revolut nach dem Cutover wurde vom
   Dienst angenommen (Händlerkonto oder nginx-Protokoll) – oder es ist
   festgehalten, dass seit dem Cutover keine anfiel.
5. Bestandszählung nach dem Cutover wiederholt: keine neue Bestellung, kein
   neues Konto, keine neue Anfrage seit dem Zeitpunkt aus 3.5; keine Zahl
   ist gesunken.
6. Offline-Seite im Browser gesehen (Handy und Rechner), mit einem Browser,
   der den Shop vorher geladen hatte; Telefonlink wählt die richtige Nummer.
7. Die fünf Rechtsseiten im Browser gelesen: vollständig und zutreffend.
8. Monitor pausiert oder umgestellt.
9. Rückweg benannt: Pfad der Sicherung und Prüfsumme stehen im Protokoll.

Bis dahin bleibt der Status `OFFLINE_VORBEREITET`.

---

## 11. Was vor der Übergabe getestet wurde (22.11.2026)

| Test | Ergebnis |
|---|---|
| `nginx -t` mit dem Regelblock, Variante B und A (nginx 1.24.0, lokal) | bestanden |
| `nginx/test/lokaltest.sh`: lokales nginx + Attrappe als Dienst; 438 lesende Abrufe über `readback.sh`, schreibende Anfragen (POST/PUT/DELETE, nur gegen 127.0.0.1), Ausfall des Dienstes, Variante A | 42 von 42 Prüfungen bestanden – `nginx/test/ergebnis-2026-11-22.txt` |
| `node --test cloudflare/worker.test.mjs` | 10 von 10 bestanden |
| `pruefung/sw-lokaltest.mjs` (Chromium), auch mit einer Kopie des bisherigen `sw.js` | 8 von 8 bestanden |
| `offline.html` bei 320 px und 1280 px, dunkles Farbschema, doppelte Schriftgröße, Tastaturfokus | kein waagrechter Überlauf, keine externe Anfrage |
| `readback.sh --modus vorher` gegen teileklar.shop | 438 Abrufe, 374 Abweichungen vom Offline-Soll (erwartet: Shop online) – `pruefung/vorher-2026-11-22.txt` |

Nicht getestet: alles auf dem Server, Cloudflare, die echte Zustellung eines
Webhooks, andere Browser als Chromium, Screenreader.
