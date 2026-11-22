// ERZEUGT von build-bundle.mjs aus worker.js und den Dateien in offline/ – nicht von Hand ändern.
// =============================================================================
// TEILEKLAR.shop – Coming-Soon-Zustand am Rand (Cloudflare Worker)
// =============================================================================
// ALTERNATIVE / ÜBERBRÜCKUNG zum nginx-Regelblock, mit derselben Allowlist.
//
// WICHTIG: Dieser Worker allein erfüllt die Vorgabe "serverseitig deaktiviert"
// NICHT, solange der Ursprungsserver direkt (an Cloudflare vorbei) erreichbar
// ist. Er sperrt nur Anfragen, die über Cloudflare kommen. Siehe RUNBOOK,
// Abschnitt 5.
//
// Verhalten:
//   GET/HEAD  /                                   200 Coming-Soon-Seite
//   GET/HEAD  /sw.js und /<markt>/sw.js           200 Abschalt-Service-Worker
//   GET/HEAD  /impressum /datenschutz /agb /widerruf /versand
//             /robots.txt /sitemap.xml /.well-known/security.txt
//                                                 unverändert vom Ursprung
//   POST      /api/revolut/webhook                unverändert zum Ursprung
//   alles andere unter /api/                      503 JSON
//   alles andere                                  503 Coming-Soon-Seite
//
// Fehlerverhalten (fail closed): Scheitert der Worker selbst, antwortet er mit
// 503 und lässt den Shop NICHT durch. Ausnahme: Webhook und die oben genannten
// durchgereichten Pfade werden auch dann an den Ursprung gereicht.
//
// Der Worker speichert nichts, protokolliert nichts und enthält keine Geheimnisse.
//
// Diese Datei importiert assets.generated.js. Zum Hochladen ohne Bundler gibt es
// dieselbe Logik als EINE Datei: dist/worker.bundle.mjs (erzeugt von build-bundle.mjs).
// =============================================================================

// Inhalte eingebettet (statt Import):
const OFFLINE_HTML = "<!doctype html>\n<html lang=\"de\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex\">\n<meta name=\"theme-color\" content=\"#0E1315\">\n<title>TEILEKLAR.shop – Coming soon</title>\n<!-- Leeres Icon: verhindert die automatische Anfrage nach /favicon.ico. -->\n<link rel=\"icon\" href=\"data:,\">\n<!--\n  Coming-Soon-Seite für TEILEKLAR.shop.\n  Eine Datei, keine externen Ressourcen, keine Skripte, keine nachgeladenen Schriften,\n  kein Tracking. Sie wird unter \"/\" mit Status 200 und unter allen gesperrten Pfaden\n  als Fehlerseite mit Status 503 ausgeliefert; deshalb sind alle Verweise absolut.\n  Gestaltung nach der Shop-Startseite von teileklar.shop (per GET am 22.11.2026 gelesen):\n  Grund #0E1315, Fläche #14191C, Linie #3D454A, Text #FFFFFF, gedämpft #B4B5B6,\n  Akzent #C8F04B; Überschrift fett mit Laufweite -0.05em; kleine Labels in Monospace;\n  Rundungen 4/8/16 px; feines Linienraster und Akzentschein im Hintergrund.\n  Schriften: Archivo und IBM Plex Mono werden nur verwendet, wenn sie auf dem Gerät\n  installiert sind; sonst greifen die Systemschriften dahinter.\n-->\n<style>\n  :root {\n    color-scheme: dark;\n    --grund: #0E1315; --flaeche: #14191C; --linie: #3D454A;\n    --text: #FFFFFF; --gedaempft: #B4B5B6; --akzent: #C8F04B; --auf-akzent: #0B0F11;\n    --sans: Archivo, \"Helvetica Neue\", Helvetica, Arial, system-ui, sans-serif;\n    --mono: \"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace;\n  }\n  * { box-sizing: border-box; }\n  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }\n  body {\n    margin: 0;\n    min-height: 100vh;\n    display: flex;\n    flex-direction: column;\n    background-color: var(--grund);\n    background-image:\n      radial-gradient(56rem 35rem at 78% 12%, rgba(215, 250, 80, 0.16), transparent 62%),\n      linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px);\n    background-size: auto, 4.5rem 100%;\n    background-repeat: no-repeat, repeat;\n    color: var(--text);\n    font: 1rem/1.6 var(--sans);\n    -webkit-font-smoothing: antialiased;\n    overflow-wrap: break-word;\n  }\n  .rahmen { width: 100%; max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; }\n  @media (min-width: 48em) { .rahmen { padding: 0 2.5rem; } }\n\n  header { border-bottom: 1px solid var(--linie); }\n  header .rahmen { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; padding-top: 1.25rem; padding-bottom: 1.25rem; }\n  .marke { margin: 0; font-size: 1.25rem; font-weight: 700; line-height: 1; letter-spacing: -0.05em; }\n  .claim { margin: 0; font: 500 0.75rem/1 var(--mono); letter-spacing: 0.03em; color: var(--gedaempft); }\n\n  main { flex: 1 0 auto; padding: 3rem 0 3.5rem; }\n  @media (min-width: 48em) { main { padding: 5.5rem 0 5rem; } }\n\n  .chip {\n    display: inline-flex; align-items: center; gap: 0.5rem; max-width: 100%; overflow-wrap: anywhere;\n    margin: 0 0 1.5rem; padding: 0.375rem 0.75rem;\n    border: 1px solid var(--akzent); border-radius: 4px;\n    font: 500 0.75rem/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase;\n    color: var(--akzent);\n  }\n  .chip::before { content: \"\"; flex: 0 0 auto; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--akzent); }\n  @media (prefers-reduced-motion: no-preference) {\n    .chip::before { animation: puls 2.4s ease-in-out infinite; }\n    @keyframes puls { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }\n  }\n\n  h1 {\n    margin: 0 0 1.75rem;\n    font-size: clamp(1.875rem, 8.4vw, 5.5rem); font-weight: 700; line-height: 1; letter-spacing: -0.05em;\n    overflow-wrap: anywhere;\n  }\n  h1 .akzent { display: block; color: var(--akzent); }\n  .hinweis { margin: 0 0 2.5rem; max-width: 40rem; padding-left: 1rem; border-left: 2px solid var(--akzent); font-size: 1.125rem; line-height: 1.55; }\n  .hinweis p { margin: 0 0 0.5rem; }\n  .hinweis p:last-child { margin-bottom: 0; }\n  .hinweis .leise { color: var(--gedaempft); }\n\n  .raster { display: grid; gap: 1rem; max-width: 56rem; align-items: start; }\n  @media (min-width: 48em) { .raster { grid-template-columns: 1fr 1fr; } }\n  .karte { min-width: 0; margin: 0; padding: 1.25rem; background: var(--flaeche); border: 1px solid var(--linie); border-radius: 16px; overflow-wrap: anywhere; }\n  .label { margin: 0 0 0.75rem; font: 500 0.75rem/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--gedaempft); }\n  .karte p { margin: 0; }\n  .nummer { display: inline-block; margin: 0 0 0.25rem; font-size: 1.5rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; color: var(--akzent); }\n  .klein { font-size: 0.875rem; color: var(--gedaempft); }\n  address { font-style: normal; font-size: 0.875rem; line-height: 1.6; color: var(--gedaempft); }\n  address strong { display: block; margin-bottom: 0.25rem; font-size: 1rem; font-weight: 600; color: var(--text); }\n\n  a { color: inherit; text-decoration: underline; text-underline-offset: 0.2em; }\n  a:hover { color: var(--akzent); }\n  a:focus-visible { outline: 3px solid var(--akzent); outline-offset: 3px; border-radius: 4px; }\n\n  footer { border-top: 1px solid var(--linie); background: var(--grund); }\n  footer .rahmen { padding-top: 1rem; padding-bottom: 1.5rem; }\n  footer ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0 1.5rem; }\n  footer a { display: inline-block; padding: 0.625rem 0; font-size: 0.875rem; color: var(--gedaempft); }\n  footer a:hover { color: var(--akzent); }\n</style>\n</head>\n<body>\n<header>\n  <div class=\"rahmen\">\n    <p class=\"marke\">TEILEKLAR</p>\n    <p class=\"claim\">NA KLAR.</p>\n  </div>\n</header>\n\n<main>\n  <div class=\"rahmen\">\n    <p class=\"chip\"><span lang=\"en\">Coming soon</span></p>\n    <h1>TEILEKLAR.shop <span class=\"akzent\">kommt bald zurück.</span></h1>\n\n    <div class=\"hinweis\">\n      <p>TEILEKLAR.shop ist vorübergehend nicht verfügbar. Neue Bestellungen und Werkstattanfragen sind derzeit nicht möglich.</p>\n      <p class=\"leise\">Für bestehende Anliegen erreichen Sie uns über den verifizierten Supportkontakt.</p>\n    </div>\n\n    <div class=\"raster\">\n      <section class=\"karte\" aria-labelledby=\"supportkontakt\">\n        <h2 class=\"label\" id=\"supportkontakt\">Supportkontakt</h2>\n        <p><a class=\"nummer\" href=\"tel:+31613318856\" aria-label=\"Telefon +31 6 133 188 56\">+31 6 133 188 56</a></p>\n        <p class=\"klein\">Telefon · Mo–Fr 09:00–18:00 Uhr (MEZ)</p>\n        <!-- SUPPORT-MAIL: erst nach bestätigter Zustellbarkeit einsetzen -->\n      </section>\n\n      <section class=\"karte\" aria-labelledby=\"anbieter\">\n        <h2 class=\"label\" id=\"anbieter\">Anbieter</h2>\n        <address>\n          <strong>TEILEKLAR – ein Geschäftsbereich von NeXify AI by NeXify</strong>\n          Inhaber: Pascal Courbois (Eenmanszaak nach niederländischem Recht)<br>\n          Graaf van Loonstraat 1E, 5921 JA Venlo, Niederlande<br>\n          KvK-Nr. 90483944 (Kamer van Koophandel, Regio Roermond)<br>\n          USt-IdNr. NL865786276B01\n        </address>\n      </section>\n    </div>\n  </div>\n</main>\n\n<footer>\n  <div class=\"rahmen\">\n    <nav aria-label=\"Rechtliche Hinweise\">\n      <ul>\n        <li><a href=\"/impressum\">Impressum</a></li>\n        <li><a href=\"/datenschutz\">Datenschutz</a></li>\n        <li><a href=\"/agb\">AGB</a></li>\n        <li><a href=\"/widerruf\">Widerruf</a></li>\n      </ul>\n    </nav>\n  </div>\n</footer>\n</body>\n</html>\n";
const SW_JS = "// TEILEKLAR.shop – Abschalt-Service-Worker für den Offline-Zustand.\n//\n// Zweck: Der bisherige Service Worker (Cache \"teileklar-v4\") hält Skripte, Bilder\n// und JSON-Daten des Shops vor. Diese Datei ersetzt ihn unter derselben Adresse.\n// Sie löscht alle Caches dieser Herkunft, meldet die Registrierung ab und lädt\n// offene Fenster neu, damit sie die Offline-Seite direkt vom Server erhalten.\n//\n// Bewusst ohne \"fetch\"-Behandlung: Dieser Worker beantwortet keine Anfragen.\n\nself.addEventListener('install', () => {\n  // Nicht auf das Schließen alter Fenster warten.\n  self.skipWaiting();\n});\n\nself.addEventListener('activate', (event) => {\n  event.waitUntil((async () => {\n    try {\n      const namen = await caches.keys();\n      await Promise.all(namen.map((name) => caches.delete(name)));\n    } catch (fehler) {\n      // Caches nicht erreichbar: Abmeldung trotzdem durchführen.\n    }\n\n    let fenster = [];\n    try {\n      await self.clients.claim();\n      fenster = await self.clients.matchAll({ type: 'window' });\n    } catch (fehler) {\n      fenster = [];\n    }\n\n    await self.registration.unregister();\n\n    // Nach der Abmeldung neu laden: Die Fenster sind danach ohne Service Worker.\n    await Promise.all(fenster.map((f) => f.navigate(f.url).catch(() => undefined)));\n  })());\n});\n";

export const RETRY_AFTER_SEKUNDEN = '86400';
export const WEBHOOK_PFAD = '/api/revolut/webhook';

// Feste Liste, bewusst als einfaches Array: Sie wird auch im Fehlerfall benutzt.
export const VOM_URSPRUNG = [
  '/impressum',
  '/datenschutz',
  '/agb',
  '/widerruf',
  '/versand',
  '/robots.txt',
  '/sitemap.xml',
  '/.well-known/security.txt',
];
const SW_MUSTER = /^\/(?:(?:de|at|ch|nl|be-nl|be-fr|lu)\/)?sw\.js$/;

/**
 * Reine Entscheidungsfunktion (ohne Netzwerk), damit sie lokal prüfbar ist.
 * @param {string} methode HTTP-Methode
 * @param {string} pfad    Pfad ohne Abfrageteil, so wie er in der Adresse steht
 * @returns {'seite'|'sw'|'ursprung'|'api503'|'html503'}
 */
export function route(methode, pfad) {
  const lesend = methode === 'GET' || methode === 'HEAD';

  if (pfad === WEBHOOK_PFAD) return methode === 'POST' ? 'ursprung' : 'api503';
  if (pfad.startsWith('/api/')) return 'api503';

  if (lesend) {
    if (pfad === '/') return 'seite';
    if (SW_MUSTER.test(pfad)) return 'sw';
    if (VOM_URSPRUNG.includes(pfad)) return 'ursprung';
  }
  return 'html503';
}

// Notfall-Entscheidung ohne URL-Objekt und ohne reguläre Ausdrücke: Nur die
// durchgereichten Pfade gehen zum Ursprung, alles andere wird gesperrt.
function notfallRoute(request) {
  try {
    const url = String(request.url);
    const nachSchema = url.indexOf('//');
    const start = url.indexOf('/', nachSchema < 0 ? 0 : nachSchema + 2);
    let pfad = start < 0 ? '/' : url.slice(start);
    for (const trenner of ['?', '#']) {
      const i = pfad.indexOf(trenner);
      if (i >= 0) pfad = pfad.slice(0, i);
    }
    const methode = request.method;
    if (pfad === WEBHOOK_PFAD && methode === 'POST') return 'ursprung';
    if ((methode === 'GET' || methode === 'HEAD') && VOM_URSPRUNG.indexOf(pfad) >= 0) return 'ursprung';
  } catch (fehler) {
    // fällt auf die Sperre zurück
  }
  return 'notfall503';
}

const KOPF_503 = {
  'Retry-After': RETRY_AFTER_SEKUNDEN,
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

function antwort(methode, inhalt, status, kopfzeilen) {
  return new Response(methode === 'HEAD' ? null : inhalt, { status, headers: kopfzeilen });
}

function notfall503() {
  return new Response('TEILEKLAR.shop ist vorübergehend nicht verfügbar.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...KOPF_503 },
  });
}

function beantworte(ziel, request, zumUrsprung) {
  const methode = request.method;
  switch (ziel) {
    case 'ursprung':
      // Unverändert: Methode, Kopfzeilen (Signatur) und Inhalt gehen so zum Ursprung,
      // wie sie angekommen sind. Die Antwort des Ursprungs geht unverändert zurück.
      return zumUrsprung(request);

    case 'seite':
      return antwort(methode, OFFLINE_HTML, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      });

    case 'sw':
      return antwort(methode, SW_JS, 200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });

    case 'api503':
      return antwort(
        methode,
        JSON.stringify({
          status: 503,
          error: 'service_unavailable',
          message: 'TEILEKLAR.shop ist vorübergehend nicht verfügbar.',
        }),
        503,
        { 'Content-Type': 'application/json', ...KOPF_503 },
      );

    case 'html503':
      return antwort(methode, OFFLINE_HTML, 503, { 'Content-Type': 'text/html; charset=utf-8', ...KOPF_503 });

    default:
      return notfall503();
  }
}

/**
 * @param {Request} request
 * @param {(request: Request) => Promise<Response>} zumUrsprung im Worker: fetch
 * @param {(methode: string, pfad: string) => string} entscheide nur für Tests austauschbar
 */
export async function handle(request, zumUrsprung = fetch, entscheide = route) {
  let ziel;
  try {
    ziel = entscheide(request.method, new URL(request.url).pathname);
  } catch (fehler) {
    ziel = notfallRoute(request);
  }

  try {
    return await beantworte(ziel, request, zumUrsprung);
  } catch (fehler) {
    if (ziel === 'ursprung') {
      // Ursprung nicht erreichbar: Fehler melden, nichts anderes ausliefern.
      // Für den Webhook heißt das: Der Zahlungsdienst wiederholt die Zustellung.
      return new Response('Ursprung nicht erreichbar.', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return notfall503();
  }
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (fehler) {
      return notfall503();
    }
  },
};
