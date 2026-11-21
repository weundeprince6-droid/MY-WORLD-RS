// Matchs en direct pour Lecteur Pro : lit la liste publique de Kooralive et trouve l'adresse du lecteur vidéo seul,
// afin d'afficher uniquement la vidéo en plein écran (sans les menus et bandeaux du site).
// Aucune donnée personnelle, aucun secret. Seules les adresses de la liste Kooralive sont acceptées.
const SITE = "https://kooralive.la/";
const DAYS = { yesterday: "matches-yesterday", today: "matches-today", tomorrow: "matches-tomorrow" };
const PAGE_HOSTS = /(^|\.)(pinkshooters\.com|kooralive\.la)$/i;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,fr;q=0.8,en;q=0.6"
};
const reply = (data, status = 200, ttl = 0) => new Response(JSON.stringify(data), { status, headers: {
  "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*",
  "Cache-Control": ttl ? "public, max-age=" + ttl : "no-store" } });

const decode = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const firstMatch = (re, s) => { const m = re.exec(s); return m ? m[1] : ""; };
const safeUrl = (u, hostRe) => { try { const x = new URL(u); return x.protocol === "https:" && (!hostRe || hostRe.test(x.hostname)) ? x.href : ""; } catch (e) { return ""; } };
const beinSlug = (name) => {
  const n = String(name || "").toLowerCase();
  if (!/bein/.test(n)) return "";
  const num = (n.match(/(\d+)/) || [])[1];
  return num ? "bein-sports-" + (/xtra/.test(n) ? "xtra" : "hd") + "-" + num : "";
};
const slugOf = (u) => { try { return new URL(u).pathname.split("/").filter(Boolean).pop() || ""; } catch (e) { return ""; } };

// Statut du match : priorité aux classes explicites de Kooralive, puis au libellé du match.
function classifyStatus(classes, state) {
  const c = String(classes || "").toLowerCase();
  const s = String(state || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const all = c + " " + s;
  if (/not-started|not started|upcoming|scheduled|pas commence|a venir|لم تبدأ|لم يبدا|لم تبدأ بعد|لم يبدأ بعد/.test(all)) return "upcoming";
  if (/finish|ended|full[ -]?time|\bft\b|termine|fin du match|انتهت|نهاية المباراة/.test(all)) return "finished";
  if ((/live|started(?!\w)|playing|in[ -]?play/.test(c) && !/not-started/.test(c)) ||
      /en direct|live|in[ -]?play|playing|1st half|2nd half|first half|second half|half[ -]?time|mi-temps|premiere mi-temps|deuxieme mi-temps|مباشر|الشوط|استراحة|جارية|بدأت|انطلقت/.test(s)) return "live";
  return "upcoming";
}

export function parseMatches(html) {
  const out = [];
  for (const part of html.split('<div class="AY_Match').slice(1)) {
    const cls = firstMatch(/^([^"]*)"/, part);
    const team = (n) => {
      const blk = firstMatch(new RegExp('class="MT_Team TM' + n + '">([\\s\\S]*?)<div class="MT_Data"|class="MT_Team TM' + n + '">([\\s\\S]*?)</div>\\s*</div>\\s*</div>'), part) || part;
      const seg = new RegExp('class="MT_Team TM' + n + '">([\\s\\S]*?class="TM_Name">[\\s\\S]*?)</div>').exec(part);
      const b = seg ? seg[1] : blk;
      const img = firstMatch(/<img [^>]*?src="(https?:[^"]+)"/, b) || firstMatch(/data-src="(https?:[^"]+)"/, b);
      return { name: decode(firstMatch(/class="TM_Name">([\s\S]*?)$/, b)), logo: safeUrl(img) };
    };
    const info = [...part.matchAll(/<li><span>([\s\S]*?)<\/span><\/li>/g)].map(m => decode(m[1]));
    const a = /<a href="([^"]+)" title="([^"]*)">\s*<div class="MT_Mask"/.exec(part);
    let link = a ? safeUrl(decode(a[1]).replace(/&amp;/g, "&"), PAGE_HOSTS) : "";
    const t1 = team(1), t2 = team(2);
    if (!t1.name || !t2.name) continue;
    if (!slugOf(link)) { // pas de lien précis : on déduit la chaîne beIN à partir de son nom
      const slug = beinSlug(info[0]);
      link = slug ? "https://22.pinkshooters.com/" + slug : "";
    }
    const goals = [...part.matchAll(/class="RS-goals">(\d*)</g)].map(m => m[1]);
    out.push({
      home: t1.name, homeLogo: t1.logo, away: t2.name, awayLogo: t2.logo,
      time: decode(firstMatch(/class="MT_Time">([\s\S]*?)<\/span>/, part)),
      homeGoals: goals[0] || "", awayGoals: goals[1] || "",
      state: decode(firstMatch(/class="MT_Stat">([\s\S]*?)<\/div>/, part)),
      status: classifyStatus(cls, decode(firstMatch(/class="MT_Stat">([\s\S]*?)<\/div>/, part))),
      channel: info[0] || "", commentator: info[1] || "", league: info[2] || "", link, slug: slugOf(link)
    });
  }
  return out;
}

export function parsePlayer(html, pageUrl) {
  const m = html.match(/(?:src|href)=["'](https:\/\/[^"']+\/albaplayer\/[^"']+)["']/i);
  let base = m ? m[1] : "";
  if (!base) { // repli : même numéro de serveur, domaine du lecteur
    const slug = slugOf(pageUrl), host = new URL(pageUrl).hostname.replace(/pinkshooters\.com$/, "shootinggames1.com");
    if (slug) base = "https://" + host + "/albaplayer/" + slug + "/";
  }
  const player = safeUrl(base.replace(/\?.*$/, ""));
  if (!player) return null;
  const servers = [...html.matchAll(/albaplayer\/[^"'?]+\/\?serv=(\d+)[^>]*>([^<]*)</g)].map(x => ({ n: +x[1], label: decode(x[2]) }));
  const seen = new Set(), list = [];
  for (const s of servers) if (!seen.has(s.n)) { seen.add(s.n); list.push(s); }
  return { playerUrl: player, servers: list.length ? list : Array.from({ length: 5 }, (_, i) => ({ n: i + 1, label: String(i + 1) })) };
}

async function cached(request, ttl, produce) {
  const cache = caches.default, key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key); if (hit) return hit;
  const res = await produce();
  if (res.status === 200) { const copy = new Response(res.body, res); copy.headers.set("Cache-Control", "public, max-age=" + ttl); await cache.put(key, copy.clone()); return copy; }
  return res;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (request.method !== "GET") return reply({ error: "Méthode non autorisée." }, 405);
    const url = new URL(request.url), route = url.pathname.replace(/^\/+|\/+$/g, "");
    try {
      if (route === "matches") {
        const day = DAYS[url.searchParams.get("day") || "today"];
        if (!day) return reply({ error: "Jour invalide." }, 400);
        return await cached(request, 15, async () => {
          const r = await fetch(SITE + day + "/", { headers: HEADERS });
          if (!r.ok) return reply({ error: "Kooralive indisponible (" + r.status + ")." }, 502);
          const matches = parseMatches(await r.text());
          return reply({ day: url.searchParams.get("day") || "today", matches, updatedAt: new Date().toISOString() }, 200, 15);
        });
      }
      if (route === "player") {
        const page = safeUrl(url.searchParams.get("u") || "", PAGE_HOSTS);
        if (!page) return reply({ error: "Adresse de match invalide." }, 400);
        return await cached(request, 300, async () => {
          const r = await fetch(page, { headers: HEADERS });
          if (!r.ok) return reply({ error: "Page du match indisponible (" + r.status + ")." }, 502);
          const p = parsePlayer(await r.text(), page);
          return p ? reply({ ...p, page }, 200, 300) : reply({ error: "Lecteur introuvable sur cette page." }, 404);
        });
      }
      return reply({ error: "Route inconnue." }, 404);
    } catch (e) { return reply({ error: "Erreur serveur." }, 500); }
  }
};
