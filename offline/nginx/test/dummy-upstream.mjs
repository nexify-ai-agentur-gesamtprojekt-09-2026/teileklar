// Attrappe für den API-Dienst (nur für den lokalen Test, nie auf dem Server starten).
// Antwortet auf jede Anfrage mit 200 und gibt Methode, Adresse, Kopfzeilen und
// Inhalt als JSON zurück. Jede Anfrage wird zusätzlich in eine Datei geschrieben,
// damit der Test zählen kann, was beim "Dienst" wirklich angekommen ist.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] || 18905);
const protokoll = process.argv[3] || '/dev/null';

http.createServer((req, res) => {
  const teile = [];
  req.on('data', (t) => teile.push(t));
  req.on('end', () => {
    const eintrag = {
      method: req.method,
      url: req.url,
      host: req.headers.host,
      signatur: req.headers['revolut-signature'] || null,
      body: Buffer.concat(teile).toString('utf8'),
    };
    fs.appendFileSync(protokoll, JSON.stringify(eintrag) + '\n');
    res.writeHead(200, { 'content-type': 'application/json', 'x-attrappe': '1' });
    res.end(JSON.stringify(eintrag));
  });
}).listen(port, '127.0.0.1');
