// =============================================================================
// TEILEKLAR.shop – Offline-Zustand am Rand (Cloudflare Worker)
// =============================================================================
// ALTERNATIVE / ÜBERBRÜCKUNG zum nginx-Regelblock, mit derselben Allowlist.
//
// WICHTIG: Dieser Worker allein erfüllt die Vorgabe "serverseitig deaktiviert"
// NICHT, solange der Ursprungsserver direkt (an Cloudflare vorbei) erreichbar
// ist. Er sperrt nur Anfragen, die über Cloudflare kommen. Siehe RUNBOOK,
// Abschnitt 5.
//
// Verhalten:
//   GET/HEAD  /                                   200 Offline-Seite
//   GET/HEAD  /robots.txt /sitemap.xml /sw.js     200 aus diesem Worker
//             (und /<markt>/sw.js)
//   GET/HEAD  Rechtsseiten, security.txt          unverändert vom Ursprung
//   POST      /api/revolut/webhook                unverändert zum Ursprung
//   alles andere unter /api/                      503 JSON
//   alles andere                                  503 Offline-Seite
//
// Der Worker speichert nichts, protokolliert nichts und enthält keine Geheimnisse.
// =============================================================================

import { OFFLINE_HTML, SW_JS, ROBOTS_TXT, SITEMAP_XML } from './assets.generated.js';

export const RETRY_AFTER_SEKUNDEN = '86400';
export const WEBHOOK_PFAD = '/api/revolut/webhook';

const RECHTSSEITEN = new Set(['/impressum', '/datenschutz', '/agb', '/widerruf', '/versand']);
const VOM_URSPRUNG = new Set(['/.well-known/security.txt']);
const STATISCH = new Map([
  ['/robots.txt', { inhalt: ROBOTS_TXT, typ: 'text/plain; charset=utf-8', cache: 'no-cache' }],
  ['/sitemap.xml', { inhalt: SITEMAP_XML, typ: 'application/xml', cache: 'no-cache' }],
]);
const SW_MUSTER = /^\/(?:(?:de|at|ch|nl|be-nl|be-fr|lu)\/)?sw\.js$/;

/**
 * Reine Entscheidungsfunktion (ohne Netzwerk), damit sie lokal prüfbar ist.
 * @param {string} methode HTTP-Methode
 * @param {string} pfad    Pfad ohne Abfrageteil, so wie er in der Adresse steht
 * @returns {'seite'|'statisch'|'sw'|'ursprung'|'api503'|'html503'}
 */
export function route(methode, pfad) {
  const lesend = methode === 'GET' || methode === 'HEAD';

  if (pfad === WEBHOOK_PFAD) return methode === 'POST' ? 'ursprung' : 'api503';
  if (pfad.startsWith('/api/')) return 'api503';

  if (lesend) {
    if (pfad === '/') return 'seite';
    if (STATISCH.has(pfad)) return 'statisch';
    if (SW_MUSTER.test(pfad)) return 'sw';
    if (RECHTSSEITEN.has(pfad) || VOM_URSPRUNG.has(pfad)) return 'ursprung';
  }
  return 'html503';
}

function antwort(methode, inhalt, status, kopfzeilen) {
  return new Response(methode === 'HEAD' ? null : inhalt, { status, headers: kopfzeilen });
}

const KOPF_503 = {
  'Retry-After': RETRY_AFTER_SEKUNDEN,
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

/**
 * @param {Request} request
 * @param {(request: Request) => Promise<Response>} zumUrsprung im Worker: fetch
 */
export async function handle(request, zumUrsprung = fetch) {
  const pfad = new URL(request.url).pathname;
  const methode = request.method;

  switch (route(methode, pfad)) {
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

    case 'statisch': {
      const datei = STATISCH.get(pfad);
      return antwort(methode, datei.inhalt, 200, { 'Content-Type': datei.typ, 'Cache-Control': datei.cache });
    }

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

    default:
      return antwort(methode, OFFLINE_HTML, 503, { 'Content-Type': 'text/html; charset=utf-8', ...KOPF_503 });
  }
}

export default {
  fetch(request) {
    return handle(request);
  },
};
