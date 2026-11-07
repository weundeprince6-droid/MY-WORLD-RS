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
export function getAuth(){return { get currentUser(){ return window.__u || null } }}
export class GoogleAuthProvider{ addScope(s){(window.__scopes=window.__scopes||[]).push(s)} setCustomParameters(){} static credentialFromResult(r){return {accessToken:'jeton-test'}} }
export async function signInWithPopup(){ ${mode === 'ok' ? "window.__u={uid:'u1',displayName:'Prince Test',email:'weundeprince6@gmail.com'}; localStorage.setItem('__stubuser','1'); return {user:window.__u}" : "const e=new Error('x'); e.code='" + mode + "'; throw e"} }
export async function signOut(){}
export async function setPersistence(){}
export const browserLocalPersistence={};
export function onAuthStateChanged(a, cb){ if (localStorage.getItem('__stubuser')) { window.__u={uid:'u1',displayName:'Prince Test',email:'weundeprince6@gmail.com',getIdToken:async()=>'id'}; setTimeout(()=>cb(window.__u),0) } }`;

const T0 = Math.floor(Date.now() / 1000) * 1000;
async function scenario(nom, { mode = 'ok', sdkBloque = false, quotaGmail = false }, verifier) {
  const quota = { deja: false };
  const etat = { patches: [], offsets: [], fuite: false };
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  // Verrouillage PIN : le test saisit automatiquement 123456 (création ou déverrouillage)
  await p.addInitScript(() => { setInterval(() => { const g = document.getElementById('pin-gate'); if (!g || g.hidden) return; const f = document.getElementById('pin-gate-form'); const i = document.getElementById('pin-gate-input'); const c = document.getElementById('pin-confirmation'); if (!f || !i || i.value) return; i.value = '123456'; if (c) c.value = '123456'; f.dispatchEvent(new Event('submit', { cancelable: true })); }, 200); });
  const appels = [];
  await ctx.route('**/*', async (route) => {
    const u = route.request().url(); const m = route.request().method();
    if (u.startsWith('http://localhost')) return route.continue();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.includes('accounts.google.com/gsi/client')) return route.fulfill(js("window.google={accounts:{oauth2:{initTokenClient:function(o){return{requestAccessToken:function(){setTimeout(function(){if(localStorage.getItem('gis_ok')==='1')o.callback({access_token:'tok-gis',expires_in:3600});else o.error_callback({type:'popup_failed_to_open'});},50);}};}}}};"));
    if (u.includes('gstatic.com')) { if (sdkBloque) return route.abort(); return route.fulfill(js(u.includes('firebase-app') ? stubApp : stubAuth(mode))); }
    if (u.includes('api.telegram.org')) {
      if (u.includes('BADBAD')) return route.fulfill(json({ ok: false, error_code: 401, description: 'Unauthorized' }));
      if (u.includes('/getMe')) return route.fulfill(json({ ok: true, result: { username: 'MonRS_bot' } }));
      if (u.includes('/getUpdates')) {
        const off = new URL(u).searchParams.get('offset'); etat.offsets.push(off);
        if (off) return route.fulfill(json({ ok: true, result: [] }));
        return route.fulfill(json({ ok: true, result: [
          { update_id: 901, message: { message_id: 7, date: 1793000000, chat: { id: -100123, type: 'supergroup', title: 'Comité AVEC' }, from: { first_name: 'Marie' }, text: 'Urgent : crédit en retard' } },
          { update_id: 902, message: { message_id: 2, date: 1793000100, chat: { id: 55, type: 'private' }, from: { first_name: 'Jean' }, text: 'Salut, bonne journée' } },
          { update_id: 903, edited_message: { message_id: 2, chat: { id: 55 }, text: 'modifié' } },
        ] }));
      }
    }
    if (u.includes('cloudfunctions.net')) return route.fulfill({ status: 404, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Fonction non déployée' }) });
    if (u.includes('graph.facebook.com')) {
      if (u.includes('MAUVAISJETON')) return route.fulfill(json({ error: { code: 190, message: 'Invalid OAuth access token.' } }));
      if (u.includes('/me/accounts')) return route.fulfill(json({ data: [{ id: '111', name: 'Ma Boutique', access_token: 'PAGETOKEN' + 'x'.repeat(60) }] }));
      if (u.includes('/111/conversations')) {
        const t = (d) => new Date(T0 - d).toISOString().replace(/\.\d+Z$/, '+0000');
        return route.fulfill(json({ data: [{ id: 't_1', messages: { data: [
          { id: 'm_A', message: 'Urgent : ma commande est en retard', from: { id: '999', name: 'Paul' }, created_time: t(60000) },
          { id: 'm_B', message: 'Merci, bien reçu', from: { id: '111', name: 'Ma Boutique' }, created_time: t(30000) },
          { id: 'm_C', message: 'Bonjour', from: { id: '998', name: 'Sarah' }, created_time: t(120000) },
        ] } }] }));
      }
    }
    if (u.includes('123456789:AAH') || (route.request().postData() || '').includes('123456789:AAH')) etat.fuite = true;
    if (m === 'PATCH' && u.includes('/social_inbox/')) { etat.patches.push({ id: decodeURIComponent(u.split('/social_inbox/')[1].split('?')[0]), body: JSON.parse(route.request().postData()) }); return route.fulfill(json({})); }
    if (u.includes(':runQuery') && etat.patches.length) return route.fulfill(json(etat.patches.map((x) => ({ document: { name: 'x/social_inbox/' + x.id, fields: x.body.fields } }))));
    appels.push(m + ' ' + u.replace(/\?.*/, '').slice(0, 110));
    if (u.includes('gmail.googleapis.com') && m === 'POST') { (etat.mails = etat.mails || []).push({ url: u, corps: JSON.parse(route.request().postData()) }); return route.fulfill(json({ id: 'envoye1', threadId: 't1' })); }
    if (u.includes('gmail.googleapis.com') && u.includes('/messages?')) return route.fulfill(json({ messages: [{ id: 'm1' }, { id: 'm2' }] }));
    if (quotaGmail && u.includes('/messages/m1') && !quota.deja) { quota.deja = true; return route.fulfill({ status: 403, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'" } }) }); }
    if (u.includes('/messages/m1')) return route.fulfill(json({ id: 'm1', threadId: 't1', labelIds: ['UNREAD', 'IMPORTANT'], snippet: 'Merci de régler avant le 5', internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'Marie Dupont <marie@ex.com>' }, { name: 'Subject', value: 'Rappel facture urgente' }] } }));
    if (u.includes('/messages/m2')) return route.fulfill(json({ id: 'm2', threadId: 't2', labelIds: ['CATEGORY_PROMOTIONS'], snippet: 'promo', internalDate: '1', payload: { headers: [{ name: 'From', value: 'Shop <no-reply@gmail.com>' }, { name: 'Subject', value: 'Promotion -50%' }] } }));
    if (u.includes('calendar/v3') && m === 'POST') { etat.evenements = etat.evenements || []; etat.evenements.push(JSON.parse(route.request().postData())); return route.fulfill(json({ id: 'nouveau1' })); }
    if (u.includes('calendar/v3') && m === 'DELETE') { etat.supprime = decodeURIComponent(u.split('/events/')[1]); return route.fulfill({ status: 204, headers: CORS }); }
    if (u.includes('calendar/v3')) return route.fulfill(json({ items: [{ id: 'e1', summary: 'Réunion du comité', start: { dateTime: dans30.toISOString() }, end: { dateTime: new Date(dans30.getTime() + 3600000).toISOString() } }] }));
    if (u.includes(':runAggregationQuery')) return route.fulfill(json([{ result: { aggregateFields: { v: { integerValue: '7' } } } }]));
    if (u.includes(':runQuery')) return route.fulfill(json([]));
    if (u.includes('/notesProjects')) {
      etat.notes = etat.notes || { crees: [] };
      if (m === 'POST') { etat.notes.crees.push(JSON.parse(route.request().postData()).fields); return route.fulfill(json({})); }
      return route.fulfill(json({ documents: [{ name: 'x/notesProjects/n0', fields: { type: { stringValue: 'note' }, title: { stringValue: 'Ancienne note' }, body: { stringValue: 'x' }, updatedAt: { stringValue: '2026-10-01T00:00:00.000Z' } } }] }));
    }
    if (u.includes('/walletTransactions') || u.includes('/walletAccounts')) {
      etat.wallet = etat.wallet || { supprimes: [], patchs: [] };
      if (m === 'DELETE') { etat.wallet.supprimes.push(decodeURIComponent(u.split('/walletTransactions/')[1] || '')); return route.fulfill(json({})); }
      if (m === 'PATCH') { etat.wallet.patchs.push(JSON.parse(route.request().postData())); return route.fulfill(json({})); }
      if (m === 'POST') { (etat.wallet.crees = etat.wallet.crees || []).push({ url: u, corps: JSON.parse(route.request().postData()) }); return route.fulfill(json({})); }
      const S = (v) => ({ stringValue: v });
      if (u.includes('/walletAccounts')) return route.fulfill(json({ documents: [{ name: 'x/walletAccounts/a1', fields: { name: S('Caisse'), type: S('personal'), currency: S('USD'), balance: { doubleValue: 70 }, createdAt: S('2026-11-01') } }] }));
      return route.fulfill(json({ documents: [{ name: 'x/walletTransactions/t1', fields: { kind: S('expense'), accountId: S('a1'), accountName: S('Caisse'), currency: S('USD'), amount: { doubleValue: 30 }, date: S('2026-11-03'), description: S('Transport') } }] }));
    }
    if (u.includes('/documents/days')) { etat.lecturesJours = (etat.lecturesJours || 0) + (/\/documents\/days\/\d{4}/.test(u) ? 1 : 0);
     if (/\/documents\/days\/\d{4}/.test(u)) { const d0 = new Date(); const iso0 = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'); return route.fulfill(json({ name: 'x/days/' + iso0, fields: { items: { mapValue: { fields: { a: { mapValue: { fields: { k: { stringValue: 's' }, name: { stringValue: 'Riz' }, q: { integerValue: String(etat.qteRiz || 3) }, p: { integerValue: '1000' }, c: { stringValue: 'FC' } } } }, r1: { mapValue: { fields: { k: { stringValue: 'r' }, type: { stringValue: 'in' }, a: { integerValue: '10000' }, c: { stringValue: 'FC' }, g: { stringValue: 'g1' } } } }, r2: { mapValue: { fields: { k: { stringValue: 'r' }, type: { stringValue: 'out' }, a: { integerValue: '2500' }, c: { stringValue: 'FC' }, g: { stringValue: 'g1' } } } } } } } } })); }
    const d = new Date(); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return route.fulfill(json({ documents: [{ name: 'x/days/' + iso, fields: { items: { mapValue: { fields: { a: { mapValue: { fields: { k: { stringValue: 's' }, name: { stringValue: 'Riz' }, q: { integerValue: String(etat.qteRiz || 3) }, p: { integerValue: '1000' }, c: { stringValue: 'FC' } } } }, r1: { mapValue: { fields: { k: { stringValue: 'r' }, type: { stringValue: 'in' }, a: { integerValue: '10000' }, c: { stringValue: 'FC' }, g: { stringValue: 'g1' } } } }, r2: { mapValue: { fields: { k: { stringValue: 'r' }, type: { stringValue: 'out' }, a: { integerValue: '2500' }, c: { stringValue: 'FC' }, g: { stringValue: 'g1' } } } } } } } } }] })); }
    if (u.includes('/documents/cfg/main')) return route.fulfill(json({ name: 'x/cfg/main', fields: { ristGroups: { mapValue: { fields: { g1: { mapValue: { fields: { name: { stringValue: 'Famille' } } } } } } } } }));
    if (u.includes('/documents/members')) return route.fulfill(json({ documents: [
      { name: 'x/members/MBR-1', fields: { epargne: { doubleValue: 100 }, credits: { arrayValue: { values: [{ mapValue: { fields: { amount: { integerValue: '200' }, repaid: { integerValue: '50' }, dueDate: { stringValue: '2026-01-01' } } } }] } } } } ] }));
    return route.fulfill(json({}));
  });
  const logs = []; p.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await p.goto('http://localhost:8765/', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const r = await verifier(p, appels, logs, etat);
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
      && kpis.includes('AVEC LA SAGESSE') && kpis.includes('ESE DB') && kpis.includes('Ventes aujourd') && alertes.includes('crédit(s) en retard') && alertes.includes('Réunion du comité') && scopes.some(s => s.includes('datastore'));
    return { ok, detail: ok ? 'résumé : ' + resume.trim() + ' | appels Google : ' + appels.length : 'erreur=' + erreur + ' | msgs=' + msgs.slice(0, 80) + ' | kpis=' + kpis.slice(0, 120) };
  }));
  res.push(await scenario('Quota Gmail dépassé : nouvel essai automatique', { quotaGmail: true }, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(6000);
    const msgs = await p.textContent('#liste-messages'); const erreur = (await p.textContent('#erreur')).trim().replace(/^Connexion active pour environ 1 heure.*$/s, "");
    return { ok: msgs.includes('Marie Dupont') && erreur === '', detail: erreur ? 'erreur=' + erreur.slice(0, 100) : 'message récupéré au 2e essai' };
  }));
  res.push(await scenario('Telegram : bot connecté, messages lus et enregistrés sans doublon', {}, async (p, appels, logs, etat) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="social"]'); await p.waitForTimeout(300);
    const avantForm = await p.isVisible('#telegram-form');
    await p.fill('#telegram-jeton', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'); await p.click('#telegram-connecter'); await p.waitForTimeout(2500);
    const statut = (await p.textContent('#telegram-statut')).trim(); const liste = await p.textContent('#liste-social');
    const formCache = await p.isHidden('#telegram-form'); const apres1 = etat.patches.length;
    await p.click('#bouton-actualiser'); await p.waitForTimeout(2500);
    const html = await p.content();
    const ids = etat.patches.map((x) => x.id).sort().join(',');
    const ok = avantForm && statut.includes('@MonRS_bot') && statut.includes('Connecté') && formCache
      && apres1 === 2 && etat.patches.length === 2 && ids === 'telegram--100123-7,telegram-55-2'
      && etat.patches.find((x) => x.id === 'telegram--100123-7').body.fields.important.booleanValue === true
      && etat.patches.find((x) => x.id === 'telegram-55-2').body.fields.important.booleanValue === false
      && liste.includes('Marie') && liste.includes('Jean') && liste.includes('Telegram')
      && etat.offsets[etat.offsets.length - 1] === '904' && !etat.fuite && !html.includes('AAHdqTcv');
    return { ok, detail: ok ? 'enregistrés : ' + ids + ' | offsets : ' + etat.offsets.join(',') : JSON.stringify({ statut, apres1, total: etat.patches.length, ids, offsets: etat.offsets, fuite: etat.fuite, liste: liste.slice(0, 80) }) };
  }));
  res.push(await scenario('Telegram : jeton mal formé et jeton refusé', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2000);
    await p.click('[data-tab="social"]'); await p.waitForTimeout(300);
    await p.fill('#telegram-jeton', 'pas-un-jeton'); await p.click('#telegram-connecter'); await p.waitForTimeout(400);
    const t1 = (await p.textContent('#telegram-retour')).trim();
    await p.fill('#telegram-jeton', '123456789:BADBADBADBADBADBADBADBADBADBADBAD0'); await p.click('#telegram-connecter'); await p.waitForTimeout(1200);
    const t2 = (await p.textContent('#telegram-retour')).trim(); const formVisible = await p.isVisible('#telegram-form');
    return { ok: t1.includes('bon format') && t2.includes('refuse ce jeton') && formVisible, detail: t1.slice(0, 40) + ' | ' + t2.slice(0, 50) };
  }));
  res.push(await scenario('Telegram : retirer le bot', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2000);
    await p.click('[data-tab="social"]'); await p.waitForTimeout(300);
    await p.fill('#telegram-jeton', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'); await p.click('#telegram-connecter'); await p.waitForTimeout(2000);
    await p.click('#telegram-retirer'); await p.waitForTimeout(300);
    const stocke = await p.evaluate(() => localStorage.getItem('mwrs.telegram.jeton'));
    const statut = (await p.textContent('#telegram-statut')).trim();
    return { ok: stocke === null && statut.startsWith('Non connecté') && await p.isVisible('#telegram-form'), detail: statut.slice(0, 30) };
  }));
  res.push(await scenario('Facebook : Page connectée, messages reçus enregistrés sans doublon', {}, async (p, appels, logs, etat) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="social"]'); await p.waitForTimeout(300);
    await p.fill('#facebook-jeton', 'EAA' + 'B'.repeat(60)); await p.click('#facebook-connecter'); await p.waitForTimeout(2500);
    const statut = (await p.textContent('#facebook-statut')).trim(); const liste = await p.textContent('#liste-social');
    const formCache = await p.isHidden('#facebook-form'); const apres1 = etat.patches.length;
    await p.click('#bouton-actualiser'); await p.waitForTimeout(2500);
    const html = await p.content(); const ids = etat.patches.map((x) => x.id).sort().join(',');
    const ok = statut.includes('Connecté') && formCache && apres1 === 2 && etat.patches.length === 2 && ids === 'facebook-m_A,facebook-m_C'
      && etat.patches.find((x) => x.id === 'facebook-m_A').body.fields.important.booleanValue === true
      && etat.patches.find((x) => x.id === 'facebook-m_C').body.fields.important.booleanValue === false
      && liste.includes('Paul') && liste.includes('Sarah') && !liste.includes('Merci, bien reçu')
      && !JSON.stringify(etat.patches).includes('EAAB') && !html.includes('EAABBBB');
    return { ok, detail: ok ? 'enregistrés : ' + ids : JSON.stringify({ statut, apres1, total: etat.patches.length, ids, liste: liste.slice(0, 100) }) };
  }));
  res.push(await scenario('Facebook : jeton mal formé et jeton refusé (190)', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2000);
    await p.click('[data-tab="social"]'); await p.waitForTimeout(300);
    await p.fill('#facebook-jeton', 'pas-un-jeton'); await p.click('#facebook-connecter'); await p.waitForTimeout(400);
    const t1 = (await p.textContent('#facebook-retour')).trim();
    await p.fill('#facebook-jeton', 'EAA' + 'MAUVAISJETON'.repeat(6)); await p.click('#facebook-connecter'); await p.waitForTimeout(1200);
    const t2 = (await p.textContent('#facebook-retour')).trim(); const formVisible = await p.isVisible('#facebook-form');
    return { ok: t1.includes('bon format') && t2.includes('refuse le jeton') && formVisible, detail: t1.slice(0, 40) + ' | ' + t2.slice(0, 50) };
  }));
  res.push(await scenario('Facebook : retirer la connexion', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2000);
    await p.click('[data-tab="social"]'); await p.waitForTimeout(300);
    await p.fill('#facebook-jeton', 'EAA' + 'B'.repeat(60)); await p.click('#facebook-connecter'); await p.waitForTimeout(2000);
    await p.click('#facebook-retirer'); await p.waitForTimeout(300);
    const stocke = await p.evaluate(() => localStorage.getItem('mwrs.facebook.jeton'));
    const statut = (await p.textContent('#facebook-statut')).trim();
    return { ok: stocke === null && statut.startsWith('Non connecté') && await p.isVisible('#facebook-form'), detail: statut.slice(0, 30) };
  }));
  res.push(await scenario('Rechargement de la page : toujours connecté sans nouvelle connexion', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.reload(); await p.waitForTimeout(3500);
    const tableau = await p.isVisible('#tableau'); const bouton = await p.isVisible('#bouton-connexion');
    const msgs = await p.textContent('#liste-messages'); const erreur = (await p.textContent('#erreur')).trim();
    return { ok: tableau && !bouton && msgs.includes('Marie Dupont'), detail: JSON.stringify({ tableau, bouton, erreur: erreur.slice(0, 80) }) };
  }));
  res.push(await scenario('Jeton expiré : message clair et connexion en un clic', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('mwrs.google.jeton')); m.expireA = Date.now() - 1000; localStorage.setItem('mwrs.google.jeton', JSON.stringify(m)); });
    await p.reload(); await p.waitForTimeout(3500);
    const bouton = await p.isVisible('#bouton-connexion'); const erreur = (await p.textContent('#erreur')).trim();
    return { ok: bouton && erreur.includes('Reprendre ma session Google') && !erreur.includes('Failed'), detail: JSON.stringify({ bouton, erreur: erreur.slice(0, 160) }) };
  }));
  res.push(await scenario('Jeton expiré : « Reprendre ma session » en un clic, sans reconnexion complète', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('mwrs.google.jeton')); m.expireA = Date.now() - 1000; localStorage.setItem('mwrs.google.jeton', JSON.stringify(m)); });
    await p.reload(); await p.waitForTimeout(3500);
    const libelle = (await p.textContent('#bouton-connexion')).trim(); const visibleAvant = await p.isVisible('#tableau');
    await p.evaluate(() => localStorage.setItem('gis_ok', '1'));
    await p.click('#bouton-connexion'); await p.waitForTimeout(3500);
    const tableau = await p.isVisible('#tableau'); const msgs = await p.textContent('#liste-messages');
    const jeton = await p.evaluate(() => JSON.parse(localStorage.getItem('mwrs.google.jeton') || '{}').jeton);
    return { ok: libelle === 'Reprendre ma session Google' && !visibleAvant && tableau && msgs.includes('Marie Dupont') && jeton === 'tok-gis', detail: JSON.stringify({ libelle, visibleAvant, tableau, jeton }) };
  }));
  res.push(await scenario('Accès Google bientôt expiré : renouvelé automatiquement avant la fin', {}, async (p) => {
    await p.evaluate(() => localStorage.setItem('gis_ok', '1'));
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('mwrs.google.jeton')); m.expireA = Date.now() + 2 * 60 * 1000; localStorage.setItem('mwrs.google.jeton', JSON.stringify(m)); });
    await p.reload(); await p.waitForTimeout(3500);
    await p.waitForTimeout(32000);
    const jeton = await p.evaluate(() => JSON.parse(localStorage.getItem('mwrs.google.jeton') || '{}').jeton);
    return { ok: jeton === 'tok-gis', detail: JSON.stringify({ jeton }) };
  }));
  res.push(await scenario('Notes : import Google Keep (JSON), sans doublon à la réimportation', {}, async (p, appels, logs, etat) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="notes"]'); await p.waitForTimeout(1200);
    const keep = (nom, o) => ({ name: nom, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });
    const fichiers = [keep('a.json', { title: 'Courses', textContent: 'Lait', isTrashed: false, labels: [{ name: 'Maison' }], createdTimestampUsec: 1700000000000000, userEditedTimestampUsec: 1700000500000000 }),
      keep('b.json', { title: 'Liste', listContent: [{ text: 'Riz', isChecked: true }], isPinned: true, createdTimestampUsec: 1700000100000000 }),
      keep('c.json', { title: 'Corbeille', textContent: 'x', isTrashed: true })];
    await p.setInputFiles('#keep-fichiers', fichiers); await p.waitForTimeout(2500);
    const apres1 = etat.notes.crees.length; const statut1 = (await p.textContent('#keep-statut')).trim();
    await p.setInputFiles('#keep-fichiers', fichiers); await p.waitForTimeout(2500);
    const apres2 = etat.notes.crees.length; const statut2 = (await p.textContent('#keep-statut')).trim();
    const liste = await p.textContent('#notes-list');
    const premiere = etat.notes.crees[0] || {};
    const ok = apres1 === 2 && statut1.includes('2 note(s) importée(s)') && apres2 === 2 && liste.includes('Courses') && liste.includes('☑ Riz') && !liste.includes('Corbeille') && premiere.source && premiere.source.stringValue === 'keep';
    return { ok, detail: JSON.stringify({ apres1, apres2, statut1: statut1.slice(0, 90), statut2: statut2.slice(0, 90) }) };
  }));
  res.push(await scenario('Gmail : envoyer un mail pour de vrai, ou l\'enregistrer en brouillon', {}, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="messages"]'); await p.waitForTimeout(300);
    await p.click('#nouveau-mail'); await p.waitForTimeout(300);
    await p.fill('#nouveau-mail-form [name=a]', 'marie@ex.com'); await p.fill('#nouveau-mail-form [name=cc]', 'paul@ex.com');
    await p.fill('#nouveau-mail-form [name=sujet]', 'Bonjour'); await p.fill('#nouveau-mail-form [name=corps]', 'Message de test');
    await p.click('#nouveau-mail-envoyer'); await p.waitForTimeout(1200);
    const envoi = (etat.mails || []).find((x) => x.url.includes('/messages/send'));
    const brut = envoi ? Buffer.from(envoi.corps.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
    const conf1 = (await p.textContent('#confirmation')).trim();
    await p.click('#nouveau-mail'); await p.waitForTimeout(300);
    await p.fill('#nouveau-mail-form [name=a]', 'luc@ex.com'); await p.fill('#nouveau-mail-form [name=sujet]', 'Brouillon'); await p.fill('#nouveau-mail-form [name=corps]', 'À relire');
    await p.click('#nouveau-mail-creer'); await p.waitForTimeout(1200);
    const brouillon = (etat.mails || []).find((x) => x.url.includes('/drafts'));
    const ok = envoi && brut.includes('To: marie@ex.com') && brut.includes('Cc: paul@ex.com') && brut.endsWith('Message de test') && conf1.includes('Mail envoyé à marie@ex.com') && brouillon && !(etat.mails || []).some((x) => x.url.includes('/messages/send') && Buffer.from(x.corps.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').includes('luc@ex.com'));
    return { ok, detail: JSON.stringify({ envoi: !!envoi, conf1: conf1.slice(0, 60), brouillon: !!brouillon }) };
  }));
  res.push(await scenario('Gmail : pièce jointe à l\'envoi, mails envoyés visibles et lisibles', {}, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="messages"]'); await p.waitForTimeout(500);
    const boutonsVues = await p.$$('.messages-barre [data-vue-messages]'); const prochesDuBouton = await p.evaluate(() => document.getElementById('nouveau-mail').parentElement === document.querySelector('[data-vue-messages="envoyes"]').parentElement);
    await p.click('[data-vue-messages="envoyes"]'); await p.waitForTimeout(1500);
    const envoyes = await p.textContent('#liste-envoyes'); const lectures = await p.$$('#liste-envoyes [data-lire]');
    await p.click('#nouveau-mail'); await p.waitForTimeout(300);
    await p.fill('#nouveau-mail-form [name=a]', 'marie@ex.com'); await p.fill('#nouveau-mail-form [name=sujet]', 'Avec fichier'); await p.fill('#nouveau-mail-form [name=corps]', 'Voir PJ');
    await p.setInputFiles('#nouveau-mail-fichiers', [{ name: 'note é.txt', mimeType: 'text/plain', buffer: Buffer.from('Contenu du fichier é') }]); await p.waitForTimeout(500);
    const liste = await p.textContent('#nouveau-mail-pj');
    await p.click('#nouveau-mail-envoyer'); await p.waitForTimeout(1500);
    const envoi = (etat.mails || []).find((x) => x.url.includes('/messages/send'));
    const brut = envoi ? Buffer.from(envoi.corps.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
    const pj = brut.includes('multipart/mixed') && brut.includes('Content-Disposition: attachment') && brut.includes(Buffer.from('Contenu du fichier é').toString('base64'));
    await p.click('#liste-envoyes [data-lire]'); await p.waitForTimeout(1200);
    const dlg = await p.isVisible('#mail-lecture'); const sujet = (await p.textContent('#mail-lecture-sujet')).trim();
    return { ok: boutonsVues.length === 3 && prochesDuBouton && lectures.length > 0 && envoyes.includes('À :') && liste.includes('note é.txt') && pj && dlg && sujet.length > 0 && sujet !== 'Chargement…', detail: JSON.stringify({ n: lectures.length, liste: liste.slice(0, 30), pj, dlg, sujet: sujet.slice(0, 40) }) };
  }));
  res.push(await scenario('Gmail : répondre depuis la lecture d\'un message', {}, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="messages"]'); await p.waitForTimeout(500);
    await p.click('#liste-messages [data-lire]'); await p.waitForTimeout(1200);
    await p.click('#mail-lecture-repondre'); await p.waitForTimeout(500);
    const dest = await p.inputValue('#nouveau-mail-form [name=a]'); const sujet = await p.inputValue('#nouveau-mail-form [name=sujet]'); const corps = await p.inputValue('#nouveau-mail-form [name=corps]');
    const titre = (await p.textContent('#nouveau-mail-titre')).trim();
    await p.fill('#nouveau-mail-form [name=corps]', 'Merci, bien reçu.');
    await p.click('#nouveau-mail-envoyer'); await p.waitForTimeout(1500);
    const envoi = (etat.mails || []).find((x) => x.url.includes('/messages/send'));
    const brut = envoi ? Buffer.from(envoi.corps.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
    return { ok: titre === 'Répondre' && dest.includes('@') && /^Re/.test(sujet) && corps === '' && envoi && !!envoi.corps.threadId && brut.includes('Merci, bien reçu.'), detail: JSON.stringify({ titre, dest, sujet, threadId: envoi && envoi.corps.threadId }) };
  }));
  res.push(await scenario('Messages : filtres comptes personnels / professionnels', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="messages"]'); await p.waitForTimeout(500);
    await p.click('[data-vue-messages="recus"]'); await p.waitForTimeout(300);
    const tous = await p.textContent('#liste-recents'); const cTous = (await p.textContent('[data-compteur="tous"]')).trim();
    await p.click('[data-compte-messages="personnel"]'); await p.waitForTimeout(300);
    const perso = await p.textContent('#liste-recents'); const cPerso = (await p.textContent('[data-compteur="personnel"]')).trim();
    await p.click('[data-compte-messages="professionnel"]'); await p.waitForTimeout(300);
    const pro = await p.textContent('#liste-recents'); const cPro = (await p.textContent('[data-compteur="professionnel"]')).trim();
    await p.click('[data-compte-messages="tous"]'); await p.waitForTimeout(300);
    const retour = await p.textContent('#liste-recents');
    const ok = tous.includes('Marie Dupont') && tous.includes('Shop') && perso.includes('Shop') && !perso.includes('Marie Dupont') && pro.includes('Marie Dupont') && !pro.includes('Shop') && retour.includes('Shop') && retour.includes('Marie Dupont') && cTous === '2' && cPerso === '1' && cPro === '1';
    return { ok, detail: JSON.stringify({ cTous, cPerso, cPro }) };
  }));
  res.push(await scenario('Messages : marquer un message important depuis l\'application', {}, async (p, appels, logs, etat) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="messages"]'); await p.waitForTimeout(500);
    const avant = await p.textContent('#liste-messages');
    await p.click('[data-vue-messages="recus"]'); await p.waitForTimeout(300);
    await p.click('#liste-recents li:has-text("Promotion") [data-important]'); await p.waitForTimeout(1000);
    const appel = (etat.mails || []).find((x) => x.url.includes('/messages/m2/modify'));
    const ajoute = appel ? appel.corps.addLabelIds : [];
    const bouton = (await p.textContent('#liste-recents li:has-text("Promotion") [data-important]')).trim();
    await p.click('[data-vue-messages="importants"]'); await p.waitForTimeout(300);
    const apres = await p.textContent('#liste-messages');
    return { ok: !avant.includes('Promotion') && ajoute.includes('STARRED') && ajoute.includes('IMPORTANT') && bouton === '★ Important' && apres.includes('Promotion'), detail: JSON.stringify({ ajoute, bouton, dansImportants: apres.includes('Promotion') }) };
  }));
  res.push(await scenario('Agenda : ajouter puis supprimer un rendez-vous', {}, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(2500);
    await p.click('[data-tab="agenda"]'); await p.waitForTimeout(300);
    await p.click('#agenda-nouveau'); await p.waitForTimeout(300);
    await p.click('#agenda-ajouter'); await p.waitForTimeout(200);
    const vide = (await p.textContent('#agenda-retour')).trim();
    await p.fill('#agenda-form [name=titre]', 'Réunion AVEC'); await p.fill('#agenda-form [name=date]', '2026-11-05');
    await p.fill('#agenda-form [name=debut]', '14:00'); await p.fill('#agenda-form [name=fin]', '15:30'); await p.fill('#agenda-form [name=lieu]', 'Bureau');
    await p.click('#agenda-ajouter'); await p.waitForTimeout(1500);
    const retour = (await p.textContent('#agenda-retour')).trim(); const ev = (etat.evenements || [])[0];
    await p.click('[data-supprimer-evenement]'); await p.waitForTimeout(1200);
    const ok = retour.includes('enregistré') && ev && ev.summary === 'Réunion AVEC' && ev.start.dateTime === '2026-11-05T14:00:00' && ev.end.dateTime === '2026-11-05T15:30:00' && ev.location === 'Bureau' && etat.supprime === 'e1';
    return { ok, detail: JSON.stringify({ retour, supprime: etat.supprime, debut: ev && ev.start.dateTime }) };
  }));
  res.push(await scenario('Porte-Monnaie : ristournes ESE DB synchronisées', {}, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="wallet"]'); await p.waitForTimeout(800);
    const depots = (await p.textContent('#rist-depots-fc')).replace(/\s/g, ' '); const retraits = (await p.textContent('#rist-retraits-fc')).replace(/\s/g, ' ');
    const solde = (await p.textContent('#rist-solde-fc')).replace(/\s/g, ' '); const groupes = await p.textContent('#rist-groupes'); const statut = (await p.textContent('#wallet-ristourne-status')).trim();
    const ok = /10\s?000 FC/.test(depots) && /2\s?500 FC/.test(retraits) && /7\s?500 FC/.test(solde) && groupes.includes('Famille') && statut.startsWith('Synchronisé');
    return { ok, detail: JSON.stringify({ depots, retraits, solde, statut: statut.slice(0, 70) }) };
  }));
  res.push(await scenario('Actualisation automatique : ESE DB se met à jour seule, sans toucher à la page', {}, async (p, appels, logs, etat) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="bases"]'); await p.waitForTimeout(500);
    const avant = (await p.textContent('#grille-kpis')).replace(/\s/g, ' ');
    etat.qteRiz = 9; // un nouveau client achète : 9 × 1000 = 9 000 FC dans la base
    await p.waitForTimeout(6000);
    const apres = (await p.textContent('#grille-kpis')).replace(/\s/g, ' ');
    const voyant = (await p.textContent('#direct')).trim();
    const lectures = etat.lecturesJours || 0;
    const ok = /3\s?000/.test(avant) && /9\s?000/.test(apres) && voyant.includes('En direct') && lectures >= 2 && lectures <= 6;
    return { ok, detail: JSON.stringify({ avantA: avant.slice(avant.indexOf('Ventes'), avant.indexOf('Ventes') + 40), apresA: apres.slice(apres.indexOf('Ventes'), apres.indexOf('Ventes') + 40), voyant, lectures }) };
  }));
  res.push(await scenario('Porte-Monnaie : 50 % des ristournes versés dans « Mes parts de ristourne »', {}, async (p, appels, logs, etat) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="wallet"]'); await p.waitForTimeout(1500);
    const info = (await p.textContent('#rist-part-info')).replace(/\s/g, ' ');
    await p.click('#rist-part-enregistrer'); await p.waitForTimeout(1500);
    const crees = (etat.wallet && etat.wallet.crees) || [];
    const compte = crees.find((c) => c.url.includes('/walletAccounts'));
    const tx = crees.find((c) => c.url.includes('/walletTransactions'));
    const patch = (etat.wallet.patchs || []).find((x) => x.fields.ristourneCredite);
    const statut = (await p.textContent('#wallet-status')).trim();
    const desactive = await p.isDisabled('#rist-part-enregistrer');
    p.on('dialog', (d) => d.accept());
    const ligne = await p.$('[data-wallet-supprimer]'); const avantPatchs = etat.wallet.patchs.length;
    await p.evaluate(() => { const b = [...document.querySelectorAll('[data-wallet-supprimer]')]; const cible = b.find((x) => x.closest('tr')?.textContent.includes('Part de ristourne')); if (cible) cible.click(); });
    await p.waitForTimeout(1500);
    const reactive = !(await p.isDisabled('#rist-part-enregistrer'));
    const remis = (etat.wallet.patchs || []).slice(avantPatchs).some((x) => x.fields.ristourneCredite && x.fields.ristourneCredite.doubleValue === 0);
    const ok = reactive && remis && /3\s?750 FC/.test(info) && compte && compte.corps.fields.name.stringValue === 'Mes parts de ristourne' && tx && tx.corps.fields.amount.doubleValue === 3750 && tx.corps.fields.kind.stringValue === 'income' && patch && patch.fields.balance.doubleValue === 3750 && patch.fields.ristourneCredite.doubleValue === 3750 && desactive && statut.includes('enregistrée');
    return { ok, detail: JSON.stringify({ info: info.slice(0, 120), compte: !!compte, montant: tx && tx.corps.fields.amount.doubleValue, patch: patch && patch.fields.balance.doubleValue, desactive, statut: statut.slice(0, 60) }) };
  }));
  res.push(await scenario('Porte-Monnaie : réinitialiser « Mes parts de ristourne »', {}, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="wallet"]'); await p.waitForTimeout(1500);
    await p.click('#rist-part-enregistrer'); await p.waitForTimeout(1500);
    const avant = etat.wallet.patchs.length;
    await p.click('#rist-part-reinit'); await p.waitForTimeout(1800);
    const patchs = etat.wallet.patchs.slice(avant);
    const remis = patchs.some((x) => x.fields.balance && x.fields.balance.doubleValue === 0 && x.fields.ristourneCredite && x.fields.ristourneCredite.doubleValue === 0);
    const reactive = !(await p.isDisabled('#rist-part-enregistrer'));
    const statut = (await p.textContent('#wallet-status')).trim();
    return { ok: remis && reactive && statut.includes('réinitialisé'), detail: JSON.stringify({ remis, reactive, statut: statut.slice(0, 70) }) };
  }));
  res.push(await scenario('Porte-Monnaie : supprimer un mouvement corrige le solde', {}, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="wallet"]'); await p.waitForTimeout(1200);
    const avant = await p.textContent('#wallet-history');
    await p.click('[data-wallet-supprimer]'); await p.waitForTimeout(1500);
    const apres = await p.textContent('#wallet-history'); const statut = (await p.textContent('#wallet-status')).trim();
    const patch = etat.wallet && etat.wallet.patchs[0]; const solde = patch && patch.fields.balance.doubleValue;
    const ok = avant.includes('Transport') && !apres.includes('Transport') && etat.wallet.supprimes[0] === 't1' && solde === 100 && statut.includes('supprimé');
    return { ok, detail: JSON.stringify({ supprimes: etat.wallet && etat.wallet.supprimes, solde, statut: statut.slice(0, 60) }) };
  }));
  res.push(await scenario('Rapport complet : le PDF contient mes données', { }, async (p) => {
    await p.evaluate(() => { window.__pdf = []; window.jspdf = { jsPDF: function () { const d = this; ['rect','circle','ellipse','setLineWidth','setFillColor','setFont','setFontSize','setTextColor','setDrawColor','line','setPage','addPage'].forEach((k) => { d[k] = () => {}; }); d.splitTextToSize = (t) => [String(t)]; d.getNumberOfPages = () => 1; d.text = (t) => { window.__pdf.push([].concat(t).join(' ')); }; d.save = (n) => { window.__pdfNom = n; }; } }; });
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="profile"]'); await p.waitForTimeout(500);
    await p.click('#rapport-appli-pdf'); await p.waitForTimeout(5000);
    const texte = await p.evaluate(() => (window.__pdf || []).join('\n')); const nom = await p.evaluate(() => window.__pdfNom || '');
    const statut = (await p.textContent('#rapport-appli-status')).trim();
    const ok = nom.startsWith('My-World-RS_Rapport-complet') && texte.includes('MES DONN') && texte.includes('Porte-monnaie') && texte.includes('Messages (Gmail)') && texte.includes('FONCTIONNEMENT') && texte.includes('RAPPORT COMPLET');
    return { ok, detail: JSON.stringify({ nom, statut: statut.slice(0, 60), taille: texte.length }) };
  }));
  res.push(await scenario('Porte-monnaie : la caisse d\u2019ESE DB apparaît comme un compte', { }, async (p) => {
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="wallet"]'); await p.waitForTimeout(3500);
    const comptes = (await p.textContent('#wallet-accounts')).replace(/\s+/g, ' ');
    const ok = /Caisse ESE DB/.test(comptes) && /Somme restante en caisse/.test(comptes) && /3\s?000\s?FC/.test(comptes);
    return { ok, detail: comptes.slice(0, 160) };
  }));
  res.push(await scenario('Porte-monnaie : encaisser la moitié de la caisse ESE dans le solde professionnel', { }, async (p, appels, logs, etat) => {
    p.on('dialog', (d) => d.accept());
    await p.click('#bouton-connexion'); await p.waitForTimeout(3000);
    await p.click('[data-tab="wallet"]'); await p.waitForTimeout(3500);
    const info = (await p.textContent('#caisse-part-info')).replace(/\s+/g, ' ');
    await p.click('#caisse-part-enregistrer'); await p.waitForTimeout(2500);
    const crees = etat.wallet.crees || [];
    const compte = crees.find((c) => c.url.includes('walletAccounts') && JSON.stringify(c.corps).includes('Ma part de caisse ESE'));
    const tx = crees.find((c) => c.url.includes('walletTransactions') && JSON.stringify(c.corps).includes('Caisse ESE'));
    const ok = /1\s?500\s?FC/.test(info) && !!compte && JSON.stringify(compte.corps).includes('professional') && !!tx && JSON.stringify(tx.corps).includes('1500');
    return { ok, detail: info.slice(0, 120) + ' | ' + crees.length };
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
