// Lecteur Pro — application de bureau Windows (Electron 22, compatible Windows 7 / 8 / 8.1 / 10 / 11).
//  • Accès DIRECT aux dossiers de l'ordinateur : ils sont mémorisés d'une ouverture à l'autre, sans confirmation.
//  • Les directs YouTube (sport, franceinfo, RDC…) sont retrouvés ici, sans connexion Google.
const { app, BrowserWindow, session, shell, Menu, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const ORIGINE = 'https://weundeprince6-droid.github.io';
const URL_EN_LIGNE = ORIGINE + '/MY-WORLD-RS/television.html';
const COPIE_LOCALE = path.join(__dirname, 'television.html'); // utilisée si l'ordinateur est hors ligne

// Schéma interne qui sert les fichiers audio/vidéo/photo de l'ordinateur au lecteur (avec lecture par morceaux)
protocol.registerSchemesAsPrivileged([{ scheme: 'lecteurfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]);

// Les vidéos et radios démarrent sans exiger un clic préalable
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let fenetre = null;
let UA = '';

const estNotrePage = (url) => {
  try { const u = new URL(url); return u.origin === ORIGINE || u.protocol === 'file:'; } catch (e) { return false; }
};

// ---------- Dossiers autorisés (choisis par l'utilisateur), mémorisés dans le profil de l'application ----------
let racines = [];
const fichierRacines = () => path.join(app.getPath('userData'), 'dossiers.json');
function chargerRacines() { try { racines = JSON.parse(fs.readFileSync(fichierRacines(), 'utf8')).filter((x) => typeof x === 'string'); } catch (e) { racines = []; } }
function autoriser(p) {
  const r = path.resolve(p);
  if (!racines.some((x) => x.toLowerCase() === r.toLowerCase())) {
    racines.push(r);
    try { fs.writeFileSync(fichierRacines(), JSON.stringify(racines)); } catch (e) {}
  }
}
function estAutorise(p) {
  if (!p || typeof p !== 'string') return false;
  const r = path.resolve(p).toLowerCase();
  return racines.some((x) => { const y = x.toLowerCase(); return r === y || r.startsWith(y.endsWith(path.sep) ? y : y + path.sep); });
}

const MIMES = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', ogv: 'video/ogg', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wma: 'audio/x-ms-wma',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', srt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8'
};
const mimeDe = (p) => MIMES[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream';
const cheminDepuisUrl = (u) => {
  const seg = new URL(u).pathname.split('/')[1] || '';
  return Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
};

function servirFichier(req, cb) {
  try {
    const p = cheminDepuisUrl(req.url);
    if (!estAutorise(p)) return cb({ statusCode: 403 });
    const taille = fs.statSync(p).size;
    const entetes = { 'Content-Type': mimeDe(p), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (taille === 0) return cb({ statusCode: 200, headers: { ...entetes, 'Content-Length': '0' }, data: Buffer.alloc(0) });
    let debut = 0, fin = taille - 1, statut = 200;
    const plage = req.headers && (req.headers.Range || req.headers.range);
    const m = plage && /bytes=(\d*)-(\d*)/.exec(plage);
    if (m) {
      if (m[1] !== '') { debut = parseInt(m[1], 10); if (m[2] !== '') fin = Math.min(parseInt(m[2], 10), taille - 1); }
      else if (m[2] !== '') { debut = Math.max(0, taille - parseInt(m[2], 10)); }
      statut = 206; entetes['Content-Range'] = 'bytes ' + debut + '-' + fin + '/' + taille;
    }
    if (debut > fin || debut >= taille) return cb({ statusCode: 416, headers: { 'Content-Range': 'bytes */' + taille } });
    entetes['Content-Length'] = String(fin - debut + 1);
    cb({ statusCode: statut, headers: entetes, data: fs.createReadStream(p, { start: debut, end: fin }) });
  } catch (e) { cb({ statusCode: 404 }); }
}

// ---------- Pont entre la page du lecteur et l'ordinateur ----------
function configurerPont() {
  const sur = (e) => e.sender && estNotrePage(e.sender.getURL());
  ipcMain.handle('nat:pick-dir', async (e) => {
    if (!sur(e)) return null;
    const r = await dialog.showOpenDialog(fenetre, { title: 'Choisir un dossier', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    autoriser(r.filePaths[0]); return r.filePaths[0];
  });
  ipcMain.handle('nat:pick-files', async (e) => {
    if (!sur(e)) return [];
    const r = await dialog.showOpenDialog(fenetre, { title: 'Choisir des fichiers', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    r.filePaths.forEach(autoriser); return r.filePaths;
  });
  // Fichier ou dossier glissé dans la fenêtre : l'utilisateur vient de le désigner lui-même
  ipcMain.handle('nat:adopt', async (e, p) => {
    if (!sur(e) || typeof p !== 'string') return null;
    try { const st = fs.statSync(p); autoriser(p); return { isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }; } catch (err) { return null; }
  });
  ipcMain.handle('nat:stat', async (e, p) => {
    if (!sur(e) || !estAutorise(p)) return null;
    try { const st = fs.statSync(p); return { isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }; } catch (err) { return null; }
  });
  ipcMain.handle('nat:list', async (e, dir) => {
    if (!sur(e) || !estAutorise(dir)) return [];
    const out = [];
    let noms; try { noms = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (err) { return []; }
    for (let i = 0; i < noms.length; i += 64) {
      await Promise.all(noms.slice(i, i + 64).map(async (d) => {
        try { const st = await fs.promises.stat(path.join(dir, d.name)); out.push({ name: d.name, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }); } catch (err) {}
      }));
    }
    return out;
  });
  ipcMain.handle('nat:read', async (e, p, debut, fin) => {
    if (!sur(e) || !estAutorise(p)) return null;
    const n = Math.max(0, Math.min(fin - debut, 256 * 1024 * 1024));
    const fh = await fs.promises.open(p, 'r');
    try { const buf = Buffer.alloc(n); const { bytesRead } = await fh.read(buf, 0, n, debut); return buf.subarray(0, bytesRead); } finally { await fh.close(); }
  });
  // Direct YouTube d'une chaîne : recherche dans la liste « En direct » de YouTube, sans clé ni connexion Google
  ipcMain.handle('nat:yt-live', async (e, o) => {
    if (!sur(e) || !o || typeof o.q !== 'string') return null;
    try { return await ytDirect(o); } catch (err) { return null; }
  });
}

function httpGet(url, essais = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', 'Accept-Encoding': 'identity', Cookie: 'CONSENT=YES+cb.20210328-17-p0.fr+FX+000; SOCS=CAI' }, timeout: 15000
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && essais > 0) { res.resume(); return resolve(httpGet(new URL(res.headers.location, url).toString(), essais - 1)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => { d += c; if (d.length > 8e6) res.destroy(); });
      res.on('end', () => resolve(d)); res.on('close', () => resolve(d)); res.on('error', reject);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('délai dépassé')));
  });
}
async function ytDirect({ q, channelRe }) {
  const html = await httpGet('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgJAAQ%253D%253D');
  let re = null; try { re = channelRe ? new RegExp(channelRe, 'i') : null; } catch (e) {}
  const parts = html.split('"videoRenderer":{"videoId":"').slice(1);
  for (const part of parts) {
    const id = part.slice(0, 11);
    if (!/^[\w-]{11}$/.test(id)) continue;
    const bloc = part.slice(0, 6000);
    const chaine = (bloc.match(/"ownerText":\{"runs":\[\{"text":"([^"]*)"/) || bloc.match(/"longBylineText":\{"runs":\[\{"text":"([^"]*)"/) || [])[1] || '';
    const titre = (bloc.match(/"title":\{"runs":\[\{"text":"([^"]*)"/) || [])[1] || '';
    if (re && !re.test(chaine) && !re.test(titre)) continue;
    return { id, chaine };
  }
  return null;
}

function configurerPermissions() {
  const ses = session.defaultSession;
  const AUTORISEES = new Set(['fullscreen', 'media', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((wc, permission, rappel) => rappel(AUTORISEES.has(permission) && estNotrePage(wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origine) => AUTORISEES.has(permission) && (!wc ? estNotrePage(origine) : estNotrePage(wc.getURL())));
  // YouTube refuse parfois les navigateurs qui se déclarent « Electron » : on se présente comme Chrome
  UA = ses.getUserAgent().replace(/\s*Electron\/\S+/i, '').replace(/\s*lecteur-pro\/\S+/i, '');
  ses.setUserAgent(UA);
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720, minHeight: 480,
    backgroundColor: '#14141a', title: 'Lecteur Pro', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  Menu.setApplicationMenu(null);
  fenetre.webContents.setUserAgent(UA);

  // Liens externes (Spotify, sites de chaînes…) : dans le navigateur habituel, pas dans la fenêtre du lecteur
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Un fichier lâché sur la fenêtre ne doit jamais faire quitter le lecteur
  fenetre.webContents.on('will-navigate', (ev, url) => { if (!estNotrePage(url)) ev.preventDefault(); });

  // Hors ligne : on ouvre la copie intégrée à l'application
  let repli = false;
  fenetre.webContents.on('did-fail-load', (e, code, desc, url, principal) => {
    if (principal && !repli && /^https?:/i.test(url) && code !== -3) { repli = true; fenetre.loadFile(COPIE_LOCALE); }
  });

  fenetre.loadURL(URL_EN_LIGNE);
  fenetre.on('closed', () => { fenetre = null; });
}

app.on('second-instance', () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.whenReady().then(() => {
  chargerRacines();
  protocol.registerStreamProtocol('lecteurfile', servirFichier);
  configurerPermissions(); configurerPont(); creerFenetre();
});
app.on('window-all-closed', () => app.quit());
