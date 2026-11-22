// Erzeugt dist/worker.bundle.mjs: der Worker als EINE ES-Modul-Datei ohne Import,
// hochladbar ohne Bundler (z. B. im Cloudflare-Dashboard oder per API).
//
//     node offline/cloudflare/build-assets.mjs   # zuerst: Inhalte aus offline/ übernehmen
//     node offline/cloudflare/build-bundle.mjs
//
// Der Test (worker.test.mjs) schlägt fehl, wenn das Bundle veraltet ist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { erzeuge as erzeugeAssets } from './build-assets.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const NAMEN = ['OFFLINE_HTML', 'SW_JS', 'FAVICON_SVG', 'FONT_ARCHIVO_B64', 'FONT_PLEX_MONO_B64', 'OG_JPG_B64'];
const IMPORTZEILE = `import { ${NAMEN.join(', ')} } from './assets.generated.js';`;

export function erzeugeBundle() {
  const quelle = fs.readFileSync(path.join(hier, 'worker.js'), 'utf8');
  if (!quelle.includes(IMPORTZEILE)) throw new Error('Importzeile in worker.js nicht gefunden');
  const inhalte = erzeugeAssets()
    .split('\n')
    .filter((zeile) => NAMEN.some((name) => zeile.startsWith(`export const ${name} =`)))
    .map((zeile) => zeile.replace(/^export const/, 'const'))
    .join('\n');
  const bundle =
    '// ERZEUGT von build-bundle.mjs aus worker.js und den Dateien in offline/ – nicht von Hand ändern.\n' +
    quelle.replace(IMPORTZEILE, `// Inhalte eingebettet (statt Import):\n${inhalte}`);
  if (/^\s*import\s/m.test(bundle)) throw new Error('Bundle enthält noch einen Import');
  return bundle;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(hier, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(hier, 'dist', 'worker.bundle.mjs'), erzeugeBundle());
  console.log('dist/worker.bundle.mjs geschrieben');
}
