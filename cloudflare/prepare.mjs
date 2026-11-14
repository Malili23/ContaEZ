import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releases } from './releases.mjs';

const cloudflare = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(cloudflare, '..');
const packageInfo = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));
const edition = packageInfo.version;
const staging = path.join(cloudflare, 'staging');
await mkdir(staging, { recursive: true });
const output = await mkdtemp(path.join(staging, 'contaez-'));
const downloads = path.join(output, 'downloads');
const sources = {
  release: path.resolve(app, '../Distribucion'),
  oldSite: path.join(app, 'site/dist/downloads'),
};
const origin = new URL(process.argv[2] || 'https://contaez-mexico.pages.dev');
if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Usa el origen HTTPS de Cloudflare Pages.');

const editionIndex = releases.findIndex(release => release.version === edition);
if (editionIndex < 0) throw new Error(`Agrega ${edition} al historial de versiones.`);
const libraries = releases.slice(editionIndex);
const filePath = file => `/downloads/${encodeURIComponent(file.name)}`;
const checksums = [];
await mkdir(downloads);

function verifyFile(file, data) {
  if (file.endsWith('.exe') && data.subarray(0, 2).toString() !== 'MZ') throw new Error(`No es un instalador de Windows: ${file}`);
  if (file.endsWith('.dmg') && data.subarray(-512, -508).toString() !== 'koly') throw new Error(`No es un DMG: ${file}`);
  if (file.endsWith('.zip') && data.readUInt32LE(0) !== 0x04034b50) throw new Error(`No es un ZIP: ${file}`);
}

for (const release of libraries) {
  const files = [];
  for (const file of release.files) {
    const source = path.join(sources[file.from], file.source || file.name);
    try {
      await access(source);
    } catch {
      if (file.optional) continue;
      throw new Error(`Falta el paquete: ${file.name}`);
    }
    const data = await readFile(source);
    verifyFile(file.name, data);
    await writeFile(path.join(downloads, file.name), data);
    checksums.push(`${createHash('sha256').update(data).digest('hex')}  ${file.name}`);
    files.push(file);
  }
  release.files = files;
}

const web = path.join(app, 'dist');
for (const directory of ['assets', 'ocr', 'third-party']) {
  await cp(path.join(web, directory), path.join(output, 'app', directory), { recursive: true });
}
await cp(path.join(web, 'index.html'), path.join(output, 'app/index.html'));
await cp(path.join(web, 'addin'), path.join(output, 'addin'), { recursive: true });
const addinHtmlPath = path.join(output, 'addin/index.html');
const addinHtml = await readFile(addinHtmlPath, 'utf8');
await writeFile(addinHtmlPath, addinHtml.replaceAll('../assets/', '/app/assets/'));

const manifest = await readFile(path.join(app, 'addin/manifest.template.xml'), 'utf8');
await writeFile(path.join(downloads, 'ContaEZ-Excel.xml'), manifest.replaceAll('__ORIGIN__', origin.origin));
await cp(path.join(sources.release, 'Mac/Guia-Mac.txt'), path.join(downloads, 'Guia-Mac.txt'));
await writeFile(path.join(downloads, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
await cp(path.join(cloudflare, 'styles.css'), path.join(output, 'styles.css'));
await cp(path.join(cloudflare, '404.html'), path.join(output, '404.html'));
await cp(path.join(cloudflare, '_headers'), path.join(output, '_headers'));
await writeFile(path.join(output, 'version.json'), `${JSON.stringify({ web: edition, versions: libraries.map(release => ({version: release.version, files: release.files.map(file => file.name)})) }, null, 2)}\n`);

const releaseHtml = libraries.map(release => `<article class="release"><div><h3>${release.version}</h3><p>${release.notes}</p></div><div class="release-files">${release.files.map(file => `<a href="${filePath(file)}" download aria-label="Descargar ${file.label} ${release.version}">${file.label}</a>`).join('')}</div></article>`).join('\n');
const windows = libraries[0].files.find(file => file.label === 'Windows');
const code = libraries[0].files.find(file => file.label === 'Código fuente');
const macRelease = libraries.find(release => release.files.some(file => file.label === 'Mac (DMG)'));
const mac = macRelease.files.find(file => file.label === 'Mac (DMG)');
const template = await readFile(path.join(cloudflare, 'index.html'), 'utf8');
await writeFile(path.join(output, 'index.html'), template.replaceAll('__VERSION__', edition).replace('__WINDOWS__', filePath(windows)).replace('__MAC__', filePath(mac)).replace('__MAC_VERSION__', macRelease.version).replace('__SOURCE__', filePath(code)).replace('__RELEASES__', releaseHtml));

for (const relative of await readdir(output, { recursive: true })) {
  const information = await stat(path.join(output, relative));
  if (!information.isFile()) continue;
  if (information.size > 25 * 1024 ** 2) throw new Error(`El archivo supera 25 MiB: ${relative}`);
  if (/\.(?:xlsx|xlsm|contaez|sqlite|db|log|key|p12|pfx)$/i.test(relative)) throw new Error(`Archivo privado en el sitio: ${relative}`);
}
console.log(JSON.stringify({ output, edition, installerFiles: checksums.length }));
