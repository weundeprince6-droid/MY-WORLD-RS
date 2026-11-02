// Test de bout en bout dans un navigateur, avec des réponses Google simulées.
// Usage : node test/e2e.cjs public   ou   node test/e2e.cjs dist   (nécessite : npm i -D playwright)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const quoi = process.argv[2] || 'public';            // public | dist
const racine = quoi === 'dist' ? path.join(__dirname, '..', 'dist') : path.join(__dirname, '..', 'public');
const page0 = quoi === 'dist' ? 'My-World-RS.html' : 'index.html';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  const f = path.join(racine, q.url === '/' ? page0 : q.url.split('?')[0]);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
});
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const js = (corps) => ({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: corps });
const json = (o) => ({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(o) });
const aujourdhui = new Date(); const dans30 = new Date(Date.now() + 30 * 60000);
const stubApp = 'export function initializeApp(c){return {c}}';
const stubAuth = (mode) => `
export function getAuth(){return {}}
export class GoogleAuthProvider{ addScope(s){(window.__scopes=window.__scopes||[]).push(s)} setCustomParameters(){} static credentialFromResult(r){return {accessToken:'jeton-test'}} }
export async function signInWithPopup(){ ${mode === 'ok' ? "return {user:{displayName:'Prince Test',email:'t@x.com'}}" : "const e=new Error('x'); e.code='" + mode + "'; throw e"} }
export async function signOut(){}
export function onAuthStateChanged(){}`;

async function scenario(nom, { mode = 'ok', sdkBloque = false }, verifier) {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const appels = [];
  await ctx.route('**/*', async (route) => {
    const u = route.request().url(); const m = route.request().method();
    if (u.startsWith('http://localhost')) return route.continue();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.includes('gstatic.com')) { if (sdkBloque) return route.abort(); return route.fulfill(js(u.includes('firebase-app') ? stubApp : stubAuth(mode))); }
    appels.push(m + ' ' + u.replace(/\?.*/, '').slice(0, 110));
    if (u.includes('gmail.googleapis.com') && u.includes('/messages?')) return route.fulfill(json({ messages: [{ id: 'm1' }, { id: 'm2' }] }));
    if (u.includes('/messages/m1')) return route.fulfill(json({ id: 'm1', threadId: 't1', labelIds: ['UNREAD', 'IMPORTANT'], snippet: 'Merci de régler avant le 5', internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'Marie Dupont <marie@ex.com>' }, { name: 'Subject', value: 'Rappel facture urgente' }] } }));
    if (u.includes('/messages/m2')) return route.fulfill(json({ id: 'm2', threadId: 't2', labelIds: ['CATEGORY_PROMOTIONS'], snippet: 'promo', internalDate: '1', payload: { headers: [{ name: 'From', value: 'Shop <no-reply@shop.com>' }, { name: 'Subject', value: 'Promotion -50%' }] } }));
    if (u.includes('calendar/v3')) return route.fulfill(json({ items: [{ id: 'e1', summary: 'Réunion du comité', start: { dateTime: dans30.toISOString() }, end: { dateTime: new Date(dans30.getTime() + 3600000).toISOString() } }] }));
    if (u.includes(':runAggregationQuery')) return route.fulfill(json([{ result: { aggregateFields: { v: { integerValue: '7' } } } }]));
    if (u.includes(':runQuery')) return route.fulfill(json([]));
    if (u.includes('/documents/members')) return route.fulfill(json({ documents: [
      { name: 'x/members/MBR-1', fields: { epargne: { doubleValue: 100 }, credits: { arrayValue: { values: [{ mapValue: { fields: { amount: { integerValue: '200' }, repaid: { integerValue: '50' }, dueDate: { stringValue: '2026-01-01' } } } }] } } } } ] }));
    return route.fulfill(json({}));
  });
  const logs = []; p.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await p.goto('http://localhost:8765/', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const r = await verifier(p, appels, logs);
  console.log((r.ok ? 'OK    ' : 'ECHEC ') + nom + (r.detail ? ' -> ' + r.detail : '') + (logs.length ? '  [' + logs.join(' | ') + ']' : ''));
  await b.close(); return r.ok;
}
srv.listen(8765, async () => {
  const res = [];
  res.push(await scenario('Connexion réussie : le tableau de bord s\'affiche', {}, async (p, appels) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    const visible = await p.isVisible('#tableau'); const erreur = (await p.textContent('#erreur')).trim();
    const msgs = await p.textContent('#liste-messages'); const agenda = await p.textContent('#liste-agenda');
    const kpis = await p.textContent('#grille-kpis'); const alertes = await p.textContent('#liste-alertes');
    const resume = await p.textContent('#resume');
    const scopes = await p.evaluate(() => window.__scopes);
    const ok = visible && msgs.includes('Marie Dupont') && !msgs.includes('Promotion') && agenda.includes('Réunion du comité')
      && kpis.includes('AVEC LA SAGESSE') && kpis.includes('WEB SERVICES') && alertes.includes('crédit(s) en retard') && alertes.includes('Réunion du comité') && scopes.some(s => s.includes('datastore'));
    return { ok, detail: ok ? 'résumé : ' + resume.trim() + ' | appels Google : ' + appels.length : 'erreur=' + erreur + ' | msgs=' + msgs.slice(0, 80) + ' | kpis=' + kpis.slice(0, 120) };
  }));
  res.push(await scenario('Domaine non autorisé : message clair', { mode: 'auth/unauthorized-domain' }, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(800);
    const t = (await p.textContent('#erreur')).trim(); const actif = !(await p.isDisabled('#bouton-connexion'));
    return { ok: t.includes('localhost') && t.includes('Domaines autorisés') && actif, detail: t.slice(0, 110) };
  }));
  res.push(await scenario('Popup bloquée : message clair', { mode: 'auth/popup-blocked' }, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(500);
    const t = (await p.textContent('#erreur')).trim(); return { ok: t.includes('fenêtre'), detail: t.slice(0, 90) };
  }));
  res.push(await scenario('Réseau Google bloqué : le bouton réagit et explique', { sdkBloque: true }, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(800);
    const t = (await p.textContent('#erreur')).trim(); return { ok: t.includes('gstatic.com'), detail: t.slice(0, 90) };
  }));
  srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
});
