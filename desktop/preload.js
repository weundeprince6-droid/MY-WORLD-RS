// Pont entre le lecteur (page web) et l'ordinateur, dans l'application Windows « Lecteur Pro ».
// Il remplace les « sélecteurs de fichiers » du navigateur par un accès direct aux dossiers :
// la bibliothèque est mémorisée d'une ouverture à l'autre, sans aucune confirmation.
const { ipcRenderer } = require('electron');
const inv = (canal, ...a) => ipcRenderer.invoke(canal, ...a);

const MIMES = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', ogv: 'video/ogg', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', srt: 'text/plain', vtt: 'text/vtt'
};
const mimeDe = (nom) => MIMES[(nom.split('.').pop() || '').toLowerCase()] || '';
const nomDe = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const joindre = (a, b) => a + (/[\\/]$/.test(a) ? '' : a.includes('\\') ? '\\' : '/') + b;
const b64 = (s) => { let t = ''; for (const x of new TextEncoder().encode(s)) t += String.fromCharCode(x); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const urlFichier = (p) => 'lecteurfile://local/' + b64(p) + '/' + encodeURIComponent(nomDe(p));

async function lire(p, a, b) {
  const u8 = await inv('nat:read', p, a, b);
  if (!u8) throw new Error('lecture refusée');
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// « Fichier » paresseux : rien n'est lu tant qu'on ne le demande pas (les vidéos de plusieurs Go restent sur le disque)
class NatBlob extends Blob {
  constructor(chemin, nom, taille, mtime, off, len) {
    super([], { type: mimeDe(nom) });
    Object.defineProperty(this, '_n', { value: { chemin, nom, taille, mtime, off: off || 0, len: len == null ? taille : len } });
  }
  get size() { return this._n.len; }
  get name() { return this._n.nom; }
  get lastModified() { return this._n.mtime; }
  get webkitRelativePath() { return ''; }
  slice(a, b, type) {
    const n = this._n;
    let s = a == null ? 0 : a < 0 ? Math.max(n.len + a, 0) : Math.min(a, n.len);
    let e = b == null ? n.len : b < 0 ? Math.max(n.len + b, 0) : Math.min(b, n.len);
    const r = new NatBlob(n.chemin, n.nom, n.taille, n.mtime, n.off + s, Math.max(e - s, 0));
    return r;
  }
  async arrayBuffer() { const n = this._n; return n.len ? lire(n.chemin, n.off, n.off + n.len) : new ArrayBuffer(0); }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
  stream() {
    const n = this._n; let pos = 0;
    return new ReadableStream({
      async pull(c) {
        if (pos >= n.len) { c.close(); return; }
        const fin = Math.min(n.len, pos + 4 * 1024 * 1024);
        c.enqueue(new Uint8Array(await lire(n.chemin, n.off + pos, n.off + fin))); pos = fin;
      }
    });
  }
  // Vrai fichier en mémoire (photos, documents, vignettes) quand le lecteur en a besoin
  async materialiser() { return new File([await this.arrayBuffer()], this._n.nom, { type: mimeDe(this._n.nom), lastModified: this._n.mtime }); }
}

// Équivalent des « handles » du navigateur, mais fondé sur le chemin réel. Uniquement des données simples :
// ils peuvent être enregistrés dans la base du lecteur puis reconstruits à la prochaine ouverture (voir revive).
class NatHandle {
  constructor(kind, chemin, nom, extra) {
    this.__nat = true; this.kind = kind; this.path = chemin; this.name = nom || nomDe(chemin);
    if (extra) { if (extra.size != null) this.size = extra.size; const m = extra.mtimeMs != null ? extra.mtimeMs : extra.mtime; if (m != null) this.mtime = Math.floor(m); }
  }
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
  async isSameEntry(o) { return !!o && !!o.__nat && String(o.path).toLowerCase() === this.path.toLowerCase(); }
  async getFile() {
    let { size, mtime } = this;
    if (size == null || mtime == null) { const st = await inv('nat:stat', this.path); if (!st) throw new DOMException('Fichier introuvable', 'NotFoundError'); size = st.size; mtime = Math.floor(st.mtimeMs); }
    return new NatBlob(this.path, this.name, size, mtime);
  }
  async *entries() {
    const liste = await inv('nat:list', this.path);
    for (const e of liste) yield [e.name, new NatHandle(e.isDir ? 'directory' : 'file', joindre(this.path, e.name), e.name, e)];
  }
  async *values() { for await (const [, h] of this.entries()) yield h; }
  async *keys() { for await (const [n] of this.entries()) yield n; }
  async getDirectoryHandle(nom) { return new NatHandle('directory', joindre(this.path, nom), nom); }
  async getFileHandle(nom) { return new NatHandle('file', joindre(this.path, nom), nom); }
}
const vers = (v, vus) => {
  if (!vus.has(v)) vus.set(v, new NatHandle(v.kind, v.path, v.name, v));
  return vus.get(v);
};
function revive(v, vus) {
  vus = vus || new Map();
  if (Array.isArray(v)) { v.forEach((x, i) => { v[i] = revive(x, vus); }); return v; }
  if (!v || typeof v !== 'object' || v instanceof NatHandle || Object.getPrototypeOf(v) !== Object.prototype) return v;
  if (v.__nat) return vers(v, vus);
  for (const k of ['handle', 'dirHandle']) if (v[k]) v[k] = revive(v[k], vus);
  if (Array.isArray(v.subs)) revive(v.subs, vus);
  return v;
}
window.__reviveNat = (v) => revive(v);

// Sélecteurs de dossiers et de fichiers
window.showDirectoryPicker = async () => {
  const p = await inv('nat:pick-dir');
  if (!p) throw new DOMException('Annulé', 'AbortError');
  return new NatHandle('directory', p, nomDe(p));
};
window.showOpenFilePicker = async () => {
  const ps = await inv('nat:pick-files');
  if (!ps || !ps.length) throw new DOMException('Annulé', 'AbortError');
  return ps.map((p) => new NatHandle('file', p, nomDe(p)));
};
// Fichiers et dossiers glissés dans la fenêtre
DataTransferItem.prototype.getAsFileSystemHandle = async function () {
  const f = this.getAsFile();
  if (!f || !f.path) return null;
  const st = await inv('nat:adopt', f.path);
  return st ? new NatHandle(st.isDir ? 'directory' : 'file', f.path, nomDe(f.path), st) : null;
};

// Lecture : les gros fichiers sont servis par le disque (lecture par morceaux), jamais copiés en mémoire
const creer = URL.createObjectURL.bind(URL), revoquer = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (o) => (o instanceof NatBlob && o._n.off === 0 && o._n.len === o._n.taille ? urlFichier(o._n.chemin) : creer(o));
URL.revokeObjectURL = (u) => { if (typeof u === 'string' && u.startsWith('lecteurfile:')) return; revoquer(u); };
// Le son passe par l'égaliseur du lecteur : le fichier doit être déclaré « partageable » (CORS) pour ne pas devenir muet
try {
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true, enumerable: d.enumerable, get: d.get,
    set(v) { if (typeof v === 'string' && v.startsWith('lecteurfile:') && this.crossOrigin !== 'anonymous') this.crossOrigin = 'anonymous'; d.set.call(this, v); }
  });
} catch (e) {}
const imageBitmap = window.createImageBitmap.bind(window);
window.createImageBitmap = async (src, ...a) => imageBitmap(src instanceof NatBlob ? await src.materialiser() : src, ...a);

// Directs YouTube : l'application My World RS (connexion Google) n'est pas là, on répond à sa place
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.source !== 'mwrs-tv-drive') return;
  if (d.action === 'yt' && d.kind === 'live') {
    let live = null;
    try { live = await inv('nat:yt-live', { q: d.q, channelRe: d.channelRe, lang: d.lang }); } catch (err) {}
    window.postMessage({ source: 'mwrs-drive', action: 'yt', kind: 'live', station: d.station, live: live ? { id: live.id } : null, raison: live ? undefined : 'introuvable' }, '*');
  } else if (d.action === 'list' || d.action === 'open') {
    window.postMessage({ source: 'mwrs-drive', action: 'error', message: 'Google Drive n’est pas disponible dans l’application Windows : utilisez le lecteur dans votre navigateur.' }, '*');
  }
});
