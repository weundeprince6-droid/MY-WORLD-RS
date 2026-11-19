import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(mobileDir, '..');
const webDir = path.join(mobileDir, 'www');

const sourceHtml = path.join(repoDir, 'public', 'webs-classroom.html');
const sourceConfig = path.join(repoDir, 'public', 'config.js');

await mkdir(webDir, { recursive: true });

const html = await readFile(sourceHtml, 'utf8');
const config = await readFile(sourceConfig, 'utf8');

// L'application mobile embarque la page Academy existante et sa configuration.
// Le code métier, l'authentification et les rôles restent ceux du site actuel.
await writeFile(path.join(webDir, 'index.html'), html, 'utf8');
await copyFile(sourceConfig, path.join(webDir, 'config.js'));

console.log('WEBSERVICES ACADEMY synchronisée dans mobile/www.');
console.log(`HTML : ${html.length.toLocaleString('fr-FR')} caractères`);
console.log(`Configuration Firebase : ${config.length.toLocaleString('fr-FR')} caractères`);
