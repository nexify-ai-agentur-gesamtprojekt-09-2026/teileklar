// Lokaler Test des Workers – ohne Deploy, ohne Netzwerk.
// Aufruf:  node --test offline/cloudflare/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { route, handle, WEBHOOK_PFAD } from './worker.js';
import { erzeuge } from './build-assets.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const pfade = fs
  .readFileSync(path.join(hier, '..', 'pruefung', 'pfade.tsv'), 'utf8')
  .split('\n')
  .filter((z) => z.trim() && !z.startsWith('#'))
  .map((z) => {
    const [klasse, pfad] = z.split('\t');
    return { klasse, pfad };
  });

// Soll je Klasse aus der Pfadliste: [lesend (GET/HEAD), OPTIONS, POST]
const SOLL = {
  SEITE: ['seite', 'html503', 'html503'],
  RECHT: ['ursprung', 'html503', 'html503'],
  STATISCH: [null, 'html503', 'html503'], // lesend: statisch, sw oder ursprung (security.txt)
  WEBHOOK: ['api503', 'api503', 'ursprung'],
  API503: ['api503', 'api503', 'api503'],
  HTML503: ['html503', 'html503', 'html503'],
};

function anfrage(methode, pfad, host = 'teileklar.shop') {
  const init = { method: methode, headers: { 'Revolut-Signature': 'v1=testsignatur' } };
  if (methode === 'POST') init.body = '{"event":"TEST"}';
  return new Request(`https://${host}${pfad}`, init);
}

test('Pfadliste ist geladen', () => {
  assert.ok(pfade.length >= 60, `nur ${pfade.length} Pfade`);
});

test('route(): jede Zeile der Pfadliste, jede Methode', () => {
  for (const { klasse, pfad } of pfade) {
    const [lesend, options, post] = SOLL[klasse];
    const p = pfad; // Pfad bleibt, wie er in der Adresse steht
    for (const methode of ['GET', 'HEAD']) {
      const ist = route(methode, p);
      if (lesend === null) assert.ok(['statisch', 'sw', 'ursprung'].includes(ist), `${methode} ${pfad} -> ${ist}`);
      else assert.equal(ist, lesend, `${methode} ${pfad}`);
    }
    assert.equal(route('OPTIONS', p), options, `OPTIONS ${pfad}`);
    assert.equal(route('POST', p), post, `POST ${pfad}`);
    for (const methode of ['PUT', 'PATCH', 'DELETE']) {
      assert.notEqual(route(methode, p), 'ursprung', `${methode} ${pfad} darf nie zum Ursprung`);
    }
  }
});

test('Zum Ursprung geht ausschließlich: POST Webhook sowie GET/HEAD Rechtsseiten und security.txt', async () => {
  const erlaubt = new Set([
    `POST ${WEBHOOK_PFAD}`,
    ...['/impressum', '/datenschutz', '/agb', '/widerruf', '/versand', '/.well-known/security.txt'].flatMap((p) => [
      `GET ${p}`,
      `HEAD ${p}`,
    ]),
  ]);
  const gesehen = new Set();
  const ursprung = async (req) => {
    gesehen.add(`${req.method} ${new URL(req.url).pathname}`);
    return new Response('vom Ursprung', { status: 200 });
  };
  for (const host of ['teileklar.shop', 'www.teileklar.shop']) {
    for (const { pfad } of pfade) {
      for (const methode of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE']) {
        await handle(anfrage(methode, pfad, host), ursprung);
      }
    }
  }
  assert.deepEqual([...gesehen].sort(), [...erlaubt].sort());
});

test('Webhook: Anfrage geht unverändert zum Ursprung, Antwort unverändert zurück', async () => {
  let angekommen;
  const ursprung = async (req) => {
    angekommen = { methode: req.method, url: req.url, signatur: req.headers.get('Revolut-Signature'), inhalt: await req.text() };
    return new Response('{"ok":true}', { status: 200, headers: { 'X-Vom-Dienst': '1' } });
  };
  const res = await handle(anfrage('POST', `${WEBHOOK_PFAD}?probe=1`), ursprung);
  assert.deepEqual(angekommen, {
    methode: 'POST',
    url: `https://teileklar.shop${WEBHOOK_PFAD}?probe=1`,
    signatur: 'v1=testsignatur',
    inhalt: '{"event":"TEST"}',
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Vom-Dienst'), '1');
  assert.equal(res.headers.get('Retry-After'), null);
  assert.equal(await res.text(), '{"ok":true}');
});

test('Startseite: 200, Offline-Seite, noindex, no-store', async () => {
  const res = await handle(anfrage('GET', '/'), () => assert.fail('darf nicht zum Ursprung'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Location'), null);
  assert.match(await res.text(), /TEILEKLAR\.shop ist vorübergehend nicht verfügbar\./);
});

test('503 für Seiten: Offline-Seite, Retry-After 86400, noindex, no-store, kein Location', async () => {
  for (const [methode, pfad] of [['GET', '/shop'], ['POST', '/shop'], ['GET', '/myadmin'], ['GET', '/myADMIN%20v2.dc.html'], ['GET', '/assets/workshops.json'], ['POST', '/'], ['OPTIONS', '/impressum']]) {
    const res = await handle(anfrage(methode, pfad), () => assert.fail('darf nicht zum Ursprung'));
    assert.equal(res.status, 503, `${methode} ${pfad}`);
    assert.equal(res.headers.get('Retry-After'), '86400');
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Location'), null);
    assert.match(await res.text(), /vorübergehend nicht verfügbar/);
  }
});

test('503 für die API: JSON, auch für POST auf Bestellung, Anmeldung, Kontakt', async () => {
  for (const pfad of ['/api/orders/create', '/api/auth/login', '/api/auth/register', '/api/auth/guest', '/api/contact/submit', '/api/ai/chat', '/api/shop/products']) {
    for (const methode of ['GET', 'POST']) {
      const res = await handle(anfrage(methode, pfad), () => assert.fail('darf nicht zum Ursprung'));
      assert.equal(res.status, 503, `${methode} ${pfad}`);
      assert.equal(res.headers.get('Content-Type'), 'application/json');
      assert.equal(res.headers.get('Retry-After'), '86400');
      assert.equal(JSON.parse(await res.text()).status, 503);
    }
  }
});

test('HEAD liefert keinen Inhalt, aber denselben Status', async () => {
  const a = await handle(anfrage('HEAD', '/'), () => assert.fail());
  assert.equal(a.status, 200);
  assert.equal(await a.text(), '');
  const b = await handle(anfrage('HEAD', '/shop'), () => assert.fail());
  assert.equal(b.status, 503);
  assert.equal(await b.text(), '');
});

test('Service Worker, robots.txt und Sitemap kommen aus dem Worker', async () => {
  const lies = (datei) => fs.readFileSync(path.join(hier, '..', datei), 'utf8');
  for (const pfad of ['/sw.js', '/de/sw.js', '/be-nl/sw.js']) {
    const res = await handle(anfrage('GET', pfad), () => assert.fail());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(await res.text(), lies('sw.js'));
  }
  assert.equal(await (await handle(anfrage('GET', '/robots.txt'), () => assert.fail())).text(), lies('robots.txt'));
  assert.equal(await (await handle(anfrage('GET', '/sitemap.xml'), () => assert.fail())).text(), lies('sitemap.xml'));
  assert.equal((await handle(anfrage('GET', '/shop/sw.js'), () => assert.fail())).status, 503);
});

test('assets.generated.js ist aktuell (entspricht den Dateien in offline/)', () => {
  assert.equal(fs.readFileSync(path.join(hier, 'assets.generated.js'), 'utf8'), erzeuge());
});
