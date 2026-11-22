#!/usr/bin/env bash
# =============================================================================
# Lokaler Test des Regelblocks teileklar-offline.conf – NUR auf einem Testrechner.
# =============================================================================
# Startet ein eigenes nginx auf 127.0.0.1 (eigener Port, eigenes Verzeichnis)
# und eine Attrappe für den API-Dienst. Prüft:
#   1. Syntax ("nginx -t") für Variante B (statische Rechtsseiten) und Variante A
#   2. alle Pfade aus pruefung/pfade.tsv mit GET/HEAD/OPTIONS (über readback.sh)
#   3. schreibende Methoden (POST/PUT/DELETE) – ausschließlich gegen 127.0.0.1
#   4. Verhalten, wenn der Dienst nicht antwortet
#
# Dieses Skript fasst weder /etc/nginx noch einen laufenden nginx an und sendet
# nichts an teileklar.shop.
#
# Aufruf: ./lokaltest.sh [ARBEITSVERZEICHNIS]
# =============================================================================
set -u

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFLINE="$(cd "$HIER/../.." && pwd)"
ARBEIT="${1:-$(mktemp -d)}"
NGINX_PORT=18080
DIENST_PORT=18905
BASIS="http://127.0.0.1:$NGINX_PORT"

command -v nginx >/dev/null || { echo "nginx fehlt – Syntax nicht geprüft"; exit 2; }
command -v node  >/dev/null || { echo "node fehlt"; exit 2; }

mkdir -p "$ARBEIT/webroot/legal" "$ARBEIT/webroot/.well-known" "$ARBEIT/logs" "$ARBEIT/tmp"
cp "$OFFLINE/offline.html" "$OFFLINE/sw.js" "$OFFLINE/favicon.svg" "$OFFLINE/robots.txt" "$OFFLINE/sitemap.xml" "$ARBEIT/webroot/"
for name in impressum datenschutz agb widerruf versand; do
  printf '<!doctype html><html lang="de"><title>Testkopie %s</title><p>Testkopie der Rechtsseite %s</p></html>\n' "$name" "$name" \
    > "$ARBEIT/webroot/legal/$name.html"
done
printf 'Contact: mailto:test@example.invalid\n' > "$ARBEIT/webroot/.well-known/security.txt"

# Variante A aus der Originaldatei ableiten: B-Zeilen auskommentieren, A-Zeilen aktivieren.
awk '
  /--- Variante B: statische Kopie ---/ { modus = "B"; print; next }
  /--- Variante A: Durchreichen/        { modus = "A"; print; next }
  modus == "B" && NF > 0 && $1 !~ /^#/  { print "    # " $0; next }
  modus == "A" && /^}/                  { modus = ""; print; next }
  modus == "A" && /^    # /             { sub(/^    # /, "    "); print; next }
  { print }
' "$OFFLINE/nginx/teileklar-offline.conf" > "$ARBEIT/teileklar-offline.variante-a.conf"

schreibe_konfiguration() { # $1 = einzubindende Datei
  cat > "$ARBEIT/nginx.conf" <<EOF
# Nur für den lokalen Test erzeugt.
user root;
worker_processes 1;
pid $ARBEIT/nginx.pid;
error_log $ARBEIT/logs/error.log warn;
events { worker_connections 64; }
http {
    include /etc/nginx/mime.types;
    access_log $ARBEIT/logs/access.log;
    client_body_temp_path $ARBEIT/tmp/body;
    proxy_temp_path $ARBEIT/tmp/proxy;
    fastcgi_temp_path $ARBEIT/tmp/fastcgi;
    uwsgi_temp_path $ARBEIT/tmp/uwsgi;
    scgi_temp_path $ARBEIT/tmp/scgi;
    server {
        listen 127.0.0.1:$NGINX_PORT;
        server_name teileklar.shop www.teileklar.shop;
        set \$tk_offline_root $ARBEIT/webroot;
        set \$tk_api_upstream http://127.0.0.1:$DIENST_PORT;
        include $1;
    }
}
EOF
}

FEHLER=0
ok()     { printf 'OK      %s\n' "$1"; }
fehler() { printf 'FEHLER  %s\n' "$1"; FEHLER=$((FEHLER + 1)); }

# Erwartet Status (und optional einen Text im Inhalt / in den Kopfzeilen).
anfrage() { # $1=Beschreibung $2=Soll-Status $3=Methode $4=Pfad [$5=Text im Inhalt] [$6=Text in Kopfzeilen]
  local kopf="$ARBEIT/tmp/kopf" koerper="$ARBEIT/tmp/koerper" status
  status="$(curl -sS --noproxy '*' --max-time 10 -o "$koerper" -D "$kopf" -X "$3" \
            -H 'Host: teileklar.shop' -H 'Revolut-Signature: v1=testsignatur' \
            --data-binary '{"event":"TEST","id":"lokal-1"}' -H 'Content-Type: application/json' \
            -w '%{http_code}' "$BASIS$4")"
  local text="$3 $4 -> $status (Soll $2) – $1"
  if [ "$status" != "$2" ]; then fehler "$text"; return; fi
  if [ -n "${5:-}" ] && ! grep -q -- "$5" "$koerper"; then fehler "$text – Inhalt ohne '$5'"; return; fi
  if [ -n "${6:-}" ] && ! grep -q -i -- "$6" "$kopf"; then fehler "$text – Kopfzeilen ohne '$6'"; return; fi
  ok "$text"
}

beim_dienst() { [ -f "$ARBEIT/dienst.log" ] && wc -l < "$ARBEIT/dienst.log" || echo 0; }

stoppe() {
  [ -f "$ARBEIT/nginx.pid" ] && nginx -c "$ARBEIT/nginx.conf" -s stop 2>/dev/null
  [ -n "${DIENST_PID:-}" ] && kill "$DIENST_PID" 2>/dev/null
  sleep 0.5
}
trap stoppe EXIT

echo "Lokaler Test des nginx-Regelblocks – $(date -u '+%Y-%m-%d %H:%M:%S') UTC"
echo "nginx: $(nginx -v 2>&1)"
echo "Arbeitsverzeichnis: $ARBEIT"
echo

echo "== 1. Syntax =="
schreibe_konfiguration "$ARBEIT/teileklar-offline.variante-a.conf"
if nginx -t -c "$ARBEIT/nginx.conf" 2> "$ARBEIT/tmp/t-a"; then ok "nginx -t Variante A (Durchreichen)"; else fehler "nginx -t Variante A: $(cat "$ARBEIT/tmp/t-a")"; fi
schreibe_konfiguration "$OFFLINE/nginx/teileklar-offline.conf"
if nginx -t -c "$ARBEIT/nginx.conf" 2> "$ARBEIT/tmp/t-b"; then ok "nginx -t Variante B (statische Kopien, Originaldatei unverändert)"; else fehler "nginx -t Variante B: $(cat "$ARBEIT/tmp/t-b")"; fi
echo

: > "$ARBEIT/dienst.log"
node "$HIER/dummy-upstream.mjs" "$DIENST_PORT" "$ARBEIT/dienst.log" &
DIENST_PID=$!
nginx -c "$ARBEIT/nginx.conf" || { echo "nginx startet nicht"; exit 2; }
sleep 1

echo "== 2. Lesende Methoden, Variante B (readback.sh, beide Hostnamen) =="
"$OFFLINE/pruefung/readback.sh" --modus nachher --schema http --verbinde "127.0.0.1:$NGINX_PORT" --pause 0
RB=$?
if [ "$RB" -eq 0 ]; then ok "readback.sh: alle Pfade im Soll"; else fehler "readback.sh meldet Abweichungen (Rückgabewert $RB)"; fi
if [ "$(beim_dienst)" -eq 0 ]; then ok "Beim Dienst kam durch GET/HEAD/OPTIONS nichts an"; else fehler "Beim Dienst kamen $(beim_dienst) lesende Anfragen an"; fi
echo

echo "== 3. Schreibende Methoden (nur 127.0.0.1) =="
anfrage "Webhook wird durchgereicht, Inhalt unverändert" 200 POST /api/revolut/webhook '\\"event\\":\\"TEST\\"' 'x-attrappe: 1'
anfrage "Webhook: Signatur-Kopfzeile kommt an"           200 POST /api/revolut/webhook 'v1=testsignatur'
anfrage "Webhook: Pfad und Abfrageteil unverändert"      200 POST '/api/revolut/webhook?probe=1' '"url":"/api/revolut/webhook?probe=1"'
anfrage "Webhook: Hostname wird weitergegeben"           200 POST /api/revolut/webhook '"host":"teileklar.shop"'
VORHER="$(beim_dienst)"
for pfad in /api/orders/create /api/auth/login /api/auth/register /api/auth/verify /api/auth/callback \
            /api/auth/guest /api/contact/submit /api/ai/chat /api/revolut/webhook/ /api/revolut/webhookx; do
  anfrage "gesperrt, JSON" 503 POST "$pfad" 'service_unavailable' 'retry-after: 86400'
done
anfrage "Webhook mit PUT gesperrt"    503 PUT    /api/revolut/webhook 'service_unavailable' 'retry-after: 86400'
anfrage "Webhook mit DELETE gesperrt" 503 DELETE /api/revolut/webhook 'service_unavailable' 'retry-after: 86400'
for pfad in / /impressum /shop /konto /partner-werden /werkstatt-partner /myadmin /sw.js /robots.txt; do
  anfrage "gesperrt, Offline-Seite" 503 POST "$pfad" 'vorübergehend nicht verfügbar' 'retry-after: 86400'
done
anfrage "Icon mit POST gesperrt" 503 POST /favicon.ico 'vorübergehend nicht verfügbar' 'retry-after: 86400'
anfrage "Icon: Cache-Control" 200 GET /favicon.ico '<svg' 'cache-control: public, max-age=86400'
anfrage "Kopfzeile X-Robots-Tag bei 503"  503 POST /shop '' 'x-robots-tag: noindex'
anfrage "Kopfzeile Cache-Control bei 503" 503 POST /shop '' 'cache-control: no-store'
anfrage "interne Hilfsadresse ist von außen nicht abrufbar (404)" 404 GET /__tk_offline_503.html
anfrage "interne Hilfsadresse ist von außen nicht abrufbar (404)" 404 GET /__tk_offline_503.json
if [ "$(beim_dienst)" -eq "$VORHER" ]; then ok "Beim Dienst kamen nur die 4 Webhook-Zustellungen an ($VORHER)"; else fehler "Beim Dienst kamen gesperrte Anfragen an"; fi
echo

echo "== 4. Dienst antwortet nicht =="
kill "$DIENST_PID" 2>/dev/null; DIENST_PID=""; sleep 0.5
anfrage "Webhook bei ausgefallenem Dienst: 502, damit der Zahlungsdienst wiederholt" 502 POST /api/revolut/webhook
anfrage "Offline-Seite bleibt erreichbar" 200 GET / 'vorübergehend nicht verfügbar'
anfrage "Rechtsseite bleibt erreichbar (Variante B)" 200 GET /impressum 'Testkopie'
echo

echo "== 5. Variante A (Durchreichen der Rechtsseiten) =="
: > "$ARBEIT/dienst.log"
node "$HIER/dummy-upstream.mjs" "$DIENST_PORT" "$ARBEIT/dienst.log" &
DIENST_PID=$!
schreibe_konfiguration "$ARBEIT/teileklar-offline.variante-a.conf"
nginx -c "$ARBEIT/nginx.conf" -s reload; sleep 1
anfrage "Rechtsseite kommt vom Dienst" 200 GET /impressum '"url":"/impressum"' 'x-attrappe: 1'
anfrage "Rechtsseite mit POST gesperrt" 503 POST /impressum 'vorübergehend nicht verfügbar'
anfrage "Shop bleibt gesperrt" 503 GET /shop 'vorübergehend nicht verfügbar'
anfrage "API bleibt gesperrt" 503 GET /api/shop/products 'service_unavailable'
if [ "$(beim_dienst)" -eq 1 ]; then ok "Beim Dienst kam genau 1 Anfrage an (/impressum)"; else fehler "Beim Dienst kamen $(beim_dienst) Anfragen an (Soll 1)"; fi
echo

echo "Fehlerprotokoll nginx (warn und höher): $(wc -l < "$ARBEIT/logs/error.log") Zeilen"
sed 's/^/  /' "$ARBEIT/logs/error.log" | cut -c1-220 | head -20
echo
if [ "$FEHLER" -eq 0 ]; then echo "GESAMT: BESTANDEN"; exit 0; fi
echo "GESAMT: $FEHLER FEHLER"; exit 1
