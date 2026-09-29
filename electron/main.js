// Envoltorio de escritorio: arranca el servidor del juego dentro de la app y abre la ventana. Si existe "servidor.txt" junto al ejecutable (o SERVER_URL),
// se conecta a ese servidor en línea en vez de al local (para jugar por internet con las salas de otros).
const { app, BrowserWindow, Menu } = require('electron'), fs = require('fs'), path = require('path');
let url = process.env.SERVER_URL;
try { if (!url) url = fs.readFileSync(path.join(path.dirname(process.execPath), 'servidor.txt'), 'utf8').trim(); } catch {}
if (!url) { process.env.PORT = process.env.PORT || '3477'; require('../server.js'); url = `http://localhost:${process.env.PORT}`; } // servidor local (también sirve para jugar en red local)
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const w = new BrowserWindow({ width: 1280, height: 800, backgroundColor: '#010308', autoHideMenuBar: true, title: 'Sistema Solar Procedural', webPreferences: { contextIsolation: true } });
  w.loadURL(url); w.on('page-title-updated', e => e.preventDefault());
  w.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F11') w.setFullScreen(!w.isFullScreen()); });
});
app.on('window-all-closed', () => app.quit());
