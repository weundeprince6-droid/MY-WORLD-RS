// Lecteur Pro — application de bureau Windows.
// Elle ouvre le lecteur (television.html) dans une fenêtre dédiée et accorde d'office l'accès aux dossiers :
// plus aucun bouton ni aucune confirmation pour synchroniser la bibliothèque.
const { app, BrowserWindow, session, shell, Menu } = require('electron');
const path = require('path');

const ORIGINE = 'https://weundeprince6-droid.github.io';
const URL_EN_LIGNE = ORIGINE + '/MY-WORLD-RS/television.html';
const COPIE_LOCALE = path.join(__dirname, 'television.html'); // utilisée si l'ordinateur est hors ligne

// Les vidéos et radios démarrent sans exiger un clic préalable
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let fenetre = null;

const estNotrePage = (url) => {
  try { const u = new URL(url); return u.origin === ORIGINE || u.protocol === 'file:'; } catch (e) { return false; }
};

function configurerPermissions() {
  const ses = session.defaultSession;
  // Accès aux fichiers et dossiers (API « File System Access ») : accordé automatiquement, uniquement pour le lecteur
  const AUTORISEES = new Set(['fileSystem', 'fullscreen', 'media', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((wc, permission, rappel) => rappel(AUTORISEES.has(permission) && estNotrePage(wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origine) => AUTORISEES.has(permission) && (!wc ? estNotrePage(origine) : estNotrePage(wc.getURL())));
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720, minHeight: 480,
    backgroundColor: '#14141a', title: 'Lecteur Pro', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  Menu.setApplicationMenu(null);

  // Liens externes (Spotify, sites de chaînes…) : dans le navigateur habituel, pas dans la fenêtre du lecteur
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hors ligne : on ouvre la copie intégrée à l'application
  let repli = false;
  fenetre.webContents.on('did-fail-load', (e, code, desc, url, principal) => {
    if (principal && !repli && /^https?:/i.test(url) && code !== -3) { repli = true; fenetre.loadFile(COPIE_LOCALE); }
  });

  fenetre.loadURL(URL_EN_LIGNE);
  fenetre.on('closed', () => { fenetre = null; });
}

app.on('second-instance', () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.whenReady().then(() => { configurerPermissions(); creerFenetre(); });
app.on('window-all-closed', () => app.quit());
