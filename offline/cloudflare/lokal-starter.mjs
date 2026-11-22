// Lokaler Starter: liefert dist/worker.bundle.mjs über einen HTTP-Server auf 127.0.0.1 aus,
// um die Seite samt Schriftpfaden im Browser anzusehen. Kein Deploy, keine Verbindung nach außen:
// Der "Ursprung" ist eine Attrappe.
//
//     node offline/cloudflare/lokal-starter.mjs [PORT]      (Vorgabe: 18300)
import http from 'node:http';
import { handle } from './dist/worker.bundle.mjs';

const port = Number(process.argv[2] || 18300);
const ursprung = async (req) =>
  new Response(`<!doctype html><html lang="de"><title>Attrappe</title><p>Attrappe für ${new URL(req.url).pathname}</p></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

http
  .createServer(async (q, r) => {
    const teile = [];
    for await (const t of q) teile.push(t);
    const init = { method: q.method, headers: q.headers };
    if (!['GET', 'HEAD'].includes(q.method)) init.body = Buffer.concat(teile);
    const res = await handle(new Request(`http://127.0.0.1:${port}${q.url}`, init), ursprung);
    r.writeHead(res.status, Object.fromEntries(res.headers));
    r.end(Buffer.from(await res.arrayBuffer()));
  })
  .listen(port, '127.0.0.1', () => console.log(`Worker-Bundle lokal: http://127.0.0.1:${port}/`));
