// Téléchargement de vidéos YouTube pour « Lecteur Pro » (usage personnel).
// Ce fichier ne contient que des fonctions sans effet de bord sur l'application : elles sont testées
// dans test/telechargement.test.mjs. main.js s'en sert pour lancer yt-dlp et ffmpeg.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

// ---------- Adresse de la vidéo ----------
// Accepte un lien YouTube (watch, youtu.be, shorts, live, embed, music) ou un identifiant de 11 caractères.
// Une liste de lecture n'est jamais téléchargée en entier : seule la vidéo désignée l'est.
function idVideo(entree) {
  if (typeof entree !== 'string') return null;
  const s = entree.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
  if (!/^(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/i.test(u.hostname)) return null;
  let id = null;
  if (/^youtu\.be$/i.test(u.hostname)) id = u.pathname.split('/')[1];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else { const m = /^\/(?:shorts|live|embed|v)\/([\w-]{11})/.exec(u.pathname); id = m && m[1]; }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
const urlVideo = (id) => 'https://www.youtube.com/watch?v=' + id;

// ---------- Arguments de yt-dlp ----------
const FORMATS = ['mp4', 'mp3'];
function argsYtdlp({ id, format, dossier, ffmpeg, fichierChemin }) {
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('identifiant de vidéo invalide');
  if (!FORMATS.includes(format)) throw new Error('format inconnu');
  const a = [
    '--ignore-config', '--no-playlist', '--no-mtime', '--newline', '--color', 'never',
    '--windows-filenames',
    '--encoding', 'utf-8',
    '-P', dossier,
    '-o', '%(title).150B [%(id)s].%(ext)s',
    '--ffmpeg-location', ffmpeg,
    '--print-to-file', 'after_move:filepath', fichierChemin
  ];
  if (format === 'mp3') a.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  else a.push('-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4');
  a.push('--', urlVideo(id));
  return a;
}

// ---------- Lecture de ce que yt-dlp écrit ----------
// Retourne { pct } pour une ligne de progression, { phase: 'conversion' } pour la fusion/conversion, sinon null.
function lireLigne(ligne) {
  const m = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/.exec(ligne);
  if (m) return { pct: Math.min(100, parseFloat(m[1])) };
  if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM4a|FixupM3u8)\]/.test(ligne)) return { phase: 'conversion' };
  return null;
}

// Message clair, en français, à partir de ce que yt-dlp a écrit en cas d'échec
function messageErreur(texte) {
  const t = String(texte || '');
  if (/confirm you.?re not a bot|sign in to confirm/i.test(t)) return 'YouTube demande de prouver que vous n’êtes pas un robot et bloque ce téléchargement. Réessayez plus tard.';
  if (/private video/i.test(t)) return 'Cette vidéo est privée : elle ne peut pas être téléchargée.';
  if (/members.only|join this channel/i.test(t)) return 'Cette vidéo est réservée aux abonnés de la chaîne.';
  if (/confirm your age|age.restricted|inappropriate for some users/i.test(t)) return 'Cette vidéo est réservée aux adultes : YouTube exige une connexion pour la lire.';
  if (/not available in your country|blocked it in your country|geo.?restrict/i.test(t)) return 'Cette vidéo n’est pas disponible dans votre pays.';
  if (/video unavailable|has been removed|no longer available|account.*terminated/i.test(t)) return 'Cette vidéo n’est plus disponible.';
  if (/premiere will begin|live event will begin|this live event/i.test(t)) return 'Ce direct n’a pas encore commencé.';
  if (/is live|live stream/i.test(t) && /cannot|unsupported|not supported/i.test(t)) return 'Un direct en cours ne peut pas être téléchargé. Attendez la fin de l’émission.';
  if (/requested format is not available/i.test(t)) return 'Aucun format compatible n’a été trouvé pour cette vidéo.';
  if (/http error 403|unable to download|unable to connect|timed out|getaddrinfo|network is unreachable|connection (?:reset|refused)/i.test(t)) return 'Connexion à YouTube impossible ou interrompue. Vérifiez Internet puis réessayez.';
  if (/no space left|disk full|not enough space/i.test(t)) return 'Il n’y a plus assez de place sur le disque.';
  if (/permission denied|access is denied|errno 13/i.test(t)) return 'Impossible d’écrire dans le dossier choisi. Choisissez-en un autre.';
  return 'Le téléchargement a échoué.';
}

// Erreurs qui viennent souvent d'un yt-dlp devenu trop ancien (YouTube change régulièrement) : on tente alors une mise à jour
const peutVenirDuVieuxOutil = (texte) => /unable to extract|nsig|signature|http error 403|player response|unsupported url|failed to extract/i.test(String(texte || ''));

// ---------- Vérification des outils téléchargés (somme SHA-256) ----------
// Fichiers « checksums » : une ligne par fichier, « <sha256> <nom> » (le nom peut être précédé d'une * en mode binaire).
function lireSommes(texte) {
  const out = new Map();
  for (const l of String(texte || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(l);
    if (m) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}
function sha256Fichier(chemin) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(chemin).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
function hashFichier(chemin, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(chemin).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
// python.org ne publie que des sommes MD5 : le fichier vient de python.org en HTTPS, la somme sert à détecter un fichier abîmé ou remplacé
async function verifierMd5(chemin, attendu) {
  if ((await hashFichier(chemin, 'md5')) !== String(attendu).toLowerCase()) throw new Error('le fichier téléchargé est corrompu');
}
async function verifierFichier(chemin, sommes, nom) {
  const attendu = sommes.get(nom);
  if (!attendu) throw new Error('somme de contrôle introuvable pour ' + nom);
  if ((await sha256Fichier(chemin)) !== attendu) throw new Error('le fichier téléchargé est corrompu (' + nom + ')');
}

// ---------- Extraction depuis une archive .zip (sans dépendance) ----------
// Suffisant pour les archives de ffmpeg et de Python : on lit l'index (répertoire central), puis on décompresse les fichiers voulus.
async function lireIndexZip(fh) {
  const taille = (await fh.stat()).size;
  const lireOctets = async (pos, n) => { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, pos); return b.subarray(0, bytesRead); };
  const queue = await lireOctets(Math.max(0, taille - 65557), Math.min(taille, 65557));
  const e = queue.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) throw new Error('archive illisible');
  const nb = queue.readUInt16LE(e + 10), tailleIndex = queue.readUInt32LE(e + 12), posIndex = queue.readUInt32LE(e + 16);
  if (nb === 0xffff || tailleIndex === 0xffffffff || posIndex === 0xffffffff) throw new Error('archive trop grande');
  const index = await lireOctets(posIndex, tailleIndex);
  const entrees = []; let p = 0;
  for (let i = 0; i < nb && p + 46 <= index.length; i++) {
    if (index.readUInt32LE(p) !== 0x02014b50) throw new Error('archive illisible');
    const ln = index.readUInt16LE(p + 28), le = index.readUInt16LE(p + 30), lc = index.readUInt16LE(p + 32);
    entrees.push({
      methode: index.readUInt16LE(p + 10), comprime: index.readUInt32LE(p + 20), decomprime: index.readUInt32LE(p + 24),
      debut: index.readUInt32LE(p + 42), nom: index.toString('utf8', p + 46, p + 46 + ln)
    });
    p += 46 + ln + le + lc;
  }
  return { entrees, lireOctets };
}
async function extraireEntree(zip, z, t, destination) {
  if (t.methode !== 0 && t.methode !== 8) throw new Error('compression non gérée');
  const local = await z.lireOctets(t.debut, 30);
  if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) throw new Error('archive illisible');
  const donnees = t.debut + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const sortie = fs.createWriteStream(destination);
  if (t.comprime === 0) { sortie.end(); await new Promise((r) => sortie.on('close', r)); }
  else {
    const source = fs.createReadStream(zip, { start: donnees, end: donnees + t.comprime - 1 });
    await pipeline(...(t.methode === 8 ? [source, zlib.createInflateRaw(), sortie] : [source, sortie]));
  }
  if ((await fs.promises.stat(destination)).size !== t.decomprime) throw new Error('extraction incomplète');
}
async function extraireDuZip(zip, motif, destination) {
  const fh = await fs.promises.open(zip, 'r');
  try {
    const z = await lireIndexZip(fh);
    const t = z.entrees.find((x) => !x.nom.endsWith('/') && motif.test(x.nom));
    if (!t) throw new Error('fichier absent de l’archive');
    await extraireEntree(zip, z, t, destination);
    return t.nom;
  } finally { await fh.close(); }
}
// Tout le contenu d'une archive « à plat » (ou avec sous-dossiers) dans un dossier ; refuse les chemins qui sortiraient du dossier
async function extraireToutDuZip(zip, dossier) {
  const fh = await fs.promises.open(zip, 'r');
  try {
    const z = await lireIndexZip(fh), racine = path.resolve(dossier); let n = 0;
    for (const t of z.entrees) {
      const dest = path.resolve(racine, t.nom);
      if (dest !== racine && !dest.startsWith(racine + path.sep)) throw new Error('archive dangereuse');
      if (t.nom.endsWith('/')) { await fs.promises.mkdir(dest, { recursive: true }); continue; }
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await extraireEntree(zip, z, t, dest); n++;
    }
    return n;
  } finally { await fh.close(); }
}

// ---------- Quelle version des outils pour quel Windows ----------
// Windows 10 et 11 : yt-dlp.exe officiel (32 ou 64 bits).
// Windows 8.1 : yt-dlp.exe ne démarre pas (il demande Windows 10) ; on le fait tourner avec un petit Python 3.12 intégré
//   (Python 3.12 est la dernière version qui accepte Windows 8.1) : même yt-dlp, toujours à jour.
// Windows 7 et 8 : aucune version récente de Python ni de yt-dlp ne fonctionne ; le téléchargement est indisponible.
const PYTHON_8_1 = {
  x64: { zip: 'python-3.12.10-embed-amd64.zip', md5: 'fe8ef205f2e9c3ba44d0cf9954e1abd3' },
  ia32: { zip: 'python-3.12.10-embed-win32.zip', md5: '93beb9042be23d7b5cd528fa15e8fea7' }
};
function choixOutils(arch, releaseOs) {
  const m = /^(\d+)\.(\d+)/.exec(String(releaseOs || ''));
  const version = m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 1000; // 6.3 → 603 (Windows 8.1), 10.0 → 1000
  const trenteDeux = arch === 'ia32';
  const ffmpegZip = trenteDeux ? 'ffmpeg-master-latest-win32-gpl.zip' : 'ffmpeg-master-latest-win64-gpl.zip';
  if (version >= 1000) return { mode: 'exe', ytdlp: trenteDeux ? 'yt-dlp_x86.exe' : 'yt-dlp.exe', ffmpegZip };
  if (version >= 603) return { mode: 'python', ytdlp: 'yt-dlp', python: PYTHON_8_1[trenteDeux ? 'ia32' : 'x64'], ffmpegZip };
  return { mode: 'indisponible', message: 'Le téléchargement demande Windows 8.1, 10 ou 11. Sur cette version de Windows, aucune version récente de l’outil de téléchargement ne fonctionne.' };
}

module.exports = {
  idVideo, urlVideo, FORMATS, argsYtdlp, lireLigne, messageErreur, peutVenirDuVieuxOutil,
  lireSommes, sha256Fichier, verifierFichier, verifierMd5, extraireDuZip, extraireToutDuZip, choixOutils
};
