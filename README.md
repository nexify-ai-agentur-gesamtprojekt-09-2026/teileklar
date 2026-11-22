# Teileklar

Dieses Repository enthält das Teileklar-Projekt.

Kurzbeschreibung

- Status: initialisiert
- Owner: nexifyai-dev

Schnellstart

1. Klone das Repo:

   git clone https://github.com/nexifyai-dev/teileklar.git

2. Lies die Dokumentation in diesem README und leg Issues/PRs an, wenn du Beiträge leisten möchtest.

Contributing

Beiträge sind willkommen. Bitte eröffne ein Issue oder erstelle einen Pull Request. Nutze die Vorlagen in .github/ISSUE_TEMPLATE und .github/PULL_REQUEST_TEMPLATE.

License

Dieses Projekt steht unter der MIT-Lizenz — siehe LICENSE.

Offline-Paket (TEILEKLAR.shop vorübergehend offline)

- Status: OFFLINE_VORBEREITET – aus diesem Repository wurde kein Cutover und kein Deploy ausgeführt. Beobachtung per GET am 22.11.2026, 19:14 UTC: teileklar.shop zeigt die Coming-Soon-Seite über einen Cloudflare Worker, der außerhalb dieses Repositorys geschaltet wurde; die Sperre am Ursprungsserver (nginx) ist nicht belegt.
- Anleitung für den Inhaber: [offline/RUNBOOK.md](offline/RUNBOOK.md)
- Inhalt: Coming-Soon-Seite im Erscheinungsbild des Shops (`offline/offline.html`) mit eigenem Icon (`offline/favicon.svg`), selbst gehosteten Markenschriften (`offline/fonts/`, OFL) und eigenem Vorschaubild (`offline/og.jpg`), Abschalt-Service-Worker, robots.txt und Sitemap, nginx-Regelblock (Allowlist), Cloudflare-Worker als Alternative (auch als einzelne Datei `offline/cloudflare/dist/worker.bundle.mjs`), Prüfskript mit Vergleichsstand vom 22.11.2026.
