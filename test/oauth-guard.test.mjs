import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../cloudflare/worker.js", import.meta.url), "utf8");

function extractScopes(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `Déclaration introuvable : ${declaration}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  assert.ok(open !== -1 && close !== -1, `Tableau de scopes invalide : ${declaration}`);
  const block = source.slice(open + 1, close);
  return block.match(/https:\/\/www\.googleapis\.com\/auth\/[a-z.]+/g) || [];
}

test("les autorisations Google de l'application et du Worker restent cohérentes", () => {
  const appScopes = extractScopes(app, "const SCOPES =");
  const workerScopes = extractScopes(worker, "const GOOGLE_SCOPES =");
  assert.deepEqual([...appScopes].sort(), [...workerScopes].sort(),
    "Les scopes Google API doivent être identiques dans public/app.js et cloudflare/worker.js.");
});

test("YouTube garde une autorisation séparée de la connexion principale", () => {
  const scopes = [...extractScopes(app, "const SCOPES ="), ...extractScopes(worker, "const GOOGLE_SCOPES =")];
  assert.ok(!scopes.includes("https://www.googleapis.com/auth/youtube.readonly"),
    "Ne pas ajouter youtube.readonly à la demande OAuth principale : cela a déjà provoqué l'erreur 400 avec Drive.");
});
