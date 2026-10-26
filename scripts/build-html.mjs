// Fabrique un fichier HTML unique (dist/My-World-RS.html) : page, style et code réunis.
// Usage : npm run build:html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => readFileSync(join(racine, "public", f), "utf8");

const importsLocaux = /import\s*\{[^}]*\}\s*from\s*"\.\/[^"]+";\n?/g;
const sansExport = (code) => code.replace(/^export\s+/gm, "");

const config = sansExport(lire("config.js"));
const core = sansExport(lire("core.js"));
const firestore = sansExport(lire("firestore.js"));
let app = lire("app.js").replace(importsLocaux, "");

// Les imports Firebase (CDN) restent en tête du script
const importsCdn = [...app.matchAll(/import\s*\{[^}]*\}\s*from\s*"https:[^"]+";\n?/g)].map((m) => m[0]);
for (const i of importsCdn) app = app.replace(i, "");

// En fichier unique, la configuration est déjà dans le script : plus d'import dynamique
const blocConfig = /let config;\ntry \{[\s\S]*?\n\}\nconst \{ firebaseConfig, reglages, bases \} = config;\n/;
if (!blocConfig.test(app)) throw new Error("Bloc de configuration introuvable dans app.js : adaptez build-html.mjs");
app = app.replace(blocConfig, "");

const script = [
  importsCdn.join(""),
  "// ===== config.js =====", config,
  "// ===== core.js =====", core,
  "// ===== firestore.js =====", firestore,
  "// ===== app.js =====", app,
].join("\n");

let html = lire("index.html");
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${lire("style.css")}\n</style>`);
html = html.replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${script}\n</script>`);
if (html.includes('src="app.js"') || html.includes('href="style.css"')) throw new Error("Remplacement incomplet");

mkdirSync(join(racine, "dist"), { recursive: true });
const sortie = join(racine, "dist", "My-World-RS.html");
writeFileSync(sortie, html);
writeFileSync(join(racine, "dist", "_script-controle.mjs"), script);
console.log(`Écrit : ${sortie} (${Math.round(html.length / 1024)} Ko)`);
