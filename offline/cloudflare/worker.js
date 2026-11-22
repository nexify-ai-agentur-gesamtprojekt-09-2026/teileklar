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
//   GET/HEAD  /favicon.svg und /favicon.ico       200 eigenes Icon (SVG, image/svg+xml)
//   GET/HEAD  /_tk/fonts/…woff2, /_tk/og.jpg      200 eigene Schriften und Vorschaubild
//   GET/HEAD  /apple-touch-icon.png               404 (kein Rasterbild vorhanden)
//             /apple-touch-icon-precomposed.png
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

import { OFFLINE_HTML, SW_JS, FAVICON_SVG, FONT_ARCHIVO_B64, FONT_PLEX_MONO_B64, OG_JPG_B64 } from './assets.generated.js';

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
// /favicon.ico liefert dasselbe SVG direkt (keine Weiterleitung, kein Binärformat):
// ein Abruf statt zwei, und kein erzeugtes Rasterbild, das gepflegt werden müsste.
const ICON_PFADE = ['/favicon.svg', '/favicon.ico'];
const OHNE_INHALT_404 = ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'];
// Eigene statische Dateien der Coming-Soon-Seite. Feste Pfade, nur GET/HEAD,
// vom Worker selbst beantwortet, nie zum Ursprung.
const DATEIEN = {
  '/_tk/fonts/archivo-latin-wght-normal.woff2': { b64: FONT_ARCHIVO_B64, typ: 'font/woff2', cache: 'public, max-age=31536000, immutable' },
  '/_tk/fonts/ibm-plex-mono-latin-500-normal.woff2': { b64: FONT_PLEX_MONO_B64, typ: 'font/woff2', cache: 'public, max-age=31536000, immutable' },
  '/_tk/og.jpg': { b64: OG_JPG_B64, typ: 'image/jpeg', cache: 'public, max-age=86400' },
};
const dekodiert = new Map();
function bytes(pfad) {
  if (!dekodiert.has(pfad)) {
    const roh = atob(DATEIEN[pfad].b64);
    const feld = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i += 1) feld[i] = roh.charCodeAt(i);
    dekodiert.set(pfad, feld);
  }
  return dekodiert.get(pfad);
}
const SW_MUSTER = /^\/(?:(?:de|at|ch|nl|be-nl|be-fr|lu)\/)?sw\.js$/;

/**
 * Reine Entscheidungsfunktion (ohne Netzwerk), damit sie lokal prüfbar ist.
 * @param {string} methode HTTP-Methode
 * @param {string} pfad    Pfad ohne Abfrageteil, so wie er in der Adresse steht
 * @returns {'seite'|'sw'|'icon'|'datei'|'nicht404'|'ursprung'|'api503'|'html503'}
 */
export function route(methode, pfad) {
  const lesend = methode === 'GET' || methode === 'HEAD';

  if (pfad === WEBHOOK_PFAD) return methode === 'POST' ? 'ursprung' : 'api503';
  if (pfad.startsWith('/api/')) return 'api503';

  if (lesend) {
    if (pfad === '/') return 'seite';
    if (SW_MUSTER.test(pfad)) return 'sw';
    if (ICON_PFADE.includes(pfad)) return 'icon';
    if (Object.prototype.hasOwnProperty.call(DATEIEN, pfad)) return 'datei';
    if (OHNE_INHALT_404.includes(pfad)) return 'nicht404';
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

    case 'icon':
      return antwort(methode, FAVICON_SVG, 200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      });

    case 'datei': {
      const pfad = new URL(request.url).pathname;
      const datei = DATEIEN[pfad];
      return antwort(methode, bytes(pfad), 200, {
        'Content-Type': datei.typ,
        'Cache-Control': datei.cache,
        'X-Content-Type-Options': 'nosniff',
      });
    }

    case 'nicht404':
      return antwort(methode, 'Nicht vorhanden.', 404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
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
