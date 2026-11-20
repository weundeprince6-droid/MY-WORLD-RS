const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const ACADEMY_URL = 'https://weundeprince6-droid.github.io/MY-WORLD-RS/webs-classroom.html';

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(ACADEMY_URL);
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Academy] Vérification des mises à jour…');
  });
  autoUpdater.on('update-available', info => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour disponible',
      message: `WEBSERVICES ACADEMY ${info.version} est disponible.`,
      detail: 'Le téléchargement va commencer automatiquement. Vous pourrez redémarrer pour appliquer la mise à jour.',
      buttons: ['OK']
    });
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[Academy] Application à jour.');
  });
  autoUpdater.on('download-progress', progress => {
    console.log(`[Academy] Téléchargement : ${Math.round(progress.percent)} %`);
  });
  autoUpdater.on('update-downloaded', async info => {
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour prête',
      message: `La version ${info.version} de WEBSERVICES ACADEMY est prête.`,
      detail: 'Redémarrez maintenant pour installer la mise à jour, ou choisissez Plus tard.',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', error => {
    console.error('[Academy] Erreur de mise à jour :', error == null ? 'inconnue' : error.message);
  });

  // Vérifie les nouvelles versions publiées sur GitHub Releases.
  setTimeout(() => autoUpdater.checkForUpdates().catch(error => {
    console.error('[Academy] Vérification impossible :', error.message);
  }), 12000);
}

app.whenReady().then(() => {
  app.setAppUserModelId('app.myworldrs.webservicesacademy');
  createWindow();
  configureAutoUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
