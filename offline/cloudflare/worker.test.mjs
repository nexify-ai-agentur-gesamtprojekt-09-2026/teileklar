// Lokaler Test des Workers – ohne Deploy, ohne Netzwerk.
// Aufruf:  node --test offline/cloudflare/worker.test.mjs
// Jeder Test läuft zweimal: gegen worker.js und gegen dist/worker.bundle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as quellmodul from './worker.js';
import * as bundlemodul from './dist/worker.bundle.mjs';
import { erzeuge } from './build-assets.mjs';
import { erzeugeBundle } from './build-bundle.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const lies = (datei) => fs.readFileSync(path.join(hier, '..', datei), 'utf8');
const pfade = lies('pruefung/pfade.tsv')
  .split('\n')
  .filter((z) => z.trim() && !z.startsWith('#'))
  .map((z) => {
    const [klasse, pfad] = z.split('\t');
    return { klasse, pfad };
  });

const DURCHGEREICHT = ['/impressum', '/datenschutz', '/agb', '/widerruf', '/versand', '/robots.txt', '/sitemap.xml', '/.well-known/security.txt'];
const SW_PFADE = ['/sw.js', '/de/sw.js', '/at/sw.js', '/ch/sw.js', '/nl/sw.js', '/be-nl/sw.js', '/be-fr/sw.js', '/lu/sw.js'];

// Soll je Klasse aus der Pfadliste: [lesend (GET/HEAD), OPTIONS, POST]
const SOLL = {
  SEITE: ['seite', 'html503', 'html503'],
  RECHT: ['ursprung', 'html503', 'html503'],
  STATISCH: [null, 'html503', 'html503'], // lesend: sw oder ursprung (robots, sitemap, security.txt)
  WEBHOOK: ['api503', 'api503', 'ursprung'],
  API503: ['api503', 'api503', 'api503'],
  HTML503: ['html503', 'html503', 'html503'],
};

function anfrage(methode, pfad, host = 'teileklar.shop') {
  const init = { method: methode, headers: { 'Revolut-Signature': 'v1=testsignatur' } };
  if (methode === 'POST') init.body = '{"event":"TEST"}';
  return new Request(`https://${host}${pfad}`, init);
}
const nie = () => assert.fail('darf nicht zum Ursprung');

function pruefe503(res, text) {
  assert.equal(res.status, 503, text);
  assert.equal(res.headers.get('Retry-After'), '86400', text);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex', text);
  assert.equal(res.headers.get('Cache-Control'), 'no-store', text);
  assert.equal(res.headers.get('Location'), null, text);
}

test('Pfadliste ist geladen', () => {
  assert.ok(pfade.length >= 60, `nur ${pfade.length} Pfade`);
});

test('assets.generated.js ist aktuell (entspricht den Dateien in offline/)', () => {
  assert.equal(fs.readFileSync(path.join(hier, 'assets.generated.js'), 'utf8'), erzeuge());
});

test('dist/worker.bundle.mjs ist aktuell und eine einzelne Datei ohne Import', () => {
  const bundle = fs.readFileSync(path.join(hier, 'dist', 'worker.bundle.mjs'), 'utf8');
  assert.equal(bundle, erzeugeBundle());
  assert.doesNotMatch(bundle, /^\s*import\s/m);
  assert.doesNotMatch(bundle, /\bimport\s*\(/);
  assert.doesNotMatch(bundle, /\brequire\s*\(/);
  assert.equal(typeof bundlemodul.default.fetch, 'function');
});

for (const [name, modul] of [['worker.js', quellmodul], ['dist/worker.bundle.mjs', bundlemodul]]) {
  const { route, handle, WEBHOOK_PFAD } = modul;
  const t = (titel, fn) => test(`[${name}] ${titel}`, fn);

  t('route(): jede Zeile der Pfadliste, jede Methode', () => {
    for (const { klasse, pfad } of pfade) {
      const [lesend, options, post] = SOLL[klasse];
      for (const methode of ['GET', 'HEAD']) {
        const ist = route(methode, pfad);
        if (lesend === null) assert.ok(['sw', 'ursprung'].includes(ist), `${methode} ${pfad} -> ${ist}`);
        else assert.equal(ist, lesend, `${methode} ${pfad}`);
      }
      assert.equal(route('OPTIONS', pfad), options, `OPTIONS ${pfad}`);
      assert.equal(route('POST', pfad), post, `POST ${pfad}`);
      for (const methode of ['PUT', 'PATCH', 'DELETE']) {
        assert.notEqual(route(methode, pfad), 'ursprung', `${methode} ${pfad} darf nie zum Ursprung`);
      }
    }
  });

  t('Zum Ursprung geht ausschließlich: POST Webhook sowie GET/HEAD der durchgereichten Pfade', async () => {
    const erlaubt = new Set([`POST ${WEBHOOK_PFAD}`, ...DURCHGEREICHT.flatMap((p) => [`GET ${p}`, `HEAD ${p}`])]);
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

  t('Durchreichen übergibt dasselbe Request-Objekt (fetch(request)) und gibt die Antwort unverändert zurück', async () => {
    for (const [methode, pfad] of [['POST', WEBHOOK_PFAD], ...DURCHGEREICHT.map((p) => ['GET', p])]) {
      const req = anfrage(methode, pfad);
      const vomUrsprung = new Response('vom Ursprung', { status: 200, headers: { 'X-Vom-Dienst': '1' } });
      let erhalten;
      const res = await handle(req, async (r) => {
        erhalten = r;
        return vomUrsprung;
      });
      assert.equal(erhalten, req, `${methode} ${pfad}: Request unverändert`);
      assert.equal(res, vomUrsprung, `${methode} ${pfad}: Antwort unverändert`);
    }
  });

  t('Webhook: Inhalt, Signatur und Abfrageteil kommen an; keine 503-Kopfzeilen auf der Antwort', async () => {
    let angekommen;
    const ursprung = async (req) => {
      angekommen = { methode: req.method, url: req.url, signatur: req.headers.get('Revolut-Signature'), inhalt: await req.text() };
      return new Response('{"ok":true}', { status: 200 });
    };
    const res = await handle(anfrage('POST', `${WEBHOOK_PFAD}?probe=1`), ursprung);
    assert.deepEqual(angekommen, {
      methode: 'POST',
      url: `https://teileklar.shop${WEBHOOK_PFAD}?probe=1`,
      signatur: 'v1=testsignatur',
      inhalt: '{"event":"TEST"}',
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Retry-After'), null);
    assert.equal(await res.text(), '{"ok":true}');
  });

  t('Root /: 200 mit der Coming-Soon-Seite, X-Robots-Tag noindex, Cache-Control no-store', async () => {
    for (const host of ['teileklar.shop', 'www.teileklar.shop']) {
      const res = await handle(anfrage('GET', '/', host), nie);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      assert.equal(res.headers.get('Location'), null);
      assert.match(res.headers.get('Content-Type'), /^text\/html/);
      const inhalt = await res.text();
      assert.equal(inhalt, lies('offline.html'));
      assert.match(inhalt, /Coming soon/);
      assert.match(inhalt, /kommt bald zurück/);
      assert.match(inhalt, /TEILEKLAR\.shop ist vorübergehend nicht verfügbar\./);
    }
  });

  t('503 für Seiten: Coming-Soon-Seite als Körper, Retry-After 86400, noindex, no-store, kein Location', async () => {
    for (const [methode, pfad] of [['GET', '/shop'], ['POST', '/shop'], ['GET', '/de/'], ['GET', '/konto'], ['GET', '/myadmin'], ['GET', '/myADMIN%20v2.dc.html'], ['GET', '/assets/workshops.json'], ['POST', '/'], ['OPTIONS', '/impressum'], ['POST', '/impressum'], ['POST', '/robots.txt']]) {
      const res = await handle(anfrage(methode, pfad), nie);
      pruefe503(res, `${methode} ${pfad}`);
      assert.equal(await res.text(), lies('offline.html'));
    }
  });

  t('503 für die API: kurze JSON-Antwort, auch für POST auf Bestellung, Anmeldung, Kontakt', async () => {
    for (const pfad of ['/api/orders/create', '/api/auth/login', '/api/auth/register', '/api/auth/guest', '/api/contact/submit', '/api/ai/chat', '/api/shop/products']) {
      for (const methode of ['GET', 'POST']) {
        const res = await handle(anfrage(methode, pfad), nie);
        pruefe503(res, `${methode} ${pfad}`);
        assert.equal(res.headers.get('Content-Type'), 'application/json');
        assert.equal(JSON.parse(await res.text()).status, 503);
      }
    }
    for (const methode of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      pruefe503(await handle(anfrage(methode, WEBHOOK_PFAD), nie), `${methode} Webhook`);
    }
  });

  t('HEAD liefert keinen Inhalt, aber denselben Status', async () => {
    const a = await handle(anfrage('HEAD', '/'), nie);
    assert.equal(a.status, 200);
    assert.equal(await a.text(), '');
    const b = await handle(anfrage('HEAD', '/shop'), nie);
    assert.equal(b.status, 503);
    assert.equal(await b.text(), '');
  });

  t('/sw.js und /<markt>/sw.js liefern den Abschalt-Service-Worker', async () => {
    for (const pfad of SW_PFADE) {
      const res = await handle(anfrage('GET', pfad), nie);
      assert.equal(res.status, 200, pfad);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      assert.match(res.headers.get('Content-Type'), /^application\/javascript/);
      assert.equal(await res.text(), lies('sw.js'));
    }
    pruefe503(await handle(anfrage('GET', '/shop/sw.js'), nie), '/shop/sw.js');
    pruefe503(await handle(anfrage('POST', '/sw.js'), nie), 'POST /sw.js');
  });

  t('Fail closed: scheitert die Entscheidung, gibt es 503 – nie den Shop', async () => {
    const kaputt = () => {
      throw new Error('absichtlicher Fehler');
    };
    for (const [methode, pfad] of [['GET', '/'], ['GET', '/shop'], ['POST', '/api/orders/create'], ['POST', '/api/auth/register'], ['GET', '/myadmin'], ['GET', '/sw.js'], ['GET', `${WEBHOOK_PFAD}`], ['POST', '/impressum'], ['POST', `${WEBHOOK_PFAD}/`]]) {
      pruefe503(await handle(anfrage(methode, pfad), nie, kaputt), `${methode} ${pfad}`);
    }
  });

  t('Fail closed: Webhook und durchgereichte Pfade gehen auch bei eigenem Fehler zum Ursprung', async () => {
    const kaputt = () => {
      throw new Error('absichtlicher Fehler');
    };
    for (const [methode, pfad] of [['POST', WEBHOOK_PFAD], ['POST', `${WEBHOOK_PFAD}?probe=1`], ...DURCHGEREICHT.map((p) => ['GET', p]), ['HEAD', '/impressum']]) {
      const req = anfrage(methode, pfad);
      let erhalten;
      const res = await handle(req, async (r) => {
        erhalten = r;
        return new Response('vom Ursprung', { status: 200 });
      }, kaputt);
      assert.equal(erhalten, req, `${methode} ${pfad}`);
      assert.equal(res.status, 200);
    }
  });

  t('Ursprung nicht erreichbar: 502 für durchgereichte Pfade, kein anderer Inhalt', async () => {
    const tot = async () => {
      throw new Error('Verbindung abgelehnt');
    };
    for (const [methode, pfad] of [['POST', WEBHOOK_PFAD], ['GET', '/impressum']]) {
      const res = await handle(anfrage(methode, pfad), tot);
      assert.equal(res.status, 502, `${methode} ${pfad}`);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      assert.doesNotMatch(await res.text(), /Coming soon/);
    }
  });
}
