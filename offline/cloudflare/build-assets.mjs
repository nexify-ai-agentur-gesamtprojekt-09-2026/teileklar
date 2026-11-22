// Erzeugt assets.generated.js aus den Dateien in offline/, damit der Worker
// dieselben Inhalte ausliefert wie nginx. Nach jeder Änderung an offline.html,
// sw.js, favicon.svg, robots.txt, sitemap.xml, og.jpg oder den Schriften ausführen:
//
//     node offline/cloudflare/build-assets.mjs
//
// Der Test (worker.test.mjs) schlägt fehl, wenn die erzeugte Datei veraltet ist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const offline = path.resolve(hier, '..');

export const QUELLEN = {
  OFFLINE_HTML: 'offline.html',
  SW_JS: 'sw.js',
  FAVICON_SVG: 'favicon.svg',
  ROBOTS_TXT: 'robots.txt',
  SITEMAP_XML: 'sitemap.xml',
};

// Binärdateien (Schriften, Vorschaubild) werden als Base64 eingebettet.
export const BINAER = {
  FONT_ARCHIVO_B64: 'fonts/archivo-latin-wght-normal.woff2',
  FONT_PLEX_MONO_B64: 'fonts/ibm-plex-mono-latin-500-normal.woff2',
  OG_JPG_B64: 'og.jpg',
};

export function erzeuge() {
  let text = '// ERZEUGT von build-assets.mjs – nicht von Hand ändern.\n';
  for (const [name, datei] of Object.entries(QUELLEN)) {
    const inhalt = fs.readFileSync(path.join(offline, datei), 'utf8');
    text += `export const ${name} = ${JSON.stringify(inhalt)};\n`;
  }
  for (const [name, datei] of Object.entries(BINAER)) {
    text += `export const ${name} = ${JSON.stringify(fs.readFileSync(path.join(offline, datei)).toString('base64'))};\n`;
  }
  return text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(hier, 'assets.generated.js'), erzeuge());
  console.log('assets.generated.js geschrieben');
}
