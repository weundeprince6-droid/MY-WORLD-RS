import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
const require = createRequire(import.meta.url);
const T = require("../desktop/telechargement.js");

// Adresses acceptées / refusées
const ID = "dQw4w9WgXcQ";
for (const u of [ID, `https://www.youtube.com/watch?v=${ID}`, `https://youtu.be/${ID}?t=5`, `https://m.youtube.com/watch?v=${ID}&list=PL123`,
  `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`, `music.youtube.com/watch?v=${ID}`, `  ${ID}  `])
  assert.equal(T.idVideo(u), ID, u);
for (const u of ["", null, undefined, 42, "https://evil.com/watch?v=" + ID, "https://youtube.com.evil.com/watch?v=" + ID, "https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/watch?v=court", "javascript:alert(1)", "-o /etc/passwd", ID + "x"])
  assert.equal(T.idVideo(u), null, String(u));

// Arguments : jamais d'injection, toujours « -- » avant l'adresse
const base = { id: ID, dossier: "C:\\Vidéos", ffmpeg: "C:\\o\\ffmpeg.exe", fichierChemin: "C:\\t\\p.txt" };
const mp4 = T.argsYtdlp({ ...base, format: "mp4" }), mp3 = T.argsYtdlp({ ...base, format: "mp3" });
assert.deepEqual(mp4.slice(-2), ["--", "https://www.youtube.com/watch?v=" + ID]);
assert.ok(mp4.includes("--merge-output-format") && !mp4.includes("-x"));
assert.ok(mp3.includes("-x") && mp3.includes("mp3") && !mp3.includes("--merge-output-format"));
assert.ok(mp4.includes("--no-playlist") && mp4.includes("--windows-filenames"));
assert.throws(() => T.argsYtdlp({ ...base, format: "exe" })); assert.throws(() => T.argsYtdlp({ ...base, id: "x; rm -rf", format: "mp4" }));

// Progression
assert.deepEqual(T.lireLigne("[download]  45.3% of   12.00MiB at  1.2MiB/s ETA 00:05"), { pct: 45.3 });
assert.deepEqual(T.lireLigne("[download] 100% of 3.00MiB in 00:02"), { pct: 100 });
assert.deepEqual(T.lireLigne('[Merger] Merging formats into "x.mp4"'), { phase: "conversion" });
assert.deepEqual(T.lireLigne("[ExtractAudio] Destination: x.mp3"), { phase: "conversion" });
assert.equal(T.lireLigne("[youtube] Extracting URL"), null);

// Messages d'erreur
assert.ok(T.messageErreur("ERROR: [youtube] x: Sign in to confirm you’re not a bot").includes("robot"));
assert.ok(T.messageErreur("ERROR: Private video. Sign in").includes("privée"));
assert.ok(T.messageErreur("ERROR: Video unavailable").includes("plus disponible"));
assert.ok(T.messageErreur("ERROR: [Errno 13] Permission denied").includes("dossier"));
assert.equal(T.messageErreur("quelque chose d'inconnu"), "Le téléchargement a échoué.");
assert.ok(T.peutVenirDuVieuxOutil("ERROR: Unable to extract nsig function") && !T.peutVenirDuVieuxOutil("Private video"));

// Sommes de contrôle
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-"));
const f = path.join(dir, "a.bin"); fs.writeFileSync(f, "bonjour");
const h = (await import("node:crypto")).createHash("sha256").update("bonjour").digest("hex");
const sommes = T.lireSommes(`${h}  a.bin\n${"0".repeat(64)} *b.bin\nligne invalide\n`);
assert.equal(sommes.size, 2); assert.equal(sommes.get("a.bin"), h);
await T.verifierFichier(f, sommes, "a.bin");
await assert.rejects(T.verifierFichier(f, sommes, "b.bin"), /corrompu/);
await assert.rejects(T.verifierFichier(f, sommes, "absent.bin"), /introuvable/);

// Archive .zip : un fichier compressé (deflate) et un fichier « stocké »
function zip(entrees) {
  const loc = [], cen = []; let pos = 0;
  for (const [nom, data, methode] of entrees) {
    const comp = methode === 8 ? zlib.deflateRawSync(data) : data, n = Buffer.from(nom);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(methode, 8); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(methode, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(pos, 42);
    loc.push(l, n, comp); cen.push(c, n); pos += 30 + n.length + comp.length;
  }
  const ci = Buffer.concat(cen), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10); fin.writeUInt32LE(ci.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...loc, ci, fin]);
}
const gros = Buffer.alloc(3_000_000, "ffmpeg!");
fs.writeFileSync(path.join(dir, "t.zip"), zip([["ffmpeg-x/LICENSE.txt", Buffer.from("licence"), 0], ["ffmpeg-x/bin/ffmpeg.exe", gros, 8], ["ffmpeg-x/bin/ffprobe.exe", Buffer.from("autre"), 8]]));
const sortie = path.join(dir, "ffmpeg.exe");
assert.equal(await T.extraireDuZip(path.join(dir, "t.zip"), /\/bin\/ffmpeg\.exe$/, sortie), "ffmpeg-x/bin/ffmpeg.exe");
assert.ok(fs.readFileSync(sortie).equals(gros));
await T.extraireDuZip(path.join(dir, "t.zip"), /LICENSE\.txt$/, path.join(dir, "l.txt")); assert.equal(fs.readFileSync(path.join(dir, "l.txt"), "utf8"), "licence");
await assert.rejects(T.extraireDuZip(path.join(dir, "t.zip"), /absent/, path.join(dir, "z")), /absent/);
fs.writeFileSync(path.join(dir, "faux.zip"), "pas une archive"); await assert.rejects(T.extraireDuZip(path.join(dir, "faux.zip"), /x/, path.join(dir, "z")), /illisible/);

// Tout extraire (Python intégré) + somme MD5 + protection contre les chemins dangereux
fs.writeFileSync(path.join(dir, "py.zip"), zip([["python.exe", Buffer.from("exe"), 8], ["python312._pth", Buffer.from("python312.zip\r\n.\r\n"), 0], ["sous/lib.pyd", Buffer.from("pyd"), 8]]));
assert.equal(await T.extraireToutDuZip(path.join(dir, "py.zip"), path.join(dir, "py")), 3);
assert.equal(fs.readFileSync(path.join(dir, "py", "sous", "lib.pyd"), "utf8"), "pyd"); assert.equal(fs.readFileSync(path.join(dir, "py", "python312._pth"), "utf8"), "python312.zip\r\n.\r\n");
fs.writeFileSync(path.join(dir, "mal.zip"), zip([["../evade.txt", Buffer.from("x"), 0]]));
await assert.rejects(T.extraireToutDuZip(path.join(dir, "mal.zip"), path.join(dir, "py2")), /dangereuse/); assert.ok(!fs.existsSync(path.join(dir, "evade.txt")));
const md5 = (await import("node:crypto")).createHash("md5").update("bonjour").digest("hex");
await T.verifierMd5(f, md5); await assert.rejects(T.verifierMd5(f, "0".repeat(32)), /corrompu/);

// Version des outils selon Windows : 11/10 → exe officiel ; 8.1 → Python intégré ; 7 et 8 → indisponible
assert.deepEqual([T.choixOutils("x64", "10.0.22631").mode, T.choixOutils("x64", "10.0.22631").ytdlp], ["exe", "yt-dlp.exe"]);
assert.equal(T.choixOutils("ia32", "10.0.19045").ytdlp, "yt-dlp_x86.exe");
const w81 = T.choixOutils("x64", "6.3.9600");
assert.equal(w81.mode, "python"); assert.equal(w81.ytdlp, "yt-dlp"); assert.equal(w81.python.zip, "python-3.12.10-embed-amd64.zip"); assert.equal(w81.ffmpegZip, "ffmpeg-master-latest-win64-gpl.zip");
assert.equal(T.choixOutils("ia32", "6.3.9600").python.zip, "python-3.12.10-embed-win32.zip");
assert.equal(T.choixOutils("x64", "6.2.9200").mode, "indisponible"); assert.equal(T.choixOutils("x64", "6.1.7601").mode, "indisponible");
assert.ok(T.choixOutils("x64", "6.1.7601").message.includes("8.1"));
fs.rmSync(dir, { recursive: true });
console.log("telechargement : OK");
