// Lokaler Test des Abschalt-Service-Workers (offline/sw.js) in einem echten Browser.
// Benötigt das Paket "playwright" (wird hier NICHT installiert). Sendet nichts an
// teileklar.shop: Alles läuft gegen einen Testserver auf 127.0.0.1.
//
// Aufruf:  node offline/pruefung/sw-lokaltest.mjs [PFAD_ZU_EINER_KOPIE_DES_BISHERIGEN_sw.js]
//
// Ablauf:
//   1. "Alter Shop": Seite registriert einen Service Worker mit Cache "teileklar-v4",
//      der ein Skript aus dem Cache beantwortet (wie der bisherige Worker).
//   2. Der Testserver liefert unter derselben Adresse die Offline-Seite und offline/sw.js.
//   3. Erneuter Besuch: Erwartet werden gelöschte Caches, keine Registrierung mehr,
//      ein automatisches Neuladen und die Offline-Seite als Inhalt.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const offline = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ABSCHALT_SW = fs.readFileSync(path.join(offline, 'sw.js'), 'utf8');
const OFFLINE_HTML = fs.readFileSync(path.join(offline, 'offline.html'), 'utf8');

const ALTER_SW = process.argv[2]
  ? fs.readFileSync(process.argv[2], 'utf8')
  : `const CACHE = 'teileklar-v4';
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./support.js'])).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (/\\.js$/.test(new URL(e.request.url).pathname)) e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});`;

const ALTE_SEITE = `<!doctype html><html lang="de"><title>Alter Shop</title><h1>Alter Shop</h1>
<script src="./support.js"></script>
<script>navigator.serviceWorker.register('./sw.js', { scope: './' });</script></html>`;

let zustand = 'alt';
let seitenabrufe = 0;
const server = http.createServer((req, res) => {
  const pfad = new URL(req.url, 'http://x').pathname;
  if (pfad === '/sw.js') {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
    return res.end(zustand === 'alt' ? ALTER_SW : ABSCHALT_SW);
  }
  if (zustand === 'alt' && pfad === '/support.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end('window.__alterShop = true;');
  }
  if (pfad === '/') {
    seitenabrufe += 1;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(zustand === 'alt' ? ALTE_SEITE : OFFLINE_HTML);
  }
  if (zustand === 'alt') {
    // Der alte Shop beantwortet seine eigenen Dateien mit 200.
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('alt');
  }
  res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '86400', 'cache-control': 'no-store' });
  res.end(OFFLINE_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const basis = `http://127.0.0.1:${server.address().port}/`;

let fehler = 0;
const pruefe = (ok, text) => {
  console.log(`${ok ? 'OK    ' : 'FEHLER'}  ${text}`);
  if (!ok) fehler += 1;
};
const stand = (page) =>
  page.evaluate(async () => ({
    caches: await caches.keys(),
    registrierungen: (await navigator.serviceWorker.getRegistrations()).length,
    gesteuert: !!navigator.serviceWorker.controller,
    titel: document.title,
  }));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

// 1. Alter Zustand
await page.goto(basis);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await page.reload();
const alt = await stand(page);
pruefe(alt.registrierungen === 1 && alt.gesteuert, `Ausgangslage: alter Service Worker steuert die Seite (${JSON.stringify(alt)})`);
pruefe(alt.caches.includes('teileklar-v4'), 'Ausgangslage: Cache "teileklar-v4" ist gefüllt');

// 2. Umschalten und erneut besuchen
zustand = 'offline';
const vorher = seitenabrufe;
await page.goto(basis);
// Der Browser prüft das Service-Worker-Skript kurz nach dem Seitenaufruf. Bis zu 20 s warten.
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(1000);
  const zwischen = await stand(page).catch(() => null); // während des Neuladens nicht auswertbar
  if (zwischen && zwischen.registrierungen === 0 && zwischen.caches.length === 0) break;
}
const neu = await stand(page);
pruefe(neu.caches.length === 0, `Nach dem Umschalten: alle Caches gelöscht (${JSON.stringify(neu.caches)})`);
pruefe(neu.registrierungen === 0, `Nach dem Umschalten: keine Service-Worker-Registrierung mehr (${neu.registrierungen})`);
pruefe(!neu.gesteuert, 'Nach dem Umschalten: Seite wird von keinem Service Worker gesteuert');
pruefe(seitenabrufe - vorher >= 2, `Offenes Fenster wurde automatisch neu geladen (${seitenabrufe - vorher} Abrufe der Seite)`);
pruefe(/vorübergehend nicht verfügbar/.test(neu.titel), `Angezeigt wird die Offline-Seite (Titel: ${neu.titel})`);
pruefe((await page.evaluate(() => window.__alterShop)) !== true, 'Kein Skript des alten Shops aus dem Cache geladen');

await browser.close();
server.close();
console.log(fehler === 0 ? 'GESAMT: BESTANDEN' : `GESAMT: ${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
