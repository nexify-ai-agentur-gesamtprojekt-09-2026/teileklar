#!/usr/bin/env bash
# =============================================================================
# TEILEKLAR.shop – Readback: Ist-Status gegen Offline-Soll
# =============================================================================
# Ruft für jeden Host jeden Pfad aus pfade.tsv mit GET, HEAD und OPTIONS ab und
# vergleicht Status und Kopfzeilen mit dem Soll des Offline-Zustands.
#
# Dieses Skript sendet ausschließlich GET, HEAD und OPTIONS. Es sendet keine
# Formulare, keine Anmeldung, keine Bestellung und KEIN POST – auch nicht an
# den Webhook-Pfad. Es folgt keinen Weiterleitungen.
#
# Aufruf:
#   ./readback.sh --modus nachher            Abnahme nach dem Cutover
#   ./readback.sh --modus vorher             Vergleichsstand vor dem Cutover
#                                            (Abweichungen sind dann erwartet)
# Optionen:
#   --hosts "a b"          Hostnamen (Vorgabe: teileklar.shop www.teileklar.shop)
#   --pfade DATEI          Pfadliste (Vorgabe: pfade.tsv neben diesem Skript)
#   --schema http|https    Vorgabe: https
#   --verbinde HOST:PORT   Verbindung an diese Adresse statt per DNS (z. B. auf
#                          dem Server direkt am Ursprung, an Cloudflare vorbei)
#   --ohne-tls-pruefung    nur zusammen mit --verbinde: Zertifikat nicht prüfen
#                          (Ursprungszertifikat ist ggf. nur für Cloudflare gültig)
#   --pause SEKUNDEN       Pause zwischen Abrufen (Vorgabe: 0.1)
#   --zeitlimit SEKUNDEN   Zeitlimit je Abruf (Vorgabe: 40)
#
# Ausgabe: Tabelle auf der Standardausgabe. Rückgabewert 0 = alles im Soll,
# 1 = mindestens eine Abweichung, 2 = Aufruffehler.
# =============================================================================
set -u

MODUS="nachher"
HOSTS="teileklar.shop www.teileklar.shop"
SKRIPTORDNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PFADDATEI="$SKRIPTORDNER/pfade.tsv"
SCHEMA="https"
VERBINDE=""
OHNE_TLS=0
PAUSE="0.1"
ZEITLIMIT="40"

SOLL_RETRY_AFTER="86400"
MERKMAL_OFFLINE_SEITE="vorübergehend nicht verfügbar"

while [ $# -gt 0 ]; do
  case "$1" in
    --modus)             MODUS="${2:-}"; shift 2 ;;
    --hosts)             HOSTS="${2:-}"; shift 2 ;;
    --pfade)             PFADDATEI="${2:-}"; shift 2 ;;
    --schema)            SCHEMA="${2:-}"; shift 2 ;;
    --verbinde)          VERBINDE="${2:-}"; shift 2 ;;
    --ohne-tls-pruefung) OHNE_TLS=1; shift ;;
    --pause)             PAUSE="${2:-}"; shift 2 ;;
    --zeitlimit)         ZEITLIMIT="${2:-}"; shift 2 ;;
    -h|--hilfe|--help)   sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

case "$MODUS" in vorher|nachher) ;; *) echo "--modus muss vorher oder nachher sein" >&2; exit 2 ;; esac
case "$SCHEMA" in http|https) ;; *) echo "--schema muss http oder https sein" >&2; exit 2 ;; esac
[ -r "$PFADDATEI" ] || { echo "Pfadliste nicht lesbar: $PFADDATEI" >&2; exit 2; }
if [ "$OHNE_TLS" = 1 ] && [ -z "$VERBINDE" ]; then
  echo "--ohne-tls-pruefung ist nur zusammen mit --verbinde erlaubt" >&2; exit 2
fi
command -v curl >/dev/null 2>&1 || { echo "curl fehlt" >&2; exit 2; }

CURL_ZUSATZ=()
if [ -n "$VERBINDE" ]; then
  # Jede Verbindung geht an HOST:PORT; Hostname und Pfad der Anfrage bleiben gleich.
  CURL_ZUSATZ+=(--connect-to "::$VERBINDE" --noproxy '*')
  [ "$OHNE_TLS" = 1 ] && CURL_ZUSATZ+=(--insecure)
fi

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

ANZAHL=0
ABWEICHUNGEN=0
FEHLENDE_HSTS=0

# Liest die Kopfzeilen der LETZTEN Antwort aus der Kopfdatei (davor kann der
# Block eines Proxys stehen) und setzt die Variablen IST_*.
lies_kopf() {
  IST_STATUS=""; IST_RETRY=""; IST_ROBOTS=""; IST_CACHE=""; IST_LOCATION=""; IST_TYP=""; IST_HSTS=""
  local zeile name wert
  while IFS= read -r zeile || [ -n "$zeile" ]; do
    zeile="${zeile%$'\r'}"
    if [[ "$zeile" =~ ^HTTP/[0-9.]+[[:space:]]+([0-9]{3}) ]]; then
      IST_STATUS="${BASH_REMATCH[1]}"
      IST_RETRY=""; IST_ROBOTS=""; IST_CACHE=""; IST_LOCATION=""; IST_TYP=""; IST_HSTS=""
      continue
    fi
    case "$zeile" in *:*) ;; *) continue ;; esac
    name="${zeile%%:*}"; wert="${zeile#*:}"
    wert="${wert#"${wert%%[![:space:]]*}"}"
    case "${name,,}" in
      retry-after)               IST_RETRY="$wert" ;;
      x-robots-tag)              IST_ROBOTS="${IST_ROBOTS:+$IST_ROBOTS; }$wert" ;;
      cache-control)             IST_CACHE="${IST_CACHE:+$IST_CACHE, }$wert" ;;
      location)                  IST_LOCATION="$wert" ;;
      content-type)              IST_TYP="$wert" ;;
      strict-transport-security) IST_HSTS="$wert" ;;
    esac
  done < "$1"
}

# Prüft eine Antwort gegen das Soll "503 des Offline-Zustands".
pruefe_503() {
  [ "$IST_STATUS" = "503" ] || GRUND+="Status ${IST_STATUS:-?} statt 503; "
  [ "$IST_RETRY" = "$SOLL_RETRY_AFTER" ] || GRUND+="Retry-After '${IST_RETRY}' statt $SOLL_RETRY_AFTER; "
  case "${IST_ROBOTS,,}" in *noindex*) ;; *) GRUND+="X-Robots-Tag ohne noindex; " ;; esac
  case "${IST_CACHE,,}" in *no-store*) ;; *) GRUND+="Cache-Control ohne no-store; " ;; esac
}

pruefe() { # $1=Host $2=Methode $3=Klasse $4=Pfad
  local host="$1" methode="$2" klasse="$3" pfad="$4"
  local kopf="$ARBEIT/kopf" koerper="$ARBEIT/koerper" soll rc
  local -a methodenargs=()
  case "$methode" in
    GET)     methodenargs=() ;;
    HEAD)    methodenargs=(--head) ;;
    OPTIONS) methodenargs=(-X OPTIONS) ;;
    *) echo "Nicht erlaubte Methode: $methode" >&2; exit 2 ;;
  esac
  : > "$kopf"; : > "$koerper"
  curl -sS --max-time "$ZEITLIMIT" -o "$koerper" -D "$kopf" \
       "${methodenargs[@]}" "${CURL_ZUSATZ[@]}" "$SCHEMA://$host$pfad" 2> "$ARBEIT/fehler"
  rc=$?
  lies_kopf "$kopf"
  GRUND=""
  if [ "$rc" -ne 0 ]; then
    IST_STATUS="ERR"
    GRUND+="curl-Fehler $rc ($(tr '\n' ' ' < "$ARBEIT/fehler" | cut -c1-80)); "
  fi

  local lesend=0
  case "$methode" in GET|HEAD) lesend=1 ;; esac

  case "$klasse" in
    SEITE)
      if [ "$lesend" = 1 ]; then
        soll="200"
        [ "$IST_STATUS" = "200" ] || GRUND+="Status ${IST_STATUS:-?} statt 200; "
        case "${IST_ROBOTS,,}" in *noindex*) ;; *) GRUND+="X-Robots-Tag ohne noindex; " ;; esac
        case "${IST_CACHE,,}" in *no-store*) ;; *) GRUND+="Cache-Control ohne no-store; " ;; esac
        if [ "$methode" = GET ] && ! grep -q "$MERKMAL_OFFLINE_SEITE" "$koerper"; then
          GRUND+="Inhalt ist nicht die Offline-Seite; "
        fi
      else
        soll="503"; pruefe_503
      fi ;;
    RECHT|STATISCH)
      if [ "$lesend" = 1 ]; then
        soll="200"
        [ "$IST_STATUS" = "200" ] || GRUND+="Status ${IST_STATUS:-?} statt 200; "
        if [ "$methode" = GET ] && [ ! -s "$koerper" ]; then GRUND+="leerer Inhalt; "; fi
        if [ "$methode" = GET ] && [ "$klasse" = RECHT ] && grep -q "$MERKMAL_OFFLINE_SEITE" "$koerper"; then
          GRUND+="Inhalt ist die Offline-Seite statt der Rechtsseite; "
        fi
      else
        soll="503"; pruefe_503
      fi ;;
    ICON)
      if [ "$lesend" = 1 ]; then
        soll="200"
        [ "$IST_STATUS" = "200" ] || GRUND+="Status ${IST_STATUS:-?} statt 200; "
        case "${IST_TYP,,}" in image/svg+xml*) ;; *) GRUND+="Content-Type '${IST_TYP}' statt image/svg+xml; " ;; esac
        if [ "$methode" = GET ] && ! grep -q '<svg' "$koerper"; then GRUND+="Inhalt ist kein SVG; "; fi
      else
        soll="503"; pruefe_503
      fi ;;
    SCHRIFT|OGBILD)
      if [ "$lesend" = 1 ]; then
        soll="200"
        [ "$IST_STATUS" = "200" ] || GRUND+="Status ${IST_STATUS:-?} statt 200; "
        local typ="font/woff2"; [ "$klasse" = OGBILD ] && typ="image/jpeg"
        case "${IST_TYP,,}" in "$typ"*) ;; *) GRUND+="Content-Type '${IST_TYP}' statt $typ; " ;; esac
        if [ "$methode" = GET ] && [ ! -s "$koerper" ]; then GRUND+="leerer Inhalt; "; fi
      else
        soll="503"; pruefe_503
      fi ;;
    KEIN404)
      if [ "$lesend" = 1 ]; then
        soll="404"
        [ "$IST_STATUS" = "404" ] || GRUND+="Status ${IST_STATUS:-?} statt 404; "
      else
        soll="503"; pruefe_503
      fi ;;
    WEBHOOK|API503)
      soll="503"; pruefe_503
      if [ "$methode" = GET ]; then
        case "${IST_TYP,,}" in application/json*) ;; *) GRUND+="Content-Type '${IST_TYP}' statt application/json; " ;; esac
      fi ;;
    HTML503)
      soll="503"; pruefe_503
      if [ "$methode" = GET ] && ! grep -q "$MERKMAL_OFFLINE_SEITE" "$koerper"; then
        GRUND+="Inhalt ist nicht die Offline-Seite; "
      fi ;;
    *) echo "Unbekannte Klasse in der Pfadliste: $klasse" >&2; exit 2 ;;
  esac
  [ -z "$IST_LOCATION" ] || GRUND+="Location-Kopfzeile vorhanden ($IST_LOCATION); "

  local ergebnis="OK"
  ANZAHL=$((ANZAHL + 1))
  if [ -n "$GRUND" ]; then
    ergebnis="ABWEICHUNG: ${GRUND%; }"
    ABWEICHUNGEN=$((ABWEICHUNGEN + 1))
  fi
  local hsts="ja"
  if [ -z "$IST_HSTS" ]; then hsts="nein"; FEHLENDE_HSTS=$((FEHLENDE_HSTS + 1)); fi

  printf '%-19s %-7s %-31s %-8s %-4s %-4s %-6s %-16s %-10s %-4s %s\n' \
    "$host" "$methode" "$pfad" "$klasse" "${IST_STATUS:--}" "$soll" \
    "${IST_RETRY:--}" "$(printf '%s' "${IST_ROBOTS:--}" | cut -c1-16)" \
    "$(printf '%s' "${IST_CACHE:--}" | cut -c1-10)" "$hsts" "$ergebnis"
}

echo "TEILEKLAR.shop – Readback gegen das Offline-Soll"
echo "Modus:      $MODUS$([ "$MODUS" = vorher ] && echo ' (Vergleichsstand VOR dem Cutover; Abweichungen vom Offline-Soll sind erwartet)')"
echo "Beginn UTC: $(date -u '+%Y-%m-%d %H:%M:%S')"
echo "Hosts:      $HOSTS"
echo "Schema:     $SCHEMA${VERBINDE:+   Verbindung an: $VERBINDE}$([ "$OHNE_TLS" = 1 ] && echo '   (ohne TLS-Prüfung)')"
echo "Pfadliste:  $(basename "$PFADDATEI") ($(grep -c -v -e '^#' -e '^[[:space:]]*$' "$PFADDATEI") Pfade)"
echo "Methoden:   GET HEAD OPTIONS (kein POST, keine Weiterleitungen)"
echo
printf '%-19s %-7s %-31s %-8s %-4s %-4s %-6s %-16s %-10s %-4s %s\n' \
  "HOST" "METHODE" "PFAD" "KLASSE" "IST" "SOLL" "RETRY" "X-ROBOTS-TAG" "CACHE-CTRL" "HSTS" "ERGEBNIS"

for host in $HOSTS; do
  while IFS=$'\t' read -r klasse pfad || [ -n "${klasse:-}" ]; do
    case "$klasse" in ''|\#*) continue ;; esac
    for methode in GET HEAD OPTIONS; do
      pruefe "$host" "$methode" "$klasse" "$pfad"
      sleep "$PAUSE"
    done
  done < "$PFADDATEI"
done

echo
echo "Ende UTC:     $(date -u '+%Y-%m-%d %H:%M:%S')"
echo "Abrufe:       $ANZAHL"
echo "Abweichungen: $ABWEICHUNGEN"
echo "Hinweis:      $FEHLENDE_HSTS Antworten ohne Strict-Transport-Security (kein Abnahmekriterium, siehe RUNBOOK Abschnitt 6)"
echo "Nicht geprüft: POST an /api/revolut/webhook (dieses Skript sendet kein POST)"
if [ "$ABWEICHUNGEN" -eq 0 ]; then
  echo "GESAMT:       IM SOLL"
  exit 0
fi
if [ "$MODUS" = vorher ]; then
  echo "GESAMT:       ABWEICHUNGEN (im Modus vorher erwartet: der Shop ist noch online)"
else
  echo "GESAMT:       ABWEICHUNGEN – Offline-Zustand NICHT abgenommen"
fi
exit 1
