/* CSL Resultater – brukergrensesnitt */
(() => {
  const S = {
    db: null, sb: null, session: null, dl: null, canWrite: false, login: false, loginMode: "in", loginSent: "", loginEmail: "", admins: null, ready: false, slow: false, offline: false,
    leagues: [], lid: null, drivers: [], results: {}, unsubs: [],
    tab: "standings", stMode: "all", resMode: "all", sel: null,
    imp: { round: 1, race: null, parsed: null, file: "", err: "", paste: false, busy: false },
    draft: null, draftFor: null, confirm: null, newLeague: false, q: "", pending: false, busy: "",
    // protester: protests = null betyr at tabellene ikke finnes i databasen ennå
    protests: null, pevents: [], canSteward: false, stewards: null, quota: {},
    pv: { mode: "list", id: null, f: { rid: "", no: "", drv: "", st: "" } }, pf: null, dec: null, reply: null,
  };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const league = () => S.leagues.find((l) => l.id === S.lid) || null;
  const driverMap = () => new Map(S.drivers.map((d) => [CORE.norm(d.name), d]));
  const raceLabel = (L, key) => { const r = (L.races || []).find((x) => x.key === key); return r ? r.label : key; };
  const raceShort = (L, key) => { const r = (L.races || []).find((x) => x.key === key); return r ? r.short || r.label : key; };
  const trackOf = (L, n) => ((L.rounds || [])[n - 1] || {}).track || "Runde " + n;
  const logoOf = (L) => (L && L.logo) || CSL_LOGO;
  const fmtPts = (v) => (v == null || v === "" ? "" : Number.isInteger(+v) ? String(v) : String(v).replace(".", ","));

  /* ---------------- toast ---------------- */
  let toastT;
  function toast(msg, kind) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 4200);
  }
  async function write(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) {
      const c = e && e.code;
      if (c === "invalid_argument" && S.canWrite) { toast("Du har bare lesetilgang til denne ligaen.", "err"); S.canWrite = false; render(); }
      else if (c === "quota_exceeded") toast("Lagringen er full. Slett gamle ligaer eller resultater og prøv igjen.", "err");
      else toast("Kunne ikke lagre: " + ((e && e.message) || "ukjent feil"), "err");
      return false;
    }
  }

  /* ---------------- data ---------------- */
  function saveFile(filename, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return Promise.resolve({ status: "saved" });
  }

  let reloadT = {};
  function scheduleReload(table) {
    clearTimeout(reloadT[table]);
    reloadT[table] = setTimeout(async () => {
      try {
        if (table === "leagues") { S.leagues = await DATA.loadLeagues(); if (!league()) pickLeague(); else softRender(); }
        else if (S.lid && table === "drivers") { S.drivers = await DATA.loadDrivers(S.lid); softRender(); }
        else if (S.lid && table === "results") { S.results = await DATA.loadResults(S.lid); softRender(); }
        else if (S.lid && table === "protests") { await loadProtestData(S.lid); softRender(); }
      } catch (e) {}
    }, 250);
  }

  async function loadProtestData(lid) {
    const [p, ev] = await Promise.all([DATA.loadProtests(lid), DATA.loadEvents(lid)]);
    if (S.lid !== lid) return;
    S.protests = p; S.pevents = ev; S.quota = {}; S.protestsLoaded = true;
  }

  async function checkAdmin() {
    S.canWrite = S.session ? await DATA.isAdmin() : false;
    S.canSteward = S.session ? await DATA.isSteward() : false;
    S.admins = null; S.stewards = null;
    if (!S.canWrite && ["import", "setup"].includes(S.tab)) S.tab = "standings";
    if (S.lid) { try { await loadProtestData(S.lid); } catch (e) {} }
    render();
  }

  function pickLeague() {
    const remembered = store.get("csl.lid");
    selectLeague(S.leagues.find((l) => l.id === remembered) ? remembered : S.leagues[0] ? S.leagues[0].id : null);
  }

  async function init() {
    render();
    S.dl = { save: ({ filename, data }) => saveFile(filename, data) };
    const cfg = window.CSL_CONFIG || {};
    if (!window.supabase || !cfg.supabaseUrl || /DITT|YOUR/.test(cfg.supabaseUrl)) {
      S.ready = true; S.err = "Supabase er ikke satt opp ennå. Fyll inn adresse og nøkkel i js/config.js."; render(); return;
    }
    const slowT = setTimeout(() => { S.slow = true; render(); }, 10000);
    // Lenke fra e-post («Glemt passord?»): les adressen før Supabase fjerner den
    const urlInfo = new URLSearchParams((location.hash || "").replace(/^#/, "") + "&" + (location.search || "").replace(/^\?/, ""));
    let recovering = urlInfo.get("type") === "recovery";
    const linkErr = urlInfo.get("error_code") || urlInfo.get("error");
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    S.sb = sb;
    // Lytt med en gang: PASSWORD_RECOVERY sendes rett etter oppstart og går tapt hvis vi venter
    sb.auth.onAuthStateChange((ev, session) => {
      const was = S.session && S.session.user.id, now = session && session.user.id;
      S.session = session;
      if (ev === "PASSWORD_RECOVERY") { recovering = true; S.login = true; S.loginMode = "newpw"; if (S.ready) render(); return; }
      if (S.ready && was !== now) { S.login = false; S.loginSent = ""; checkAdmin(); }
    });
    if (linkErr) {
      setTimeout(() => toast(/expired/i.test(linkErr) ? "Lenken er utløpt eller allerede brukt. Be om en ny med «Glemt passord?»." : "Lenken virket ikke (" + linkErr + "). Be om en ny.", "err"), 300);
      history.replaceState(null, "", location.pathname);
      S.login = true; S.loginMode = "forgot";
    }
    DATA.init(sb, { onWrite: scheduleReload, cache: { leagues: () => S.leagues, results: () => S.results } });
    S.db = DATA.db;
    try {
      const { data } = await sb.auth.getSession(); S.session = data.session;
      if (S.session) { S.canWrite = await DATA.isAdmin(); S.canSteward = await DATA.isSteward(); }
      S.leagues = await DATA.loadLeagues();
    } catch (e) { clearTimeout(slowT); S.ready = true; S.err = "Ligadataene kan ikke leses akkurat nå (" + (e.message || e.code) + ")."; render(); return; }
    clearTimeout(slowT); S.slow = false; S.ready = true;
    if (recovering && S.session) { S.login = true; S.loginMode = "newpw"; }
    sb.channel("csl-endringer")
      .on("postgres_changes", { event: "*", schema: "public", table: "leagues" }, () => scheduleReload("leagues"))
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => scheduleReload("drivers"))
      .on("postgres_changes", { event: "*", schema: "public", table: "results" }, () => scheduleReload("results"))
      .on("postgres_changes", { event: "*", schema: "public", table: "protests" }, () => scheduleReload("protests"))
      .on("postgres_changes", { event: "*", schema: "public", table: "protest_events" }, () => scheduleReload("protests"))
      .subscribe();
    if (/^#protest/i.test(location.hash)) { S.tab = "protests"; S.pv.mode = "new"; S.pf = null; history.replaceState(null, "", location.pathname + location.search); }
    pickLeague();
  }

  async function selectLeague(id) {
    S.lid = id; S.drivers = []; S.results = {}; S.sel = null; S.draft = null; S.imp.parsed = null; S.confirm = null;
    S.protests = null; S.protestsLoaded = false; S.pevents = []; S.quota = {}; S.pv = { mode: S.pv.mode === "new" ? "new" : "list", id: null, f: { rid: "", no: "", drv: "", st: "" } }; S.dec = null; S.reply = null;
    if (id) store.set("csl.lid", id);
    render();
    if (id) {
      try {
        const [d, r] = await Promise.all([DATA.loadDrivers(id), DATA.loadResults(id)]);
        if (S.lid !== id) return;
        S.drivers = d; S.results = r; render();
      } catch (e) { toast("Kunne ikke hente ligaen: " + (e.message || ""), "err"); }
      try { await loadProtestData(id); if (S.lid === id) render(); } catch (e) {}
    }
  }

  /* ---------------- render ---------------- */
  function softRender() {
    const a = document.activeElement;
    if (a && a.closest && a.closest("#view") && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { S.pending = true; return; }
    render();
  }
  document.addEventListener("focusout", () => setTimeout(() => {
    const a = document.activeElement;
    if (S.pending && !(a && a.closest && a.closest("#view") && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { S.pending = false; render(); }
  }, 0));

  function render() {
    renderTop();
    const v = $("#view");
    const L = league();
    if (!S.ready) { v.innerHTML = `<div class="empty"><div class="spin"></div><p>Henter ligaer…</p>${S.slow ? "<p class='muted'>Får ikke kontakt med lagringen ennå. Siden prøver videre.</p>" : ""}</div>`; return; }
    if (S.login) { v.innerHTML = viewLogin(); return; }
    if (S.err) { v.innerHTML = `<div class="empty"><h2>Noe gikk galt</h2><p class="muted">${esc(S.err)}</p></div>`; return; }
    if (!L || S.newLeague) { v.innerHTML = viewNewLeague(); return; }
    if (S.tab === "protests" && S.protestsLoaded && !protestTab(L)) S.tab = "standings";
    const fn = { standings: viewStandings, results: viewResults, protests: viewProtests, import: viewImport, drivers: viewDrivers, setup: viewSetup }[S.tab];
    v.innerHTML = fn(L);
    if (S.tab === "import") bindDrop();
  }

  function renderTop() {
    const L = league();
    const opts = S.leagues.map((l) => `<option value="${esc(l.id)}" ${l.id === S.lid ? "selected" : ""}>${esc(l.name)}</option>`).join("");
    $("#leaguebar").innerHTML = S.leagues.length
      ? `<label class="sr" for="leagueSel">Liga</label><select id="leagueSel" data-chg="league">${opts}</select>
         ${S.canWrite ? `<button class="btn ghost sm" data-act="newLeague">+ Ny liga</button>` : ""}` : "";
    const nOpen = L && protestsOn(L) ? S.protests.filter(isOpen).length : 0;
    const tabs = [["standings", "Standings"], ["results", "Resultater"], ["protests", "Protester" + (nOpen ? ` <span class="tabn">${nOpen}</span>` : "")], ["import", "Importer"], ["drivers", "Førere"], ["setup", "Oppsett"]]
      .filter(([k]) => S.canWrite || !["import", "setup"].includes(k))
      .filter(([k]) => k !== "protests" || (L && (protestTab(L) || (S.tab === "protests" && !S.protestsLoaded))));
    $("#tabs").innerHTML = L && !S.newLeague ? tabs.map(([k, t]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-act="tab" data-v="${k}" aria-current="${S.tab === k ? "page" : "false"}">${t}</button>`).join("") : "";
    const em = S.session && S.session.user && S.session.user.email;
    $("#account").innerHTML = S.sb ? (em ? `<button class="who linkbtn inv" data-act="changePw" title="${esc(em)} – trykk for å bytte passord">${esc(em)}</button><button class="btn ghost sm" data-act="logout">Logg ut</button>`
      : `<button class="btn ghost sm" data-act="login">Logg inn</button>`) : "";
    const ro = $("#ro");
    ro.hidden = S.canWrite || !S.ready || !!S.err || S.login;
    if (!ro.hidden) ro.innerHTML = `<div class="wrap">${em
      ? `Du er logget inn som ${esc(em)}, men er ikke lagt til som arrangør. Be en arrangør legge deg til under Oppsett → Arrangører.`
      : `Du ser resultatene uten å være logget inn. Arrangører <button class="linkbtn inv" data-act="login">logger inn</button> for å importere og redigere.`}</div>`;
    if (!ro.hidden && em && S.canSteward) ro.hidden = true;
  }

  /* ---------------- innlogging ---------------- */
  function viewLogin() {
    const m = S.loginMode, busy = S.busy === "login" ? "disabled" : "";
    const email = `<label class="fld"><span>E-post</span><input id="loginEmail" type="email" required autocomplete="email" value="${esc(S.loginEmail)}" /></label>`;
    const cancel = `<button class="btn ghost" type="button" data-act="closeLogin">Avbryt</button>`;
    let body;
    if (m === "sent") body = `<p>Vi har sendt en lenke til <b>${esc(S.loginSent)}</b>. Trykk på lenken i e-posten for å velge nytt passord.</p>
      <p class="muted small">Finner du den ikke, sjekk søppelpost. Supabase sender bare noen få slike e-poster i timen.</p>
      <div class="row"><button class="btn ghost" data-act="loginMode" data-v="in">Tilbake til innlogging</button></div>`;
    else if (m === "newpw") body = `<p class="muted">Velg et nytt passord for ${esc((S.session && S.session.user.email) || "kontoen din")}.</p>
      <form data-form="newpw" class="stack"><label class="fld"><span>Nytt passord (minst 8 tegn)</span><input id="pw1" type="password" required minlength="8" autocomplete="new-password" /></label>
      <label class="fld"><span>Gjenta passordet</span><input id="pw2" type="password" required minlength="8" autocomplete="new-password" /></label>
      <div class="row"><button class="btn primary" type="submit" ${busy}>Lagre passord</button>${S.changePw ? cancel : ""}</div></form>`;
    else if (m === "up") body = `<p class="muted">Første gang? Lag et passord for e-postadressen din. Du får tilgang når en arrangør har lagt deg til som arrangør eller steward under Oppsett.</p>
      <form data-form="signup" class="stack">${email}
      <label class="fld"><span>Velg passord (minst 8 tegn)</span><input id="pw1" type="password" required minlength="8" autocomplete="new-password" /></label>
      <label class="fld"><span>Gjenta passordet</span><input id="pw2" type="password" required minlength="8" autocomplete="new-password" /></label>
      <div class="row"><button class="btn primary" type="submit" ${busy}>Opprett konto</button>${cancel}</div></form>
      <p class="small">Har du allerede konto? <button class="linkbtn" data-act="loginMode" data-v="in">Logg inn</button></p>`;
    else if (m === "forgot") body = `<p class="muted">Skriv e-postadressen din, så sender vi en lenke der du kan velge nytt passord.</p>
      <form data-form="forgot" class="stack">${email}<div class="row"><button class="btn primary" type="submit" ${busy}>Send lenke</button>
      <button class="btn ghost" type="button" data-act="loginMode" data-v="in">Tilbake</button></div></form>`;
    else body = `<p class="muted">For arrangører og stewards. Alle kan se standings og resultater, og sende inn protester, uten å logge inn.</p>
      <form data-form="login" class="stack">${email}
      <label class="fld"><span>Passord</span><input id="loginPw" type="password" required autocomplete="current-password" /></label>
      <div class="row"><button class="btn primary" type="submit" ${busy}>Logg inn</button>${cancel}</div></form>
      <p class="small"><button class="linkbtn" data-act="loginMode" data-v="up">Første gang? Lag passord</button> ·<button class="linkbtn" data-act="loginMode" data-v="forgot">Glemt passord?</button></p>`;
    const title = { up: "Lag passord", forgot: "Glemt passord", sent: "Sjekk e-posten", newpw: "Nytt passord" }[m] || "Logg inn";
    return `<section class="panel narrow"><h2>${title}</h2>${body}</section>`;
  }

  /* ---------------- ny liga ---------------- */
  function viewNewLeague() {
    if (!S.canWrite) return `<div class="empty"><h2>Ingen ligaer ennå</h2><p class="muted">Arrangørene har ikke satt opp en liga her ennå.</p></div>`;
    const L = league();
    return `<section class="panel narrow">
      <h2>Ny liga</h2>
      <p class="muted">Starter med CSL-oppsettet: 6 runder med Heat og Feature, poeng 60-54-49-45-42-39-37-35-33-31 og videre ned, og egen tabell for Division 2. Alt kan endres under Oppsett.</p>
      <form data-form="newLeague" class="stack">
        <label class="fld"><span>Navn på serien</span><input id="nlName" required maxlength="80" value="CSL GT3 Double Sprint" /></label>
        ${L ? `<label class="chk"><input type="checkbox" id="nlCopy" checked /> Kopier oppsettet fra «${esc(L.name)}» (runder, poeng, logo), uten førere og resultater</label>` : ""}
        <div class="row"><button class="btn primary" type="submit">Opprett liga</button>
        ${L ? `<button class="btn ghost" type="button" data-act="cancelNew">Avbryt</button>` : ""}</div>
      </form></section>`;
  }

  /* ---------------- standings ---------------- */
  function standingsModel(L, mode) {
    const st = CORE.computeStandings(L, S.results, S.drivers, mode, pensByRid());
    const keys = st.keys;
    const columns = [{ label: "Pos", w: 44, align: "c", bold: true }, { label: "Driver", w: 210, align: "l", bold: true }];
    if (mode === "all" && L.d2 && L.d2.enabled) columns.push({ label: "Div", w: 40, align: "c" });
    keys.forEach((k) => columns.push({ label: k.label, w: 50, align: "c" }));
    columns.push({ label: "Total", w: 66, align: "r", bold: true });
    const lead = columns.length - keys.length - 1;
    const groups = [{ label: "", span: lead }];
    (L.rounds || []).forEach((rd, i) => groups.push({ label: rd.track || "Round " + (i + 1), span: (L.races || []).length }));
    groups.push({ label: "", span: 1 });
    const rows = [], styles = [];
    st.rows.forEach((r) => {
      const row = [r.pos, r.name];
      const sty = [{}, {}];
      if (mode === "all" && L.d2 && L.d2.enabled) { row.push(r.div || ""); sty.push({}); }
      keys.forEach((k) => {
        const c = r.cells[k.id];
        row.push(c ? (c.dq ? "DSQ" : c.zero ? fmtPtsNum(c.pts) : fmtPtsNum(c.pts)) : "");
        sty.push(c ? { rank: c.dq ? null : c.rank <= 3 ? c.rank : null, muted: !!c.dropped } : {});
      });
      row.push(fmtPtsNum(r.total)); sty.push({ bold: true });
      rows.push(row); styles.push(sty);
    });
    const d2n = (L.d2 && L.d2.name) || "Division 2";
    const best = +L.bestOf || 0;
    return { st, title: `${L.name} Standings${mode === "d2" ? " – " + d2n : ""}`, sheet: mode === "d2" ? "Standings " + d2n : "Standings",
             columns, groups, rows, styles,
             note: best > 0 ? `Best ${best} results count. Struck-out results are dropped.` : "" };
  }
  const fmtPtsNum = (v) => (v == null ? "" : Math.round(v * 100) / 100);

  function viewStandings(L) {
    const mode = L.d2 && L.d2.enabled ? S.stMode : "all";
    const m = standingsModel(L, mode);
    const d2n = (L.d2 && L.d2.name) || "Division 2";
    const nRes = Object.keys(S.results).length;
    const seg = L.d2 && L.d2.enabled ? `<div class="seg" role="group" aria-label="Tabell">
        <button class="${mode === "all" ? "on" : ""}" data-act="stMode" data-v="all">Totalt</button>
        <button class="${mode === "d2" ? "on" : ""}" data-act="stMode" data-v="d2">${esc(d2n)}</button></div>` : "";
    const head = `<div class="viewhead"><div><h2>${esc(m.title)}</h2>
      <p class="muted">${nRes} av ${CORE.raceKeys(L).length} løp kjørt${+L.bestOf ? ` · beste ${+L.bestOf} teller` : " · alle løp teller"}</p></div>
      <div class="tools">${seg}${exportBar("st")}</div></div>`;
    if (!m.st.rows.length) return head + `<div class="empty"><h3>Ingen resultater ennå</h3><p class="muted">Standings fylles ut så snart første løp er importert.</p>
      ${S.canWrite ? `<button class="btn primary" data-act="tab" data-v="import">Importer første løp</button>` : ""}</div>`;
    const keys = m.st.keys;
    const nRace = (L.races || []).length;
    const thG = (L.rounds || []).map((rd, i) => `<th colspan="${nRace}" class="grp">${esc(rd.track || "Runde " + (i + 1))}</th>`).join("");
    const thR = keys.map((k) => `<th class="num">${esc(k.label)}</th>`).join("");
    const divCol = mode === "all" && L.d2 && L.d2.enabled;
    const pOn = protestsOn(L);
    const open = pOn ? S.protests.filter(isOpen) : [];
    const decided = pOn ? S.protests.filter((p) => isDone(p) && p.decision && ["pen", "warn"].includes(p.decision.outcome)) : [];
    const penCount = (key) => decided.filter((p) => CORE.norm(decDriverName(p)) === key);
    const body = m.st.rows.map((r) => {
      const pc = penCount(r.key);
      const nPen = pc.filter((p) => p.decision.outcome === "pen").length, nWarn = pc.length - nPen;
      return `<tr>
        <td class="pos">${r.pos}</td><td class="name">${esc(r.name)}</td>${divCol ? `<td class="num"><span class="div d${r.div || 1}">${r.div || 1}</span></td>` : ""}
        ${keys.map((k) => { const c = r.cells[k.id]; if (!c) return `<td class="num"></td>`;
          const pp = c.pp || [];
          const op = open.filter((p) => p.round + "" === k.round + "" && p.race === k.race && CORE.norm(driverName(p.against_driver, p.against_name)) === r.key);
          const cls = [c.dq ? "dsq" : c.rank <= 3 ? "p" + c.rank : "", c.dropped ? "drop" : "", pp.length ? "cellmark" : "", op.length ? "cellopen" : ""].join(" ");
          const tip = [c.dq ? "Diskvalifisert" : c.rank ? c.rank + ". plass" : "", ...pp.map((x) => penShort(x) + " · Sak #" + x.case), ...op.map((p) => "Protest til behandling · Sak #" + p.no)].filter(Boolean).join("\n");
          const inner = c.dq ? "DSQ" : fmtPts(c.pts);
          const caseNo = pp.length ? pp[0].case : op.length ? op[0].no : null;
          return `<td class="num ${cls}" title="${esc(tip)}">${caseNo ? `<button class="cellbtn" data-act="openCase" data-no="${caseNo}" aria-label="${esc(tip)}">${inner}</button>` : inner}</td>`; }).join("")}
        ${pOn ? `<td class="num">${pc.length ? `<button class="linkbtn sm" data-act="pFilterDrv" data-name="${esc(r.name)}" title="${nPen} straff, ${nWarn} advarsel">${nPen ? nPen : ""}${nWarn ? ` <span class="badge">${nWarn} adv.</span>` : ""}</button>` : `<span class="muted">–</span>`}</td>` : ""}
        <td class="num tot">${fmtPts(r.total)}</td></tr>`; }).join("");
    const banner = open.length ? `<div class="status prov"><b>Foreløpig</b><span>${open.length === 1 ? "1 protest er" : open.length + " protester er"} til behandling (${open.map((p) => caseLink(p.no)).join(", ")}). Standings blir endelige når sakene er avgjort.</span></div>` : "";
    const seasonTab = decided.length ? `<section class="panel" style="margin-top:14px"><div class="viewhead" style="margin-bottom:6px"><h3 style="margin:0">Straffer og advarsler i sesongen</h3><span class="muted small">Alle avgjørelser med lenke til saken</span></div>
      <div class="tablewrap"><table class="grid pentab"><thead><tr><th>Løp</th><th>Sak</th><th>Fører</th><th>Straff</th><th>Hendelse</th><th>Avgjort</th></tr></thead><tbody>
      ${decided.slice().sort((a, b) => b.round - a.round || b.no - a.no).map((p) => `<tr><td>R${p.round} ${esc(raceLabel(L, p.race))}</td><td>${caseLink(p.no, "#" + p.no)}</td>
        <td class="name">${esc(decDriverName(p))}</td><td>${outcomePill(p.decision)}${p.decision.outcome === "pen" && !p.decision.apply ? ` <span class="muted small">ikke i resultatet</span>` : ""}</td>
        <td class="muted">${esc(p.kind || "")}</td><td class="muted">${fmtDate(p.decision.at)}</td></tr>`).join("")}</tbody></table></div></section>` : "";
    return head + banner + `<div class="tablewrap"><table class="grid st">
      <thead><tr><th rowspan="2" class="pos">Pos</th><th rowspan="2">Fører</th>${divCol ? `<th rowspan="2" class="num">Div</th>` : ""}${thG}${pOn ? `<th rowspan="2" class="num" title="Straffer og advarsler fra protestsaker">Straff</th>` : ""}<th rowspan="2" class="num">Total</th></tr><tr>${thR}</tr></thead>
      <tbody>${body}</tbody></table></div>
      <p class="legend"><span class="sw p1"></span>1. plass <span class="sw p2"></span>2. plass <span class="sw p3"></span>3. plass i løpet${+L.bestOf ? ` <span class="drop">00</span> ikke tellende` : ""}${pOn ? ` · <span class="cellmark demo">00</span> poeng endret av straff (trykk for sak) · <span class="cellopen demo">00</span> protest til behandling` : ""}</p>${seasonTab}`;
  }

  function exportBar(kind) {
    if (!S.dl) return `<span class="muted small">Nedlasting er ikke tilgjengelig i denne visningen.</span>`;
    const b = (fmt, t) => `<button class="btn sm" data-act="export" data-kind="${kind}" data-fmt="${fmt}" ${S.busy ? "disabled" : ""}>${t}</button>`;
    let extra = "";
    if (kind === "st") extra = `<button class="btn sm primary" data-act="export" data-kind="season" data-fmt="pdf" ${S.busy ? "disabled" : ""}>Hele sesongen (PDF)</button>`;
    return `<div class="exp">${b("pdf", "PDF")}${b("png", "PNG")}${b("xlsx", "Excel")}${kind === "st" ? b("csv", "CSV") : ""}${extra}</div>`;
  }

  /* ---------------- resultater ---------------- */
  function raceModel(L, res, mode) {
    const rows = CORE.computeRace(res, L, driverMap(), pensByRid()[res.id]);
    const d2on = L.d2 && L.d2.enabled;
    const d2n = (L.d2 && L.d2.name) || "Division 2";
    const list = mode === "d2" ? rows.filter((r) => r.d2pos != null || (r.dq && r.div === 2)) : rows;
    const columns = mode === "d2"
      ? [{ label: "Pos", w: 46, align: "c", bold: true }, { label: "Overall", w: 54, align: "c" }]
      : [{ label: "Pos", w: 46, align: "c", bold: true }];
    columns.push({ label: "#", w: 40, align: "c" }, { label: "Name", w: 190, align: "l", bold: true });
    if (mode === "all" && d2on) columns.push({ label: "Div", w: 36, align: "c" });
    columns.push({ label: "Car", w: 200, align: "l" }, { label: "Start\nPos", w: 44, align: "c" }, { label: "Interval", w: 76, align: "r" },
      { label: "Laps\nLed", w: 40, align: "c" }, { label: "Fastest\nLap Time", w: 70, align: "c" }, { label: "Laps\nComp", w: 44, align: "c" },
      { label: "Inc", w: 36, align: "c" }, { label: "Points", w: 52, align: "c", bold: true }, { label: "Penalty", w: 56, align: "c" });
    const out = [], styles = [], gap = gapFn(rows, mode, res);
    list.forEach((r) => {
      const pos = mode === "d2" ? (r.dq ? "DSQ" : r.d2pos) : r.dq ? "DSQ" : r.cpos;
      const pen = penText(r) || 0;
      const row = mode === "d2" ? [pos, r.dq ? "" : r.cpos] : [pos];
      row.push(r.num, r.name);
      if (mode === "all" && d2on) row.push(r.div);
      row.push(r.car, r.start ?? "", gap(r), r.led, r.best, r.laps, r.inc,
        fmtPtsNum(mode === "d2" ? r.d2pts ?? 0 : r.pts), pen);
      out.push(row);
      const rk = mode === "d2" ? r.d2pos : r.cpos;
      styles.push(row.map((_, i) => (i === 0 && rk && rk <= 3 && !r.dq ? { rank: rk } : r.dq ? { color: "#9b0010" } : {})));
    });
    const raceName = raceLabel(L, res.race);
    const track = trackOf(L, res.round);
    const title = `${L.name} - ${raceName} results${mode === "d2" ? " " + d2n : ""} from ${track}`;
    return { rows, title, sheet: `R${res.round} ${raceShort(L, res.race)}${mode === "d2" ? " Div2" : ""}`, columns, rows2: out, styles };
  }

  /** Vinneren viser total løpstid, resten gap. I Division 2 regnes gap fra Div 2-vinneren. */
  function gapFn(rows, mode, res) {
    const leader = rows.find((r) => (mode === "d2" ? r.d2pos === 1 : r.cpos === 1));
    const lg = leader ? (mode === "d2" ? CORE.secs(leader.gap) : 0) : null;
    const T = +res.raceTime || 0;
    return (r) => {
      if (r.dq && !/L$/.test(r.gap)) return r.out;
      if (r === leader) {
        const add = (rows.find((x) => x.cpos === 1) || {}).rtAdd || 0; // tidsstraff kan gi ny vinner med lengre tid
        return T && lg != null ? CORE.fmtTime(T + add + lg) : r.gap;
      }
      if (mode === "d2" && lg) { const g = CORE.secs(r.gap); if (g != null) return CORE.fmtGap(Math.max(0, g - lg)); }
      return r.gap;
    };
  }

  function viewResults(L) {
    const keys = CORE.raceKeys(L);
    const have = keys.filter((k) => S.results[k.id]);
    if (!S.sel || !keys.find((k) => k.id === S.sel)) S.sel = have.length ? have[have.length - 1].id : keys[0] && keys[0].id;
    const picker = `<div class="picker">${(L.rounds || []).map((rd, i) => `<div class="rcard"><div class="rt"><span class="rn">R${i + 1}</span> ${esc(rd.track || "Bane ikke satt")}</div>
      <div class="chips">${(L.races || []).map((ra) => { const id = "r" + (i + 1) + "-" + ra.key; const has = !!S.results[id];
        return `<button class="chip ${has ? "has" : ""} ${S.sel === id ? "on" : ""}" data-act="sel" data-v="${id}">${esc(ra.short || ra.label)}</button>`; }).join("")}</div></div>`).join("")}</div>`;
    const res = S.results[S.sel];
    const k = keys.find((x) => x.id === S.sel);
    if (!res) return `<div class="viewhead"><div><h2>Resultater</h2><p class="muted">Velg et løp. Fylte knapper har resultat.</p></div></div>${picker}
      <div class="empty"><h3>${k ? esc(raceLabel(L, k.race)) + " · " + esc(trackOf(L, k.round)) : ""}</h3><p class="muted">Ingen resultat importert for dette løpet.</p>
      ${S.canWrite && k ? `<button class="btn primary" data-act="importFor" data-round="${k.round}" data-race="${k.race}">Importer dette løpet</button>` : ""}</div>`;
    const d2on = L.d2 && L.d2.enabled;
    const mode = d2on ? S.resMode : "all";
    const m = raceModel(L, res, mode);
    const d2n = (L.d2 && L.d2.name) || "Division 2";
    const imported = res.importedAt ? new Date(res.importedAt).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" }) : "";
    const confirmDel = S.confirm === "delRes:" + res.id;
    const srcTxt = { fil: "fra filen", beregnet: "beregnet fra snittid × runder", manuell: "lagt inn manuelt" }[res.raceTimeSrc] || "";
    const rtCtl = S.canWrite ? `<label class="rtbox"><span>Løpstid vinner</span><input id="rtInput" class="mono" value="${esc(CORE.fmtTime(res.raceTime))}" placeholder="mm:ss.000" data-chg="raceTime" aria-label="Total løpstid for vinneren" /></label>${srcTxt ? `<span class="muted small">${srcTxt}</span>` : ""}`
      : "";
    const ctrl = S.canWrite ? `${rtCtl}<label class="chk"><input type="checkbox" data-chg="half" ${res.half ? "checked" : ""}/> Halve poeng</label>
      ${confirmDel ? `<span class="confirm">Slette resultatet? <button class="btn sm danger" data-act="delRes">Slett</button><button class="btn sm ghost" data-act="cancelConfirm">Avbryt</button></span>`
        : `<button class="btn sm ghost" data-act="askDelRes">Slett resultat</button>`}` : "";
    const head = `<div class="viewhead"><div><h2>R${res.round} ${esc(raceLabel(L, res.race))} · ${esc(trackOf(L, res.round))}</h2>
      <p class="muted">${esc(res.format || "")}${res.source ? " · " + esc(res.source) : ""}${imported ? " · importert " + imported : ""}</p></div>
      <div class="tools">${d2on ? `<div class="seg"><button class="${mode === "all" ? "on" : ""}" data-act="resMode" data-v="all">Totalt</button><button class="${mode === "d2" ? "on" : ""}" data-act="resMode" data-v="d2">${esc(d2n)}</button></div>` : ""}${exportBar("race")}</div></div>`;
    const list = mode === "d2" ? m.rows.filter((r) => r.d2pos != null || (r.dq && r.div === 2)) : m.rows;
    const gap = gapFn(m.rows, mode, res);
    const pOn = protestsOn(L);
    const open = pOn ? S.protests.filter((p) => isOpen(p) && "r" + p.round + "-" + p.race === res.id) : [];
    const body = list.map((r) => {
      const pos = mode === "d2" ? (r.dq ? "DSQ" : r.d2pos) : r.dq ? "DSQ" : r.cpos;
      const rk = mode === "d2" ? r.d2pos : r.cpos;
      const pts = mode === "d2" ? r.d2pts ?? 0 : r.pts;
      const mv = r.origPos && r.origPos !== r.pos && !r.dq ? (r.pos < r.origPos ? `<span class="mv up" title="Opp ${r.origPos - r.pos} plass(er) etter straff">▲${r.origPos - r.pos}</span>` : `<span class="mv dn" title="Ned ${r.pos - r.origPos} plass(er) etter straff">▼${r.pos - r.origPos}</span>`) : "";
      const op = open.filter((p) => CORE.norm(driverName(p.against_driver, p.against_name)) === r.key).map((p) => `<button class="openpill" data-act="openCase" data-no="${p.no}" title="Protest til behandling mot føreren">Protest #${p.no}</button>`).join("");
      return `<tr class="${r.dq ? "isdq" : ""} ${r.pp && r.pp.length ? "hadpen" : ""}"><td class="pos ${!r.dq && rk <= 3 ? "p" + rk : ""}">${pos}</td>
        ${mode === "d2" ? `<td class="num muted">${r.dq ? "" : r.cpos}</td>` : ""}
        <td class="num">${esc(r.num)}</td><td class="name">${esc(r.name)}${mv}${op}</td>
        ${mode === "all" && d2on ? `<td class="num"><span class="div d${r.div}" title="Divisjon fra ${r.divSrc}">${r.div}</span></td>` : ""}
        <td class="car">${esc(r.car)}</td><td class="num">${r.start ?? ""}</td><td class="num mono ${(mode === "d2" ? r.d2pos : r.cpos) === 1 && res.raceTime ? "rtime" : ""}">${esc(gap(r))}${r.tpen && !r.dq ? ` <span class="muted small">(inkl. ${fmtPts(r.tpen)} s)</span>` : ""}</td>
        <td class="num">${r.led}</td><td class="num mono">${esc(r.best)}</td><td class="num">${r.laps}</td><td class="num">${r.inc}</td>
        <td class="num tot">${fmtPts(pts)}</td><td class="pen">${(r.pp || []).map((x) => `<span class="penpill">${esc(penShort(x))}</span> ${caseLink(x.case, "Sak #" + x.case)}`).join(" ")}${penCell(r)}</td></tr>`;
    }).join("");
    const nDq = m.rows.filter((r) => r.dq).length, n2 = m.rows.filter((r) => r.div === 2).length;
    const dl = pOn ? CORE.protestDeadline(L, res.round) : null;
    const banner = open.length || (pOn && protestCfg(L).enabled && dl && Date.now() < dl)
      ? `<div class="status prov"><b>Foreløpig resultat</b><span>${open.length ? `${open.length === 1 ? "1 protest er" : open.length + " protester er"} til behandling i dette løpet: ${open.map((p) => caseLink(p.no, "Sak #" + p.no)).join(", ")}. Plasseringer og poeng kan endres.` : "Protestfristen er ikke ute ennå."}</span>${dl ? `<span class="grow muted small">Protestfrist: ${fmtDate(dl, true)}</span>` : ""}</div>` : "";
    const raceCases = pOn ? S.protests.filter((p) => isDone(p) && p.decision && ["pen", "warn"].includes(p.decision.outcome) && "r" + p.round + "-" + p.race === res.id) : [];
    const penList = raceCases.length ? `<section class="panel" style="margin-top:14px"><h3>Straffer i dette løpet</h3><div class="tablewrap"><table class="grid pentab"><thead><tr><th>Sak</th><th>Fører</th><th>Hendelse</th><th>Straff</th><th>Effekt</th></tr></thead><tbody>
      ${raceCases.map((p) => { const r = m.rows.find((x) => x.key === CORE.norm(decDriverName(p)));
        const eff = p.decision.outcome !== "pen" ? "Ingen endring" : !p.decision.apply ? "Ikke lagt inn i resultatet" : r ? (r.dq ? "Diskvalifisert, 0 poeng" : (r.origPos && r.origPos !== r.pos ? `${r.origPos}. → ${r.pos}. plass · ` : "") + fmtPts(r.pts) + " poeng") : "";
        return `<tr><td>${caseLink(p.no, "#" + p.no)}</td><td class="name">${esc(decDriverName(p))}</td><td class="muted">${p.lap ? "Runde " + p.lap + " · " : ""}${esc(p.kind || "")}</td><td>${outcomePill(p.decision)}</td><td class="muted">${esc(eff)}</td></tr>`; }).join("")}
      </tbody></table></div></section>` : "";
    return head + picker + banner + `<div class="bar">${ctrl}<span class="muted small">${m.rows.length} førere · ${n2} i ${esc(d2n)}${nDq ? " · " + nDq + " DSQ" : ""}</span></div>
      <div class="tablewrap"><table class="grid res"><thead><tr>
        <th class="pos">${mode === "d2" ? "Pos" : "Pos"}</th>${mode === "d2" ? `<th class="num">Totalt</th>` : ""}<th class="num">#</th><th>Fører</th>
        ${mode === "all" && d2on ? `<th class="num">Div</th>` : ""}<th>Bil</th><th class="num">Start</th><th class="num">Gap</th><th class="num">Ledet</th>
        <th class="num">Beste runde</th><th class="num">Runder</th><th class="num">Inc</th><th class="num">Poeng</th><th>Straff</th></tr></thead>
        <tbody>${body}</tbody></table></div>
      <p class="legend">Straff: poengtrekk trekkes fra løpets poeng. DNF, DNS og DSQ gir 0 poeng. DSQ flytter de bak opp en plass. Status DQ i filen gir 0 poeng automatisk.${pOn ? " Straffer med saksnummer kommer fra protestsaker og endres ved å endre avgjørelsen." : ""}</p>${penList}`;
  }

  function penCell(r) {
    const p = r.p;
    if (!S.canWrite) return p ? (p.t === "pts" ? "-" + fmtPts(p.v) : p.t) : "";
    const t = p ? p.t : "";
    const o = (v, l) => `<option value="${v}" ${t === v ? "selected" : ""}>${l}</option>`;
    return `<div class="penbox"><select data-chg="penT" data-key="${esc(r.key)}" aria-label="Straff for ${esc(r.name)}">${o("", "–")}${o("pts", "Poengtrekk")}${o("DNF", "DNF")}${o("DNS", "DNS")}${o("DSQ", "DSQ")}</select>
      ${t === "pts" ? `<input type="number" min="0" step="1" value="${esc(p.v || 0)}" data-chg="penV" data-key="${esc(r.key)}" aria-label="Poengtrekk" />` : ""}</div>`;
  }

  /* ---------------- protester: hjelpere ---------------- */
  const protestCfg = (L) => CORE.protestDefaults(L && L.protests);
  const protestsOn = (L) => Array.isArray(S.protests) && (protestCfg(L).enabled || S.protests.length > 0);
  const protestTab = (L) => protestsOn(L) || (Array.isArray(S.protests) && S.leagues.some((l) => protestCfg(l).enabled));
  const isOpen = (p) => ["submitted", "review", "appealed"].includes(p.status);
  const isDone = (p) => ["decided", "closed"].includes(p.status);
  const driverById = (id) => S.drivers.find((d) => d.id === id) || null;
  const driverName = (id, fallback) => { const d = id && driverById(id); return d ? d.name : fallback || ""; };
  const driverNum = (id) => { const d = id && driverById(id); return d && d.num ? d.num : ""; };
  const decDriverName = (p) => driverName(p.decision && p.decision.driver, p.decision && p.decision.driverName);
  function pensByRid() { return Array.isArray(S.protests) ? CORE.protestPens(S.protests, (id) => driverName(id, "")) : {}; }
  const caseLink = (no, label) => `<button class="caselink" data-act="openCase" data-no="${no}">${esc(label || "#" + no)}</button>`;
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");
  function fmtDate(v, withDay) {
    if (!v) return "";
    const d = new Date(v); if (isNaN(d)) return "";
    return d.toLocaleString("nb-NO", withDay ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function penShort(x) {
    if (!x) return "";
    if (x.t === "pts") return "−" + fmtPts(x.v) + " p";
    if (x.t === "time") return "+" + fmtPts(x.v) + " s";
    return x.t;
  }
  function penText(r) {
    const parts = (r.pp || []).map(penShort);
    if (r.p) parts.push(r.p.t === "pts" ? "-" + fmtPts(r.p.v) : r.p.t);
    return parts.join(", ");
  }
  function penLong(pen) {
    if (!pen) return "";
    if (pen.t === "pts") return fmtPts(pen.v) + " poeng trekk";
    if (pen.t === "time") return fmtPts(pen.v) + " sekunder tidsstraff";
    if (pen.t === "DSQ") return "Diskvalifisert fra løpet";
    return pen.t;
  }
  const OUTCOME = { nfa: "Ingen videre handling", warn: "Advarsel", pen: "Straff", rejected: "Avvist" };
  function outcomeText(d) { if (!d) return ""; return d.outcome === "pen" ? "Straff · " + penLong(d.pen) : OUTCOME[d.outcome] || ""; }
  function outcomePill(d) {
    if (!d) return "";
    if (d.outcome === "pen") return `<span class="penpill">${esc(penShort(d.pen))}</span>`;
    return `<span class="badge ${d.outcome === "nfa" ? "nfa" : ""}">${esc(OUTCOME[d.outcome] || "")}</span>`;
  }
  function statusBadge(p) {
    if (p.status === "submitted") return `<span class="badge sub">Sendt inn</span>`;
    if (p.status === "review") return `<span class="badge rev">Under behandling</span>`;
    if (p.status === "appealed") return `<span class="badge app">Anket</span>`;
    const d = p.decision;
    if (!d) return `<span class="badge">Lukket</span>`;
    if (d.outcome === "pen") return `<span class="badge pen">Straff</span>`;
    if (d.outcome === "nfa") return `<span class="badge nfa">Ingen videre handling</span>`;
    return `<span class="badge">${esc(OUTCOME[d.outcome] || "Lukket")}</span>`;
  }
  const findCase = (no) => (S.protests || []).find((p) => p.no === +no) || null;
  const anyProtestLeague = () => S.leagues.some((l) => protestCfg(l).enabled);
  /** Protester igjen for en fører i en runde (hentes fra databasen og huskes til neste endring). */
  const quotaKey = (round, did) => round + ":" + did;
  async function needQuota(L, round, did) {
    const k = quotaKey(round, did);
    if (!did || S.quota[k] != null || S.quota["_" + k]) return;
    S.quota["_" + k] = true;
    try { S.quota[k] = await DATA.quota(L.id, round, did); } catch (e) {} finally { delete S.quota["_" + k]; }
    softRender();
  }
  /** Førere i et løp, hentet fra resultatfilen, koblet til førerlisten (id). */
  function raceDrivers(rid) {
    const res = S.results[rid]; if (!res) return [];
    const dm = driverMap();
    return (res.rows || []).map((r) => { const d = dm.get(CORE.norm(r.name)); return d ? { id: d.id, name: d.name, num: r.num || d.num || "" } : null; })
      .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "nb"));
  }
  const raceOpts = (L) => CORE.raceKeys(L).filter((k) => S.results[k.id]).map((k) => ({ ...k, name: `R${k.round} ${trackOf(L, k.round)} · ${raceLabel(L, k.race)}` }));
  const embedUrl = (u) => {
    let m = String(u).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    if (m) return "https://www.youtube-nocookie.com/embed/" + m[1];
    m = String(u).match(/streamable\.com\/(?:e\/)?([a-z0-9]+)/i);
    if (m) return "https://streamable.com/e/" + m[1];
    return "";
  };
  function videoBlock(u) {
    const url = safeUrl(u); if (!url) return "";
    const em = embedUrl(url);
    return `${em ? `<div class="videobox"><iframe src="${esc(em)}" title="Video" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}
      <p class="small"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">Åpne videoen i ny fane ↗</a></p>`;
  }

  /* ---------------- protester: visninger ---------------- */
  function viewProtests(L) {
    if (!Array.isArray(S.protests)) return `<div class="empty"><div class="spin"></div><p>Henter protester…</p></div>`;
    const pv = S.pv;
    if (pv.mode === "new") return viewProtestForm(L);
    const p = pv.id ? S.protests.find((x) => x.id === pv.id) : null;
    if (pv.mode === "case" && p) return viewCase(L, p);
    if (pv.mode === "decide" && p && S.canSteward) return viewDecide(L, p);
    pv.mode = "list";
    return viewProtestList(L);
  }

  function caseCard(L, p) {
    const by = driverName(p.by_driver, p.by_name), ag = driverName(p.against_driver, p.against_name);
    const nb = p.by_num || driverNum(p.by_driver), na = p.against_num || driverNum(p.against_driver);
    const d = p.decision;
    const right = isOpen(p)
      ? `<div><div class="lbl">Status</div>${statusBadge(p)}${p.status === "appealed" && d ? `<div class="small muted dec">Opprinnelig: ${esc(outcomeText(d))}</div>` : ""}</div>`
      : `<div><div class="lbl">Avgjørelse</div>${statusBadge(p)}${d ? `<div class="dec">${esc(d.outcome === "pen" ? penShort(d.pen) + " · " + decDriverName(p) : d.outcome === "warn" ? "Advarsel · " + decDriverName(p) : d.outcome === "nfa" ? "Racinghendelse" : "")}</div>` : ""}</div>`;
    return `<div class="case ${isOpen(p) ? "open" : ""}"><span class="no">Sak #${p.no}</span>
      <div><div class="lbl">Sendt inn av</div><div class="drvn">${nb ? `<span class="n">#${esc(nb)}</span>` : ""}${esc(by)}</div></div>
      <div><div class="lbl">Mot</div><div class="drvn">${na ? `<span class="n">#${esc(na)}</span>` : ""}${esc(ag)}</div></div>
      <div><div class="lbl">Hendelse</div><div>R${p.round} ${esc(raceLabel(L, p.race))}${p.lap ? " · Runde " + p.lap : ""}</div><div class="muted small">${esc(p.kind || "")}</div></div>
      ${right}
      <div class="act"><button class="btn" data-act="openCase" data-no="${p.no}">Se detaljer</button></div></div>`;
  }

  function viewProtestList(L) {
    const cfg = protestCfg(L), f = S.pv.f;
    const keys = raceOpts(L);
    let list = S.protests.slice();
    if (f.rid) list = list.filter((p) => "r" + p.round + "-" + p.race === f.rid);
    if (f.no) list = list.filter((p) => String(p.no) === String(f.no).replace("#", "").trim());
    if (f.drv) list = list.filter((p) => [driverName(p.by_driver, p.by_name), driverName(p.against_driver, p.against_name)].some((n) => CORE.norm(n) === CORE.norm(f.drv)));
    if (f.st === "open") list = list.filter(isOpen); else if (f.st === "done") list = list.filter((p) => !isOpen(p));
    const open = list.filter(isOpen).sort((a, b) => b.no - a.no), done = list.filter((p) => !isOpen(p)).sort((a, b) => b.no - a.no);
    const names = [...new Set(S.protests.flatMap((p) => [driverName(p.by_driver, p.by_name), driverName(p.against_driver, p.against_name)]))].filter(Boolean).sort((a, b) => a.localeCompare(b, "nb"));
    // frist for siste runde med resultat
    let info = "";
    const last = keys[keys.length - 1];
    if (cfg.enabled && last) {
      const dl = CORE.protestDeadline(L, last.round);
      info = `<div class="note"><b>Frist:</b><span>${dl ? (Date.now() < dl ? `Protester for R${last.round} ${esc(trackOf(L, last.round))} kan sendes inn til <b>${fmtDate(dl, true)}</b>.` : `Fristen for R${last.round} ${esc(trackOf(L, last.round))} gikk ut ${fmtDate(dl, true)}.`) : `Protester sendes inn senest ${cfg.deadlineH} timer etter løpsdagen.`}
        Hver fører har ${cfg.perRound} protester per runde. En protest som fører fram, gis tilbake.</span></div>`;
    }
    const sel = (v, cur) => (String(v) === String(cur) ? "selected" : "");
    return `<div class="viewhead"><div><h2>Protester</h2><p class="muted">Send inn hendelser, og følg stewardenes avgjørelser og anker. Alle kan lese sakene.</p></div></div>
      <div class="filters">
        <label class="fld"><span>Løp</span><select data-chg="pf.rid"><option value="">Alle løp</option>${keys.map((k) => `<option value="${k.id}" ${sel(k.id, f.rid)}>${esc(k.name)}</option>`).join("")}</select></label>
        <label class="fld"><span>Sak #</span><input data-chg="pf.no" value="${esc(f.no)}" placeholder="f.eks. 12" style="width:100px" inputmode="numeric" /></label>
        <label class="fld"><span>Fører</span><select data-chg="pf.drv"><option value="">Alle førere</option>${names.map((n) => `<option ${sel(n, f.drv)}>${esc(n)}</option>`).join("")}</select></label>
        <label class="fld"><span>Status</span><select data-chg="pf.st"><option value="">Alle saker</option><option value="open" ${sel("open", f.st)}>Til behandling</option><option value="done" ${sel("done", f.st)}>Avgjort</option></select></label>
        <div class="grow">${anyProtestLeague() ? `<button class="btn primary" data-act="newProtest">+ Send inn protest</button>` : ""}</div>
      </div>
      ${info}
      ${!cfg.enabled ? `<div class="note"><b>Stengt</b><span>Denne løpsserien tar ikke imot nye protester.${S.canWrite ? " Slå det på under Oppsett → Protester." : ""}</span></div>` : ""}
      ${open.length ? `<div class="sechead open"><h3>Til behandling · ${open.length}</h3><span class="muted small">Venter på avgjørelse eller ankebehandling</span></div>${open.map((p) => caseCard(L, p)).join("")}` : ""}
      ${done.length ? `<div class="sechead done"><h3>Avgjort · ${done.length}</h3></div>${done.map((p) => caseCard(L, p)).join("")}` : ""}
      ${!list.length ? `<div class="empty"><h3>${S.protests.length ? "Ingen saker passer filteret" : "Ingen protester ennå"}</h3></div>` : ""}`;
  }

  function viewProtestForm(L) {
    const open = S.leagues.filter((l) => protestCfg(l).enabled);
    if (!open.length) { S.pv.mode = "list"; return viewProtestList(L); }
    if (!S.pf) S.pf = { chosen: open.length === 1 && open[0].id === L.id, rid: "", by: "", byNum: "", against: "", againstNum: "", kind: "", lap: "", replay: "", descr: "", video: "" };
    const F = S.pf, cfg = protestCfg(L);
    const sel = (v, cur) => (String(v) === String(cur) ? "selected" : "");
    const leagueSel = `<label class="fld s4"><span>Løpsserie</span><select id="pfLeague" data-chg="pform.league" required class="${F.chosen ? "" : "attn"}">
        ${F.chosen ? "" : `<option value="">Velg løpsserie…</option>`}${open.map((l) => `<option value="${esc(l.id)}" ${F.chosen && l.id === L.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>`;
    const head = `<section class="panel pform"><p class="small"><button class="linkbtn" data-act="pList">← Alle protester</button></p>
      <h2>Send inn protest</h2>
      <p class="muted small">Du trenger ikke å logge inn. En protest eller anke koster én av førerens ${cfg.perRound} protester for runden. Svar på saker er gratis. En protest som fører fram, gis tilbake. Video legges ved som lenke (YouTube, Streamable, Google Drive e.l.).</p>`;
    if (!F.chosen || !cfg.enabled) return head + `<form class="formgrid" onsubmit="return false">${leagueSel}<p class="muted s4">Velg løpsserien hendelsen skjedde i. Det finnes flere serier, så sjekk at du velger riktig.</p></form></section>`;
    const keys = raceOpts(L);
    if (!F.rid || !keys.find((x) => x.id === F.rid)) F.rid = keys.length ? keys[keys.length - 1].id : "";
    if (!F.kind) F.kind = cfg.kinds[0] || "";
    const k = keys.find((x) => x.id === F.rid);
    const drv = k ? raceDrivers(k.id) : [];
    if (F.by && !drv.find((d) => d.id === F.by)) F.by = "";
    if (F.against && !drv.find((d) => d.id === F.against)) F.against = "";
    if (k && F.by) needQuota(L, k.round, F.by);
    const q = k && F.by ? S.quota[quotaKey(k.round, F.by)] : null;
    const dl = k ? CORE.protestDeadline(L, k.round) : null;
    const late = dl && Date.now() > dl;
    const opt = (d, cur, skip) => (d.id === skip ? "" : `<option value="${esc(d.id)}" ${sel(d.id, cur)}>${d.num ? "#" + esc(d.num) + " " : ""}${esc(d.name)}</option>`);
    return head + `<form data-form="protest" class="formgrid">
        ${leagueSel}
        <label class="fld s4"><span>Løp</span><select id="pfRid" data-chg="pform.rid" required>${keys.length ? keys.map((x) => `<option value="${x.id}" ${sel(x.id, F.rid)}>${esc(x.name)}</option>`).join("") : `<option value="">Ingen løp med resultat ennå</option>`}</select></label>
        <label class="fld s4"><span>Din fører</span><select id="pfBy" data-chg="pform.by" required><option value="">Velg deg selv…</option>${drv.map((d) => opt(d, F.by)).join("")}</select></label>
        <label class="fld s4"><span>Protest mot</span><select id="pfAgainst" data-chg="pform.against" required><option value="">Velg fører…</option>${drv.map((d) => opt(d, F.against, F.by)).join("")}</select></label>
        <label class="fld s4"><span>Hendelsestype</span><select id="pfKind" data-chg="pform.kind">${cfg.kinds.map((x) => `<option ${sel(x, F.kind)}>${esc(x)}</option>`).join("")}</select></label>
        <label class="fld s2"><span>Ditt bilnummer</span><input id="pfByNum" data-chg="pform.byNum" value="${esc(F.byNum)}" inputmode="numeric" maxlength="10" /></label>
        <label class="fld s2"><span>Protestert bilnummer</span><input id="pfAgainstNum" data-chg="pform.againstNum" value="${esc(F.againstNum)}" inputmode="numeric" maxlength="10" /></label>
        <label class="fld s2"><span>Runde</span><input id="pfLap" data-chg="pform.lap" type="number" min="0" max="999" inputmode="numeric" value="${esc(F.lap)}" required /></label>
        <label class="fld s2"><span>Replay-tid</span><input id="pfReplay" data-chg="pform.replay" class="mono" value="${esc(F.replay)}" placeholder="mm:ss" maxlength="20" required /></label>
        <div class="s4 quota"><span>Protester igjen i runden: <b>${!F.by ? "velg fører" : q == null ? "…" : q + " av " + cfg.perRound}</b></span><span>Runde og replay-tid finner du i iRacing-replayen (klokken nederst).</span></div>
        <label class="fld s4"><span>Beskrivelse</span><textarea id="pfDescr" data-chg="pform.descr" maxlength="4000" required placeholder="Kort og saklig: hva skjedde, og hvem gjorde hva?">${esc(F.descr)}</textarea></label>
        <label class="fld s4"><span>Video${cfg.video === "req" ? "" : " (valgfritt)"}</span><input id="pfVideo" data-chg="pform.video" type="url" value="${esc(F.video)}" placeholder="https://youtu.be/…" ${cfg.video === "req" ? "required" : ""} maxlength="500" />
          <span class="hint">Lenke til en video som kan spilles av (YouTube, Streamable, Google Drive), ikke en iRacing-replayfil. Sett delingen til «alle med lenken».</span></label>
        <label class="hp" aria-hidden="true">Nettside <input id="pfWebsite" tabindex="-1" autocomplete="off" /></label>
        ${late ? `<p class="error s4">Protestfristen for dette løpet gikk ut ${fmtDate(dl, true)}.</p>` : ""}
        ${q === 0 ? `<p class="error s4">${esc(driverName(F.by))} har ingen protester igjen i denne runden.</p>` : ""}
        <div class="row s4 formbtns"><button class="btn primary" type="submit" ${late || q === 0 || !k || S.busy === "protest" ? "disabled" : ""}>${S.busy === "protest" ? "Sender…" : "Send inn protest"}</button><button class="btn ghost" type="button" data-act="pList">Avbryt</button></div>
      </form></section>`;
  }

  function viewCase(L, p) {
    const by = driverName(p.by_driver, p.by_name), ag = driverName(p.against_driver, p.against_name);
    const nb = p.by_num || driverNum(p.by_driver), na = p.against_num || driverNum(p.against_driver);
    const d = p.decision;
    const evs = S.pevents.filter((e) => e.protest_id === p.id);
    const canAppeal = p.status === "decided" && p.appeal_until && Date.now() < new Date(p.appeal_until).getTime();
    const canRespond = isOpen(p);
    const R = S.reply && S.reply.id === p.id ? S.reply : null;
    if (R && R.kind === "appeal" && R.driver) needQuota(L, p.round, R.driver);
    const rq = R && R.driver ? S.quota[quotaKey(p.round, R.driver)] : null;
    const kindName = { submitted: "Protest sendt inn", response: "Svar / nytt bevis", appeal: "Anke sendt inn", review: "Under behandling", decision: "Avgjørelse publisert", refund: "Protest gitt tilbake", closed: "Saken er lukket", reopened: "Saken er gjenåpnet", note: "Notat" };
    const decBox = d ? `<div class="decision ${p.status === "appealed" ? "old" : ""}">
        <h3>${p.status === "appealed" ? "Avgjørelse (anket)" : "Stewardenes avgjørelse"}</h3>
        <div class="out">${esc(outcomeText(d))}</div>
        <dl class="kv">${d.outcome === "pen" || d.outcome === "warn" ? `<dt>Gjelder</dt><dd>${esc(decDriverName(p))}</dd>` : ""}
          ${d.rule ? `<dt>Regel</dt><dd>${esc(d.rule)}</dd>` : ""}
          ${d.outcome === "pen" ? `<dt>Lagt inn i resultat</dt><dd>${d.apply ? (isDone(p) ? `Ja, R${p.round} ${esc(raceLabel(L, p.race))} – resultater og standings er oppdatert` : "Nei, ikke mens saken er åpen") : "Nei"}</dd>` : ""}
          <dt>Utfall for innsender</dt><dd>${d.outcome === "pen" || d.outcome === "warn" ? "Protesten førte fram" : d.outcome === "rejected" ? "Protesten ble avvist" : "Protesten førte ikke fram"}${d.refund ? " (protesten gis tilbake)" : ""}</dd></dl>
        ${d.reason ? `<p class="reason">${esc(d.reason)}</p>` : ""}</div>` : "";
    const stew = S.canSteward ? `<div class="adminbar"><div class="lbl">Stewards</div>
        ${p.status === "submitted" || p.status === "appealed" ? `<button class="btn sm" data-act="pStatus" data-v="review">Merk som under behandling</button>` : ""}
        ${isOpen(p) ? `<button class="btn sm primary" data-act="pDecide">${d && p.status !== "appealed" ? "Endre avgjørelse" : "Avgjør sak"}</button>` : ""}
        ${p.status === "decided" ? `<button class="btn sm" data-act="pStatus" data-v="closed">Lukk sak</button>` : ""}
        ${isDone(p) ? `<button class="btn sm" data-act="pStatus" data-v="reopened">Gjenåpne</button>` : ""}
        ${S.canWrite ? (S.confirm === "delCase:" + p.id ? `<span class="confirm">Slette saken for godt? <button class="btn sm danger" data-act="delCase">Slett</button><button class="btn sm ghost" data-act="cancelConfirm">Avbryt</button></span>` : `<button class="btn sm ghost" data-act="askDelCase" title="For spam eller feil innsending">Slett sak</button>`) : ""}
        ${isDone(p) && d && d.outcome === "pen" && d.apply ? `<p class="muted small" style="width:100%;margin:0">Gjenåpner du saken, tas straffen ut av resultatet til saken er avgjort på nytt.</p>` : ""}</div>` : "";
    const replyForm = R ? `<form class="panel" data-form="reply"><h3>${R.kind === "appeal" ? "Anke avgjørelsen" : "Legg til svar eller bevis"}</h3>
        <p class="muted small">${R.kind === "appeal" ? `En anke koster én protest${R.driver ? ` (${esc(driverName(R.driver))} har ${rq == null ? "…" : rq} igjen i runden)` : ""}, og gis tilbake hvis den fører fram. Anken vises i sakshistorikken.` : "Gratis. Bare stewards ser svaret."} Bare de to førerne i saken kan svare eller anke.</p>
        <label class="fld"><span>Hvem er du?</span><select id="rpDriver" data-chg="reply.driver" required><option value="">Velg…</option>
          ${[[p.by_driver, by], [p.against_driver, ag]].filter((x) => x[0]).map(([id, n]) => `<option value="${esc(id)}" ${R.driver === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
        <label class="fld"><span>Tekst</span><textarea id="rpText" required maxlength="4000" style="font-family:var(--body);font-size:15px;min-height:100px">${esc(R.text || "")}</textarea></label>
        <label class="fld"><span>Video (valgfritt)</span><input id="rpVideo" type="url" maxlength="500" placeholder="Lenke til YouTube, Streamable e.l." value="${esc(R.video || "")}" /></label>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-act="replyCancel">Avbryt</button><button class="btn primary" type="submit" ${S.busy === "reply" || (R.kind === "appeal" && rq === 0) ? "disabled" : ""}>${R.kind === "appeal" ? "Send anke" : "Send"}</button></div></form>` : "";
    return `<div class="viewhead"><div><p class="small"><button class="linkbtn" data-act="pList">← Alle protester</button></p>
        <h2>Sak #${p.no} · R${p.round} ${esc(raceLabel(L, p.race))}</h2><p class="muted">Sendt inn ${fmtDate(p.created_at, true)}</p></div><div class="tools">${statusBadge(p)}</div></div>
      <div class="detail"><div>
        <div class="panel"><div class="vs">
          <div><div class="lbl">Sendt inn av</div><div class="drvn">${nb ? `<span class="n">#${esc(nb)}</span>` : ""}${esc(by)}</div></div>
          <div class="mid">MOT</div>
          <div><div class="lbl">Protest mot</div><div class="drvn">${na ? `<span class="n">#${esc(na)}</span>` : ""}${esc(ag)}</div></div></div>
          <h3>Hendelse</h3>
          <p class="meta">R${p.round} ${esc(trackOf(L, p.round))} · ${esc(raceLabel(L, p.race))}${p.lap != null ? " · Runde " + p.lap : ""}${p.replay ? " · Replay " + esc(p.replay) : ""}${p.place ? " · " + esc(p.place) : ""}</p>
          ${p.kind ? `<p><span class="badge">${esc(p.kind)}</span></p>` : ""}
          <p class="descr">${esc(p.descr)}</p></div>
        ${safeUrl(p.video) ? `<div class="panel"><h3>Video</h3>${videoBlock(p.video)}</div>` : ""}
        ${decBox}
        ${p.status === "decided" && p.appeal_until ? `<p class="callout">${Date.now() < new Date(p.appeal_until).getTime() ? `Ankefrist: ${fmtDate(p.appeal_until, true)}. En anke koster én protest, og gis tilbake hvis den fører fram.` : `Ankefristen gikk ut ${fmtDate(p.appeal_until, true)}.`}</p>` : ""}
        ${p.status === "decided" && !p.appeal_until && d && d.prev ? `<p class="callout">Anken er behandlet. Avgjørelsen er endelig.</p>` : ""}
        ${(canAppeal || canRespond) && !R ? `<div class="row" style="margin-top:0">${canAppeal ? `<button class="btn" data-act="reply" data-v="appeal">Anke avgjørelsen</button>` : ""}${canRespond ? `<button class="btn" data-act="reply" data-v="response">Legg til svar / bevis</button>` : ""}</div>` : ""}
        ${replyForm}
      </div><div>
        ${stew}
        <div class="panel"><h3>Sakshistorikk</h3><ul class="hist">
          ${evs.map((e) => `<li><div class="when">${fmtDate(e.at)} · ${esc(e.author || "")}</div><b>${esc(kindName[e.kind] || e.kind)}</b>${e.private ? `<span class="priv">Bare stewards</span>` : ""}
            ${e.text ? `<div class="muted evtext">${esc(e.text)}</div>` : ""}${safeUrl(e.video) ? `<div class="small"><a href="${esc(safeUrl(e.video))}" target="_blank" rel="noopener noreferrer nofollow">Video ↗</a></div>` : ""}
            ${e.token ? `<div class="muted small">Protester: ${e.token > 0 ? "+" : ""}${e.token}</div>` : ""}</li>`).join("") || `<li class="muted">Ingen hendelser ennå.</li>`}
        </ul></div>
      </div></div>`;
  }

  /** Effekt av en tenkt avgjørelse: sammenligner løp og standings med og uten straffen. */
  function decisionPreview(L, p, D) {
    const res = S.results["r" + p.round + "-" + p.race]; if (!res) return "";
    const base = pensByRid();
    Object.keys(base).forEach((k) => (base[k] = base[k].filter((x) => x.case !== p.no)));
    const next = JSON.parse(JSON.stringify(base));
    const name = driverName(D.driver, "");
    if (D.outcome === "pen" && D.apply && name && ["pts", "time", "DSQ"].includes(D.penT)) {
      (next[res.id] = next[res.id] || []).push({ key: CORE.norm(name), t: D.penT, v: +D.penV || 0, case: p.no });
    }
    const dm = driverMap();
    const a = CORE.computeRace(res, L, dm, base[res.id]), b = CORE.computeRace(res, L, dm, next[res.id]);
    const sa = CORE.computeStandings(L, S.results, S.drivers, "all", base), sb2 = CORE.computeStandings(L, S.results, S.drivers, "all", next);
    const changed = b.filter((r) => { const o = a.find((x) => x.key === r.key); return o && (o.cpos !== r.cpos || o.pts !== r.pts || o.dq !== r.dq); });
    if (!changed.length) return `<p class="muted small">Ingen endring i resultatet.</p>`;
    const pl = (r) => (r.dq ? "DSQ" : r.cpos + ".");
    return `<table class="eff"><tr><th></th><th>Plass i løpet</th><th>Poeng i løpet</th><th>Standings</th></tr>
      ${changed.slice(0, 8).map((r) => { const o = a.find((x) => x.key === r.key); const s0 = sa.rows.find((x) => x.key === r.key), s1 = sb2.rows.find((x) => x.key === r.key);
        return `<tr><td>${r.key === CORE.norm(name) ? "<b>" + esc(r.name) + "</b>" : esc(r.name)}</td><td>${pl(o)} → <b>${pl(r)}</b></td><td>${fmtPts(o.pts)} → <b>${fmtPts(r.pts)}</b></td>
          <td>${s0 && s1 ? `${fmtPts(s0.total)} → <b>${fmtPts(s1.total)} p</b> (${s0.pos !== s1.pos ? s0.pos + ". → " : ""}${s1.pos}.)` : ""}</td></tr>`; }).join("")}</table>
      ${changed.length > 8 ? `<p class="muted small">… og ${changed.length - 8} til.</p>` : ""}`;
  }

  function viewDecide(L, p) {
    const by = driverName(p.by_driver, p.by_name), ag = driverName(p.against_driver, p.against_name);
    if (!S.dec || S.dec.id !== p.id) {
      const d = p.decision || {};
      S.dec = { id: p.id, outcome: d.outcome || "pen", driver: d.driver || p.against_driver || "", penT: (d.pen && d.pen.t) || "pts", penV: d.pen ? d.pen.v : 5,
        rule: d.rule || "", reason: d.reason || "", apply: d.apply !== false, refund: d.refund != null ? d.refund : true };
    }
    const D = S.dec;
    const radio = (field, v, label) => `<button type="button" class="${D[field] === v ? "on" : ""}" data-act="decSet" data-f="${field}" data-v="${v}">${label}</button>`;
    const inRes = new Set(((S.results["r" + p.round + "-" + p.race] || {}).rows || []).map((r) => CORE.norm(r.name)));
    const drvOpts = S.drivers.filter((d) => inRes.has(CORE.norm(d.name)) || d.id === D.driver).sort((a, b) => a.name.localeCompare(b.name, "nb"))
      .map((d) => `<option value="${esc(d.id)}" ${d.id === D.driver ? "selected" : ""}>${d.num ? "#" + esc(d.num) + " " : ""}${esc(d.name)}</option>`).join("");
    const target = p.status === "appealed" ? driverName(p.appeal_by, "den som anket") : by;
    return `<section class="panel" style="max-width:780px">
      <p class="small"><button class="linkbtn" data-act="openCase" data-no="${p.no}">← Tilbake til sak #${p.no}</button></p>
      <h2>${p.status === "appealed" ? "Behandle anke i" : "Avgjør"} sak #${p.no}</h2>
      <p class="muted">R${p.round} ${esc(raceLabel(L, p.race))}${p.lap != null ? " · Runde " + p.lap : ""} · ${esc(by)} mot ${esc(ag)}${p.kind ? " · " + esc(p.kind) : ""}</p>
      <form data-form="decide">
      <div class="fld"><span>Utfall</span><div class="seg radio">${radio("outcome", "nfa", "Ingen videre handling")}${radio("outcome", "warn", "Advarsel")}${radio("outcome", "pen", "Straff")}${radio("outcome", "rejected", "Avvist (ugyldig protest)")}</div></div>
      ${D.outcome === "pen" || D.outcome === "warn" ? `<label class="fld"><span>Hvem får ${D.outcome === "pen" ? "straffen" : "advarselen"}</span><select data-chg="dec.driver">${drvOpts}</select></label>` : ""}
      ${D.outcome === "pen" ? `<div class="fld"><span>Straff</span><div class="seg radio">${radio("penT", "pts", "Poengtrekk")}${radio("penT", "time", "Tidsstraff")}${radio("penT", "DSQ", "DSQ fra løpet")}</div></div>
        ${D.penT !== "DSQ" ? `<label class="fld inline"><span>${D.penT === "time" ? "Sekunder lagt til løpstiden" : "Poeng som trekkes"}</span><input type="number" min="0" step="1" class="num" value="${esc(D.penV)}" data-chg="dec.penV" /></label>` : ""}` : ""}
      <label class="fld"><span>Regel / kategori (valgfritt)</span><input value="${esc(D.rule)}" data-chg="dec.rule" maxlength="200" /></label>
      <label class="fld"><span>Begrunnelse (vises offentlig)</span><textarea data-chg="dec.reason" maxlength="4000" style="font-family:var(--body);font-size:15px;min-height:80px">${esc(D.reason)}</textarea></label>
      ${D.outcome === "pen" ? `<div class="applybox"><label class="chk"><input type="checkbox" data-chg="dec.apply" ${D.apply ? "checked" : ""} /> Legg straffen inn i resultatet for R${p.round} ${esc(raceLabel(L, p.race))}</label>
        ${D.apply ? `<div class="effect"><div class="lbl">Forhåndsvisning av effekten</div>${decisionPreview(L, p, D)}</div>` : ""}
        <span class="muted small">Resultatlisten og standings oppdateres når avgjørelsen publiseres, og straffen vises med lenke til saken.</span></div>` : ""}
      <label class="chk"><input type="checkbox" data-chg="dec.refund" ${D.refund ? "checked" : ""} /> ${p.status === "appealed" ? "Anken førte fram" : "Protesten førte fram"} – gi protesten tilbake til ${esc(target)}</label>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-act="openCase" data-no="${p.no}">Avbryt</button><button class="btn primary" type="submit" ${S.busy === "decide" ? "disabled" : ""}>Publiser avgjørelse</button></div>
      </form></section>`;
  }

  /* ---------------- import ---------------- */
  function viewImport(L) {
    const I = S.imp;
    const keys = CORE.raceKeys(L);
    if (!I.race || !(L.races || []).find((r) => r.key === I.race)) {
      const free = keys.find((k) => !S.results[k.id]) || keys[0];
      if (free) { I.round = free.round; I.race = free.race; }
    }
    const id = "r" + I.round + "-" + I.race;
    const exists = !!S.results[id];
    const rOpts = (L.rounds || []).map((rd, i) => `<option value="${i + 1}" ${I.round === i + 1 ? "selected" : ""}>Runde ${i + 1}${rd.track ? " · " + esc(rd.track) : ""}</option>`).join("");
    const raOpts = (L.races || []).map((ra) => `<option value="${esc(ra.key)}" ${I.race === ra.key ? "selected" : ""}>${esc(ra.label)}${S.results["r" + I.round + "-" + ra.key] ? " (har resultat)" : ""}</option>`).join("");
    let prev = "";
    if (I.parsed) {
      const dm = driverMap();
      const rows = I.parsed.rows;
      const newOnes = rows.filter((r) => !dm.has(CORE.norm(r.name)));
      const changed = rows.filter((r) => { const d = dm.get(CORE.norm(r.name)); return d && (r.cls === 1 || r.cls === 2) && d.div !== r.cls; });
      const d2 = rows.filter((r) => (r.cls === 1 || r.cls === 2 ? r.cls : (dm.get(CORE.norm(r.name)) || {}).div || 1) === 2).length;
      const dq = rows.filter((r) => r.dq).length;
      const trackNote = !((L.rounds || [])[I.round - 1] || {}).track && I.parsed.track ? `<li>Banen for runde ${I.round} settes til «${esc(I.parsed.track)}».</li>` : "";
      prev = `<section class="panel"><div class="viewhead"><div><h3>${esc(I.file || "Innlimt tekst")}</h3><p class="muted">${esc(I.parsed.format)}${I.parsed.track ? " · " + esc(I.parsed.track) : ""}</p></div></div>
        <ul class="facts"><li><b>${rows.length}</b> førere, <b>${d2}</b> i ${esc((L.d2 && L.d2.name) || "Division 2")}${dq ? `, <b>${dq}</b> diskvalifisert (0 poeng)` : ""}.</li>
        <li>${I.parsed.hasClass ? "Divisjon hentes fra «Car Class ID» i filen (1 = Div 1, 2 = Div 2)." : "Filen har ingen «Car Class ID». Divisjon hentes fra førerlisten, og nye førere legges i Div 1."}</li>
        ${newOnes.length ? `<li><b>${newOnes.length}</b> nye førere legges til i førerlisten.</li>` : ""}
        ${changed.length ? `<li><b>${changed.length}</b> førere får ny divisjon fra filen.</li>` : ""}${trackNote}
        ${exists ? `<li class="warn">Runde ${I.round} ${esc(raceLabel(L, I.race))} har allerede et resultat. Det blir erstattet, og straffer som er satt nullstilles.</li>` : ""}</ul>
        <div class="tablewrap short"><table class="grid res"><thead><tr><th class="pos">Pos</th><th>Fører</th><th class="num">Div</th><th>Bil</th><th class="num">Runder</th><th class="num">Gap</th><th class="num">Beste</th><th>Status</th></tr></thead><tbody>
        ${rows.map((r) => { const d = dm.get(CORE.norm(r.name)); const div = r.cls === 1 || r.cls === 2 ? r.cls : d ? d.div || 1 : 1;
          return `<tr class="${r.dq ? "isdq" : ""}"><td class="pos">${r.pos}</td><td class="name">${esc(r.name)}${d ? "" : ` <span class="tag">ny</span>`}</td><td class="num"><span class="div d${div}">${div}</span></td><td class="car">${esc(r.car)}</td><td class="num">${r.laps}</td><td class="num mono">${esc(r.gap)}</td><td class="num mono">${esc(r.best)}</td><td>${esc(r.out)}</td></tr>`; }).join("")}
        </tbody></table></div>
        <div class="row"><button class="btn primary" data-act="saveImport" ${I.busy ? "disabled" : ""}>${I.busy ? "Lagrer…" : "Lagre som R" + I.round + " " + esc(raceLabel(L, I.race))}</button>
        <button class="btn ghost" data-act="clearImport">Velg en annen fil</button></div></section>`;
    }
    return `<div class="viewhead"><div><h2>Importer løp</h2><p class="muted">CSV fra iRaceControl eller iRacing, eller JSON fra iRacing.</p></div></div>
      <section class="panel"><div class="grid2">
        <label class="fld"><span>Runde</span><select data-chg="impRound">${rOpts}</select></label>
        <label class="fld"><span>Løp</span><select data-chg="impRace">${raOpts}</select></label></div>
        <label class="drop" id="drop" for="file"><input type="file" id="file" accept=".csv,.json,.txt" data-chg="file" />
          <b>Slipp resultatfilen her</b><span class="muted">eller klikk for å velge fil (.csv eller .json)</span></label>
        <button class="linkbtn" data-act="togglePaste">${I.paste ? "Skjul tekstfelt" : "Lim inn tekst i stedet"}</button>
        ${I.paste ? `<textarea id="pasteBox" rows="6" placeholder='"Fin Pos","Car ID","Car Type",…'></textarea><button class="btn sm" data-act="parsePaste">Les inn teksten</button>` : ""}
        ${I.err ? `<p class="error">${esc(I.err)}</p>` : ""}</section>${prev}`;
  }

  function bindDrop() {
    const d = $("#drop"); if (!d) return;
    d.addEventListener("dragover", (e) => { e.preventDefault(); d.classList.add("over"); });
    d.addEventListener("dragleave", () => d.classList.remove("over"));
    d.addEventListener("drop", (e) => { e.preventDefault(); d.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  }
  function readFile(f) {
    const rd = new FileReader();
    rd.onload = () => parseInto(String(rd.result), f.name);
    rd.onerror = () => { S.imp.err = "Kunne ikke lese filen."; render(); };
    rd.readAsText(f, "utf-8");
  }
  function parseInto(text, name) {
    const I = S.imp; I.err = ""; I.parsed = null; I.file = name;
    try {
      I.parsed = CORE.parseFile(name, text);
      const L = league(); const p = I.parsed;
      if (p.track && L) { const i = (L.rounds || []).findIndex((rd) => rd.track && CORE.norm(p.track).startsWith(CORE.norm(rd.track).split(" – ")[0])); if (i >= 0) I.round = i + 1; }
    } catch (e) { I.err = e.message || "Filen kunne ikke leses."; }
    render();
  }

  async function saveImport() {
    const L = league(), I = S.imp; if (!L || !I.parsed) return;
    I.busy = true; render();
    const id = "r" + I.round + "-" + I.race;
    const p = I.parsed, base = "leagues/" + L.id;
    const ok = await write(async () => {
      await S.db.doc(base + "/results/" + id).set({ round: I.round, race: I.race, format: p.format, source: I.file || "Innlimt tekst",
        track: p.track || "", date: p.date || "", importedAt: new Date().toISOString(), half: false, pen: {}, rows: p.rows,
        raceTime: p.raceTime || null, raceTimeSrc: p.raceTimeSrc || "" });
      const dm = driverMap();
      for (const r of p.rows) {
        const d = dm.get(CORE.norm(r.name)); const cls = r.cls === 1 || r.cls === 2 ? r.cls : null;
        if (!d) { const ref = S.db.collection(base + "/drivers").doc(); await ref.set({ name: r.name, num: r.num || "", div: cls || 1, cust: r.cust || null }); dm.set(CORE.norm(r.name), { id: ref.id, name: r.name, div: cls || 1 }); }
        else {
          const upd = {};
          if (cls && d.div !== cls) upd.div = cls;
          if (r.num && !d.num) upd.num = r.num;
          if (r.cust && !d.cust) upd.cust = r.cust;
          if (Object.keys(upd).length) await S.db.doc(base + "/drivers/" + d.id).update(upd);
        }
      }
      if (!((L.rounds || [])[I.round - 1] || {}).track && p.track) {
        const rounds = (L.rounds || []).map((x) => ({ ...x })); rounds[I.round - 1].track = p.track.split(" – ")[0];
        await S.db.doc("leagues/" + L.id).update({ rounds });
      }
    }, "Resultatet er lagret.");
    I.busy = false;
    if (ok) { S.sel = id; S.tab = "results"; I.parsed = null; I.file = ""; I.race = null; }
    render();
  }

  /* ---------------- førere ---------------- */
  function viewDrivers(L) {
    const counts = {};
    Object.values(S.results).forEach((res) => (res.rows || []).forEach((r) => { const k = CORE.norm(r.name); counts[k] = (counts[k] || 0) + 1; }));
    const q = CORE.norm(S.q);
    const list = S.drivers.filter((d) => !q || CORE.norm(d.name).includes(q)).sort((a, b) => (a.div || 1) - (b.div || 1) || a.name.localeCompare(b.name, "nb"));
    const d2n = (L.d2 && L.d2.name) || "Division 2";
    const n2 = S.drivers.filter((d) => d.div === 2).length;
    const rows = list.map((d) => {
      const conf = S.confirm === "delDrv:" + d.id;
      return S.canWrite ? `<tr><td><input class="in num" value="${esc(d.num || "")}" data-chg="drv" data-f="num" data-id="${d.id}" aria-label="Bilnummer" /></td>
        <td><input class="in" value="${esc(d.name)}" data-chg="drv" data-f="name" data-id="${d.id}" aria-label="Navn" /></td>
        <td><select data-chg="drv" data-f="div" data-id="${d.id}" aria-label="Divisjon"><option value="1" ${d.div !== 2 ? "selected" : ""}>Div 1</option><option value="2" ${d.div === 2 ? "selected" : ""}>Div 2</option></select></td>
        <td class="num">${counts[CORE.norm(d.name)] || 0}</td>
        <td class="act">${conf ? `<button class="btn sm danger" data-act="delDrv" data-id="${d.id}">Slett</button><button class="btn sm ghost" data-act="cancelConfirm">Avbryt</button>` : `<button class="btn sm ghost" data-act="askDelDrv" data-id="${d.id}" aria-label="Slett ${esc(d.name)}">Slett</button>`}</td></tr>`
        : `<tr><td class="num">${esc(d.num || "")}</td><td class="name">${esc(d.name)}</td><td><span class="div d${d.div || 1}">${d.div || 1}</span></td><td class="num">${counts[CORE.norm(d.name)] || 0}</td><td></td></tr>`;
    }).join("");
    return `<div class="viewhead"><div><h2>Førere</h2><p class="muted">${S.drivers.length} førere · ${n2} i ${esc(d2n)}. Nye førere legges til automatisk ved import.</p></div>
      <div class="tools"><input type="search" id="q" placeholder="Søk etter fører" value="${esc(S.q)}" data-inp="q" aria-label="Søk" /></div></div>
      ${S.canWrite ? `<form class="addrow" data-form="addDrv"><input id="adNum" placeholder="#" class="num" aria-label="Bilnummer" /><input id="adName" placeholder="Navn, slik det står i iRacing" required aria-label="Navn" />
        <select id="adDiv" aria-label="Divisjon"><option value="1">Div 1</option><option value="2">Div 2</option></select><button class="btn" type="submit">Legg til fører</button></form>` : ""}
      ${S.drivers.length ? `<div class="tablewrap"><table class="grid drv"><thead><tr><th class="num">#</th><th>Navn</th><th>Divisjon</th><th class="num">Løp</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty"><h3>Ingen førere ennå</h3><p class="muted">Importer et løp, så legges førerne inn her automatisk.</p></div>`}`;
  }

  /* ---------------- oppsett ---------------- */
  function viewSetup(L) {
    if (!S.draft || S.draftFor !== L.id) { S.draft = JSON.parse(JSON.stringify({ name: L.name, races: L.races, rounds: L.rounds, scale: L.scale, d2: L.d2 || { enabled: false, name: "Division 2", ownPoints: true }, bestOf: L.bestOf || 0, logo: L.logo || "", protests: CORE.protestDefaults(L.protests) })); S.draftFor = L.id; }
    const D = S.draft;
    const conf = S.confirm === "delLeague";
    if (!S.admins && !S.adminsLoading) { S.adminsLoading = true; DATA.listAdmins().then((a) => { S.admins = a; S.adminsLoading = false; softRender(); }).catch(() => { S.adminsLoading = false; }); }
    if (!S.stewards && !S.stewardsLoading && Array.isArray(S.protests)) { S.stewardsLoading = true; DATA.listStewards().then((a) => { S.stewards = a; S.stewardsLoading = false; softRender(); }).catch(() => { S.stewardsLoading = false; }); }
    const P = D.protests;
    const hours = (field) => `<select data-dr="protests.${field}" data-num="1">${[24, 48, 72, 96, 168].map((h) => `<option value="${h}" ${+P[field] === h ? "selected" : ""}>${h === 168 ? "1 uke" : h + " timer"}</option>`).join("")}</select>`;
    const protestPanels = !Array.isArray(S.protests)
      ? `<section class="panel"><h3>Protester</h3><p class="muted small">Protestsystemet er ikke satt opp i databasen ennå. Kjør <code>supabase/protester.sql</code> i Supabase (SQL Editor → New query → lim inn → Run), og last siden på nytt.</p></section>`
      : `<section class="panel"><h3>Protester</h3>
        <label class="chk"><input type="checkbox" ${P.enabled ? "checked" : ""} data-dr="protests.enabled" /> Ta imot protester i denne ligaen</label>
        <div class="grid2">
          <label class="fld"><span>Protestfrist etter løpsdagen</span>${hours("deadlineH")}</label>
          <label class="fld"><span>Ankefrist etter avgjørelse</span>${hours("appealH")}</label>
          <label class="fld"><span>Protester per fører per runde</span><input type="number" min="1" max="20" class="num" value="${+P.perRound || 2}" data-dr="protests.perRound" /></label>
          <label class="fld"><span>Video</span><select data-dr="protests.video"><option value="req" ${P.video === "req" ? "selected" : ""}>Påkrevd</option><option value="opt" ${P.video !== "req" ? "selected" : ""}>Valgfri</option></select></label>
        </div>
        <p class="muted small">Fristen regnes fra midnatt etter datoen som står på runden under Runder. Runder uten dato har ingen frist.</p>
        <label class="fld"><span>Hendelsestyper (én per linje)</span><textarea rows="7" data-dr="protests.kindsText">${esc(P.kinds.join("\n"))}</textarea></label></section>
      <section class="panel"><h3>Stewards</h3><p class="muted small">Stewards kan behandle og avgjøre protester, men ikke endre oppsett eller importere resultater. Arrangører kan også avgjøre protester.</p>
        ${S.stewards ? (S.stewards.length ? `<ul class="admins">${S.stewards.map((a) => `<li><span>${esc(a.email)}</span><span class="acts"><button class="btn sm ghost" data-act="pwFor" data-email="${esc(a.email)}" title="Send lenke eller sett passord">Passord</button><button class="btn sm ghost" data-act="rmSteward" data-email="${esc(a.email)}">Fjern</button></span></li>`).join("")}</ul>` : `<p class="small muted">Ingen stewards ennå.</p>`) : `<p class="muted small">Henter…</p>`}
        <form data-form="addSteward" class="addrow"><input id="stewardEmail" type="email" placeholder="e-post til ny steward" required aria-label="E-post" /><button class="btn" type="submit">Legg til</button></form>
        <p class="muted small">Stewarden logger inn med samme e-postadresse. Førere sender inn protester uten å logge inn.</p></section>`;
    return `<div class="viewhead"><div><h2>Oppsett</h2><p class="muted">Endringer gjelder alle i arrangørgruppa når du trykker Lagre.</p></div>
      <div class="tools"><button class="btn primary" data-act="saveSetup">Lagre oppsett</button></div></div>
      <div class="setup">
      <section class="panel"><h3>Serien</h3>
        <label class="fld"><span>Navn (brukes i overskriftene på PDF og bilder)</span><input value="${esc(D.name)}" data-dr="name" maxlength="80" /></label>
        <div class="logo"><img src="${esc(D.logo || CSL_LOGO)}" alt="Logo" /><div class="stack">
          <label class="btn sm" for="logoFile">Bytt logo</label><input type="file" id="logoFile" accept="image/*" hidden data-chg="logo" />
          ${D.logo ? `<button class="linkbtn" data-act="logoReset">Bruk CSL-logoen</button>` : `<span class="muted small">CSL-logoen brukes</span>`}</div></div>
      </section>
      <section class="panel"><h3>Løp per runde</h3><p class="muted small">Kort navn vises i kolonnene i standings.</p>
        ${D.races.map((r, i) => `<div class="racerow"><input value="${esc(r.label)}" data-dr="races.${i}.label" aria-label="Navn" placeholder="Feature" /><input value="${esc(r.short || "")}" data-dr="races.${i}.short" aria-label="Kort navn" placeholder="Feat" class="short" />
          ${D.races.length > 1 ? `<button class="btn sm ghost" data-act="rmRace" data-i="${i}" aria-label="Fjern">Fjern</button>` : ""}</div>`).join("")}
        <button class="btn sm" data-act="addRace">+ Legg til løp</button></section>
      <section class="panel"><h3>Runder</h3>
        <label class="fld inline"><span>Antall runder</span><input type="number" min="1" max="30" value="${D.rounds.length}" data-chg="nRounds" class="num" /></label>
        <div class="rounds">${D.rounds.map((rd, i) => `<div class="roundrow"><span class="rn">R${i + 1}</span><input value="${esc(rd.track || "")}" placeholder="Bane" data-dr="rounds.${i}.track" aria-label="Bane runde ${i + 1}" /><input type="date" value="${esc(rd.date || "")}" data-dr="rounds.${i}.date" aria-label="Dato runde ${i + 1}" /></div>`).join("")}</div></section>
      <section class="panel"><h3>Poeng</h3>
        <label class="fld"><span>Poengskala fra 1. plass og nedover, skilt med komma</span><textarea rows="4" data-dr="scaleText">${esc(D.scale.join(", "))}</textarea></label>
        <label class="fld inline"><span>Tellende løp (0 = alle teller)</span><input type="number" min="0" value="${+D.bestOf || 0}" data-dr="bestOf" class="num" /></label></section>
      <section class="panel"><h3>Divisjoner</h3>
        <label class="chk"><input type="checkbox" ${D.d2.enabled ? "checked" : ""} data-dr="d2.enabled" /> Egen tabell for Division 2</label>
        <label class="fld"><span>Navn på divisjonen</span><input value="${esc(D.d2.name || "Division 2")}" data-dr="d2.name" /></label>
        <label class="chk"><input type="checkbox" ${D.d2.ownPoints !== false ? "checked" : ""} data-dr="d2.ownPoints" /> Egen poengfordeling: beste Div 2-fører får ${+D.scale[0] || 60} poeng</label>
        <p class="muted small">Divisjon hentes fra «Car Class ID» i resultatfilen når den finnes (1 = Div 1, 2 = Div 2). Ellers brukes divisjonen i førerlisten.</p></section>
      <section class="panel"><h3>Arrangører</h3><p class="muted small">Disse kan logge inn og importere, redigere og slette i alle ligaer.</p>
        ${S.admins ? `<ul class="admins">${S.admins.map((a) => { const me = S.session && a.email === (S.session.user.email || "").toLowerCase();
          return `<li><span>${esc(a.email)}${me ? ` <span class="tag">deg</span>` : ""}</span>${me ? "" : `<span class="acts"><button class="btn sm ghost" data-act="pwFor" data-email="${esc(a.email)}" title="Send lenke eller sett passord">Passord</button><button class="btn sm ghost" data-act="rmAdmin" data-email="${esc(a.email)}">Fjern</button></span>`}</li>`; }).join("")}</ul>`
          : `<p class="muted small">Henter…</p>`}
        <form data-form="addAdmin" class="addrow"><input id="adminEmail" type="email" placeholder="e-post til ny arrangør" required aria-label="E-post" /><button class="btn" type="submit">Legg til</button></form>
        <p class="muted small">Den nye arrangøren logger inn med samme e-postadresse.</p></section>
      <section class="panel" id="pwPanel"><h3>Passord for brukere</h3>
        <p class="muted small">Hjelp en arrangør eller steward som har glemt passordet. Send en lenke på e-post, eller sett et midlertidig passord og gi det til personen. Finnes ingen konto med e-posten, opprettes den.</p>
        <form data-form="adminPw" class="stack">
          <label class="fld"><span>E-post</span><input id="apEmail" type="email" required autocomplete="off" value="${esc(S.pwEmail || "")}" /></label>
          <label class="fld"><span>Midlertidig passord (minst 8 tegn)</span><span class="pwrow"><input id="apPw" type="text" minlength="8" autocomplete="new-password" spellcheck="false" /><button class="btn sm ghost" type="button" data-act="genPw">Lag forslag</button></span></label>
          <div class="row"><button class="btn" type="submit" data-v="link">Send lenke for nytt passord</button><button class="btn primary" type="submit" data-v="set">Sett passordet</button></div>
        </form>
        <p class="muted small">Supabase sender bare noen få e-poster i timen med den innebygde e-posttjenesten. Med midlertidig passord kan personen logge inn med en gang, og bytte passord ved å trykke på e-postadressen sin øverst.</p></section>
      ${protestPanels}
      <section class="panel danger"><h3>Slett liga</h3><p class="muted small">Sletter oppsett, førere og alle resultater for «${esc(L.name)}» for alle i gruppa.</p>
        ${conf ? `<span class="confirm">Er du sikker? <button class="btn sm danger" data-act="delLeague">Slett ligaen</button><button class="btn sm ghost" data-act="cancelConfirm">Avbryt</button></span>` : `<button class="btn sm ghost" data-act="askDelLeague">Slett liga</button>`}</section>
      </div>`;
  }
  function setDraft(path, val) {
    const D = S.draft; if (!D) return;
    if (path === "scaleText") { D.scale = String(val).split(/[,;\s]+/).map((x) => parseFloat(x.replace(",", "."))).filter((x) => isFinite(x)); return; }
    if (path === "protests.kindsText") { D.protests.kinds = String(val).split("\n").map((x) => x.trim()).filter(Boolean); return; }
    if (/^protests\.(deadlineH|appealH|perRound)$/.test(path)) val = Math.max(1, parseInt(val, 10) || 1);
    const p = path.split("."); let o = D;
    for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = val;
  }

  /* ---------------- eksport ---------------- */
  async function doExport(kind, fmt) {
    const L = league(); if (!L || !S.dl) return;
    S.busy = fmt; render();
    try {
      const d2on = L.d2 && L.d2.enabled;
      const slug = (s) => String(s).normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
      let models = [], name = slug(L.name);
      const toModel = (m) => ({ title: m.title, sheet: m.sheet, columns: m.columns, groups: m.groups, rows: m.rows2 || m.rows, styles: m.styles, note: m.note });
      if (kind === "st") { models = [toModel(standingsModel(L, d2on ? S.stMode : "all"))]; name += "_Standings" + (S.stMode === "d2" && d2on ? "_Div2" : ""); if (fmt === "xlsx" && d2on) models = [toModel(standingsModel(L, "all")), toModel(standingsModel(L, "d2"))]; }
      else if (kind === "race") {
        const res = S.results[S.sel]; if (!res) return;
        const mode = d2on ? S.resMode : "all";
        models = fmt === "png" ? [toModel(raceModel(L, res, mode))] : [toModel(raceModel(L, res, "all"))].concat(d2on ? [toModel(raceModel(L, res, "d2"))] : []);
        name += `_R${res.round}_${slug(raceLabel(L, res.race))}${fmt === "png" && mode === "d2" ? "_Div2" : ""}`;
      } else if (kind === "season") {
        models = [toModel(standingsModel(L, "all"))].concat(d2on ? [toModel(standingsModel(L, "d2"))] : []);
        CORE.raceKeys(L).forEach((k) => { const res = S.results[k.id]; if (res) { models.push(toModel(raceModel(L, res, "all"))); if (d2on) models.push(toModel(raceModel(L, res, "d2"))); } });
        name += "_Sesong";
      }
      let data, ext = fmt;
      if (fmt === "png") data = await EXPORT.png(models[0], logoOf(L));
      else if (fmt === "pdf") data = await EXPORT.pdf(models, logoOf(L));
      else if (fmt === "xlsx") data = await EXPORT.xlsx(models);
      else if (fmt === "csv") data = EXPORT.csv(models[0]);
      await S.dl.save({ filename: name + "." + ext, data });
      toast("Filen er lastet ned.");
    } catch (e) {
      if (e && e.code === "declined") {} else if (e && e.code === "rate_limited") toast("En nedlasting venter allerede på svar.", "err");
      else toast((e && e.message) || "Eksporten feilet.", "err");
    } finally { S.busy = ""; render(); }
  }

  /* ---------------- hendelser ---------------- */
  const ACT = {
    home: () => { S.login = false; S.newLeague = false; S.confirm = null; S.tab = "standings"; render(); window.scrollTo(0, 0); },
    login: () => { S.login = true; S.loginMode = "in"; S.loginSent = ""; render(); },
    closeLogin: () => { S.login = false; S.changePw = false; render(); },
    changePw: () => { S.login = true; S.loginMode = "newpw"; S.changePw = true; render(); },
    loginMode: (b) => { const e = $("#loginEmail"); if (e) S.loginEmail = e.value.trim(); S.loginMode = b.dataset.v; render(); },
    logout: async () => { await S.sb.auth.signOut(); S.session = null; S.canWrite = false; if (["import", "setup"].includes(S.tab)) S.tab = "standings"; render(); },
    rmAdmin: async (b) => { const ok = await write(() => DATA.removeAdmin(b.dataset.email), "Arrangøren er fjernet."); if (ok) { S.admins = null; render(); } },
    tab: (b) => { S.tab = b.dataset.v; S.confirm = null; render(); window.scrollTo(0, 0); },
    stMode: (b) => { S.stMode = b.dataset.v; render(); },
    resMode: (b) => { S.resMode = b.dataset.v; render(); },
    sel: (b) => { S.sel = b.dataset.v; S.confirm = null; render(); },
    newLeague: () => { S.newLeague = true; render(); },
    cancelNew: () => { S.newLeague = false; render(); },
    importFor: (b) => { S.imp.round = +b.dataset.round; S.imp.race = b.dataset.race; S.tab = "import"; render(); },
    togglePaste: () => { S.imp.paste = !S.imp.paste; render(); },
    parsePaste: () => { const t = $("#pasteBox"); if (t && t.value.trim()) parseInto(t.value, ""); },
    clearImport: () => { S.imp.parsed = null; S.imp.file = ""; S.imp.err = ""; render(); },
    saveImport: () => saveImport(),
    export: (b) => doExport(b.dataset.kind, b.dataset.fmt),
    cancelConfirm: () => { S.confirm = null; render(); },
    askDelRes: () => { S.confirm = "delRes:" + S.sel; render(); },
    delRes: async () => { const L = league(); S.confirm = null; await write(() => S.db.doc("leagues/" + L.id + "/results/" + S.sel).delete(), "Resultatet er slettet."); render(); },
    askDelDrv: (b) => { S.confirm = "delDrv:" + b.dataset.id; render(); },
    delDrv: async (b) => { const L = league(); S.confirm = null; await write(() => S.db.doc("leagues/" + L.id + "/drivers/" + b.dataset.id).delete(), "Føreren er slettet."); },
    askDelLeague: () => { S.confirm = "delLeague"; render(); },
    delLeague: async () => {
      const L = league(); S.confirm = null;
      await write(async () => {
        await S.db.doc("leagues/" + L.id).delete();
      }, "Ligaen er slettet.");
      S.lid = null; S.tab = "standings";
    },
    openCase: (b) => {
      const p = findCase(b.dataset.no); if (!p) return toast("Fant ikke sak #" + b.dataset.no + ".", "err");
      S.tab = "protests"; S.pv.mode = "case"; S.pv.id = p.id; S.reply = null; S.dec = null; render(); window.scrollTo(0, 0);
    },
    askDelCase: () => { S.confirm = "delCase:" + S.pv.id; render(); },
    delCase: async () => {
      const L = league(), id = S.pv.id; S.confirm = null;
      const ok = await write(() => DATA.deleteProtest(id), "Saken er slettet.");
      if (ok) { await loadProtestData(L.id); S.pv.mode = "list"; S.pv.id = null; } render();
    },
    pList: () => { S.pv.mode = "list"; S.pv.id = null; S.reply = null; render(); window.scrollTo(0, 0); },
    newProtest: () => { S.pv.mode = "new"; S.pf = null; render(); window.scrollTo(0, 0); },
    pFilterDrv: (b) => { S.tab = "protests"; S.pv = { mode: "list", id: null, f: { rid: "", no: "", drv: b.dataset.name, st: "" } }; render(); window.scrollTo(0, 0); },
    reply: (b) => { S.reply = { id: S.pv.id, kind: b.dataset.v }; render(); const t = $("#rpText"); if (t) t.focus(); },
    replyCancel: () => { S.reply = null; render(); },
    pDecide: () => { S.pv.mode = "decide"; S.dec = null; render(); window.scrollTo(0, 0); },
    decSet: (b) => {
      const D = S.dec; if (!D) return;
      D[b.dataset.f] = b.dataset.v;
      if (b.dataset.f === "outcome") D.refund = ["pen", "warn"].includes(b.dataset.v);
      render();
    },
    pStatus: async (b) => {
      const L = league(), p = (S.protests || []).find((x) => x.id === S.pv.id); if (!p) return;
      const v = b.dataset.v, status = v === "reopened" ? "review" : v;
      await write(async () => {
        await DATA.updateProtest(p.id, { status });
        await DATA.addEvents([{ protest_id: p.id, league_id: L.id, kind: v, author: "Stewards", round: p.round }]);
      }, { review: "Saken er merket som under behandling.", closed: "Saken er lukket.", reopened: "Saken er gjenåpnet." }[v]);
      await loadProtestData(L.id); render();
    },
    pwFor: (b) => {
      S.pwEmail = b.dataset.email;
      if (S.tab !== "setup") { S.tab = "setup"; render(); }
      const e = $("#apEmail"); if (e) { e.value = b.dataset.email; $("#pwPanel").scrollIntoView({ behavior: "smooth", block: "center" }); const p = $("#apPw"); if (p) p.focus(); }
    },
    genPw: () => {
      const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = new Uint32Array(12); crypto.getRandomValues(a);
      const p = $("#apPw"); if (p) p.value = [...a].map((x) => abc[x % abc.length]).join("");
    },
    rmSteward: async (b) => { const ok = await write(() => DATA.removeSteward(b.dataset.email), "Stewarden er fjernet."); if (ok) { S.stewards = null; render(); } },
    addRace: () => { const D = S.draft; let k = "R" + (D.races.length + 1); while (D.races.find((r) => r.key === k)) k += "x"; D.races.push({ key: k, label: "Race " + (D.races.length + 1), short: "R" + (D.races.length + 1) }); render(); },
    rmRace: (b) => { S.draft.races.splice(+b.dataset.i, 1); render(); },
    logoReset: () => { S.draft.logo = ""; render(); },
    saveSetup: async () => {
      const L = league(), D = S.draft;
      if (!D.name.trim()) return toast("Serien må ha et navn.", "err");
      if (!D.scale.length) return toast("Poengskalaen er tom. Skriv inn poeng skilt med komma.", "err");
      const lost = Object.values(S.results).filter((r) => r.round > D.rounds.length || !D.races.find((x) => x.key === r.race)).length;
      const patch = { name: D.name.trim(), races: D.races, rounds: D.rounds, scale: D.scale, d2: D.d2, bestOf: +D.bestOf || 0, logo: D.logo || "" };
      if (D.protests) { if (!D.protests.kinds.length) D.protests.kinds = ["Annet"]; patch.protests = D.protests; }
      const ok = await write(() => S.db.doc("leagues/" + L.id).update(patch), "Oppsettet er lagret.");
      if (ok) { S.draft = null; if (lost) toast(`Lagret. ${lost} resultat(er) hører til runder eller løp som er fjernet og vises ikke lenger.`); render(); }
    },
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
    const f = ACT[b.dataset.act]; if (f) { e.preventDefault(); f(b, e); }
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault();
    const authErr = (error) => {
      const m = (error && error.message) || "";
      if (/invalid login credentials/i.test(m)) return "Feil e-post eller passord.";
      if (/email not confirmed/i.test(m)) return "E-postadressen er ikke bekreftet. Slå av «Confirm email» i Supabase, eller trykk på lenken i e-posten.";
      if (/already registered|already exists/i.test(m)) return "Kontoen finnes allerede. Logg inn, eller bruk «Glemt passord?».";
      if (/rate|too many/i.test(m)) return "For mange forsøk. Vent litt og prøv igjen.";
      if (/password/i.test(m)) return "Passordet er for svakt. Bruk minst 8 tegn.";
      return m || "Noe gikk galt. Prøv igjen.";
    };
    const pwPair = () => { const a = $("#pw1").value, b = $("#pw2").value; if (a !== b) { toast("Passordene er ikke like.", "err"); return null; } return a; };
    if (f.dataset.form === "login") {
      const email = $("#loginEmail").value.trim(), password = $("#loginPw").value; S.loginEmail = email;
      S.busy = "login"; render();
      const { error } = await S.sb.auth.signInWithPassword({ email, password });
      S.busy = "";
      if (error) { toast(authErr(error), "err"); render(); const p = $("#loginPw"); if (p) p.focus(); return; }
      S.login = false; render(); return;
    }
    if (f.dataset.form === "signup") {
      const email = $("#loginEmail").value.trim(), password = pwPair(); S.loginEmail = email; if (!password) return;
      S.busy = "login"; render();
      const { data, error } = await S.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      S.busy = "";
      if (error) { toast(authErr(error), "err"); render(); return; }
      if (!data.session) { S.loginSent = email; S.loginMode = "sent"; toast("Kontoen er opprettet. Bekreft e-postadressen via lenken i e-posten."); render(); return; }
      S.login = false; toast("Kontoen er opprettet, og du er logget inn."); render(); return;
    }
    if (f.dataset.form === "forgot") {
      const email = $("#loginEmail").value.trim(); S.loginEmail = email;
      S.busy = "login"; render();
      const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      S.busy = "";
      if (error) { toast(authErr(error), "err"); render(); return; }
      S.loginSent = email; S.loginMode = "sent"; render(); return;
    }
    if (f.dataset.form === "newpw") {
      const password = pwPair(); if (!password) return;
      S.busy = "login"; render();
      const { error } = await S.sb.auth.updateUser({ password });
      S.busy = "";
      if (error) { toast(authErr(error), "err"); render(); return; }
      S.login = false; S.loginMode = "in"; S.changePw = false; toast("Passordet er lagret."); checkAdmin(); return;
    }
    if (f.dataset.form === "protest") {
      const L = league(), F = S.pf; if (!L || !F) return;
      const val = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
      if (val("pfWebsite")) return; // skjult felt som bare roboter fyller ut
      Object.assign(F, { rid: val("pfRid"), by: val("pfBy"), byNum: val("pfByNum"), against: val("pfAgainst"), againstNum: val("pfAgainstNum"), kind: val("pfKind"),
        lap: val("pfLap"), replay: val("pfReplay"), descr: val("pfDescr"), video: val("pfVideo") });
      const k = CORE.raceKeys(L).find((x) => x.id === F.rid);
      if (!k) return toast("Velg løpet.", "err");
      if (!F.by) return toast("Velg deg selv under «Din fører».", "err");
      if (!F.against) return toast("Velg føreren du protesterer mot.", "err");
      if (F.video && !safeUrl(F.video)) return toast("Videolenken må begynne med https://", "err");
      S.busy = "protest"; render();
      let no = null;
      const ok = await write(async () => { no = await DATA.fileProtest(L.id, { round: k.round, race: k.race, by: F.by, byNum: F.byNum, against: F.against, againstNum: F.againstNum,
        kind: F.kind, lap: F.lap === "" ? null : +F.lap, replay: F.replay, descr: F.descr, video: F.video }); }, null);
      S.busy = "";
      if (ok) {
        toast("Protesten er sendt inn som sak #" + no + ".");
        S.pf = null; await loadProtestData(L.id);
        const p = findCase(no); S.pv.mode = p ? "case" : "list"; S.pv.id = p ? p.id : null; window.scrollTo(0, 0);
      }
      render(); return;
    }
    if (f.dataset.form === "reply") {
      const L = league(), R = S.reply; if (!R) return;
      const text = $("#rpText").value.trim(), video = $("#rpVideo").value.trim(), drv = $("#rpDriver").value;
      if (!drv) return toast("Velg hvem du er.", "err");
      if (!text) return toast("Skriv en tekst.", "err");
      if (video && !safeUrl(video)) return toast("Videolenken må begynne med https://", "err");
      S.busy = "reply"; render();
      const ok = await write(() => DATA.protestReply(R.id, drv, R.kind, text, video), R.kind === "appeal" ? "Anken er sendt inn." : "Svaret er sendt til stewards.");
      S.busy = "";
      if (ok) { S.reply = null; S.quota = {}; await loadProtestData(L.id); }
      render(); return;
    }
    if (f.dataset.form === "decide") {
      const L = league(), D = S.dec, p = (S.protests || []).find((x) => x.id === (D && D.id)); if (!p || !D) return;
      const cfg = protestCfg(L);
      const who = D.outcome === "pen" || D.outcome === "warn";
      if (who && !D.driver) return toast("Velg hvem avgjørelsen gjelder.", "err");
      const appealed = p.status === "appealed";
      const decision = {
        outcome: D.outcome, driver: who ? D.driver : null, driverName: who ? driverName(D.driver, "") : "",
        pen: D.outcome === "pen" ? { t: D.penT, v: D.penT === "DSQ" ? 0 : Math.max(0, +D.penV || 0) } : null,
        apply: D.outcome === "pen" && !!D.apply, rule: (D.rule || "").trim(), reason: (D.reason || "").trim(), refund: !!D.refund,
        at: new Date().toISOString(), prev: appealed ? p.decision : null,
      };
      const evs = [{ protest_id: p.id, league_id: L.id, kind: "decision", author: "Stewards", round: p.round,
        text: outcomeText(decision) + (who ? " · " + decision.driverName : "") + (decision.reason ? "\n" + decision.reason : "") }];
      if (decision.refund) {
        const target = appealed ? p.appeal_by : p.by_driver;
        const mine = S.pevents.filter((e) => e.protest_id === p.id && e.by_driver === target);
        const lastFiling = mine.filter((e) => e.kind === (appealed ? "appeal" : "submitted")).pop();
        const already = lastFiling && mine.some((e) => e.kind === "refund" && e.id > lastFiling.id);
        if (target && lastFiling && !already) evs.push({ protest_id: p.id, league_id: L.id, kind: "refund", author: "Stewards", by_driver: target, round: p.round, token: 1, text: driverName(target, "") });
      }
      S.busy = "decide"; render();
      const ok = await write(async () => {
        await DATA.addEvents(evs);
        await DATA.updateProtest(p.id, { status: "decided", decision, appeal_until: appealed ? null : new Date(Date.now() + (+cfg.appealH || 0) * 3600000).toISOString() });
      }, "Avgjørelsen er publisert.");
      S.busy = "";
      if (ok) { S.dec = null; await loadProtestData(L.id); S.pv.mode = "case"; window.scrollTo(0, 0); }
      render(); return;
    }
    if (f.dataset.form === "adminPw") {
      const email = $("#apEmail").value.trim(), pw = $("#apPw").value, how = (e.submitter && e.submitter.dataset.v) || "set";
      S.pwEmail = email; if (!email) return;
      if (how === "link") {
        await write(() => DATA.sendReset(email, location.origin + location.pathname), "Lenken er sendt til " + email + ", hvis kontoen finnes.");
        return;
      }
      if (pw.length < 8) { toast("Passordet må ha minst 8 tegn. Trykk «Lag forslag» for et tilfeldig passord.", "err"); return; }
      const cfg = window.CSL_CONFIG || {};
      let res = "";
      const ok = await write(async () => { res = await DATA.setPassword(email, pw, cfg.supabaseUrl, cfg.supabaseAnonKey); }, null);
      if (ok) { toast(res === "created" ? "Kontoen er opprettet med passordet. Gi det til personen." : "Passordet er satt. Gi det til personen."); $("#apPw").value = ""; }
      return;
    }
    if (f.dataset.form === "addSteward") {
      const email = $("#stewardEmail").value.trim(); if (!email) return;
      const ok = await write(() => DATA.addSteward(email), "Stewarden er lagt til.");
      if (ok) { S.stewards = null; render(); }
      return;
    }
    if (f.dataset.form === "addAdmin") {
      const email = $("#adminEmail").value.trim(); if (!email) return;
      const ok = await write(() => DATA.addAdmin(email), "Arrangøren er lagt til.");
      if (ok) { S.admins = null; render(); }
      return;
    }
    if (f.dataset.form === "newLeague") {
      const name = $("#nlName").value.trim(); if (!name) return;
      const L = league(); const copy = $("#nlCopy") && $("#nlCopy").checked && L;
      const base = copy ? { races: L.races, rounds: (L.rounds || []).map(() => ({ track: "", date: "" })), scale: L.scale, d2: L.d2, bestOf: L.bestOf || 0, logo: L.logo || "" } : CORE.cslTemplate();
      const ref = S.db.collection("leagues").doc();
      const ok = await write(() => ref.set({ ...base, name }), "Ligaen er opprettet.");
      if (ok) { S.leagues = await DATA.loadLeagues(); S.newLeague = false; S.tab = "setup"; selectLeague(ref.id); }
    }
    if (f.dataset.form === "addDrv") {
      const name = $("#adName").value.trim(); if (!name) return;
      if (driverMap().has(CORE.norm(name))) return toast("Føreren finnes allerede.", "err");
      const L = league();
      const ok = await write(() => S.db.collection("leagues/" + L.id + "/drivers").doc().set({ name, num: $("#adNum").value.trim(), div: +$("#adDiv").value, cust: null }), "Føreren er lagt til.");
      if (ok) { $("#adName").value = ""; $("#adNum").value = ""; }
    }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.inp === "q") { S.q = t.value; const pos = t.selectionStart; render(); const n = $("#q"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
    if (t.dataset.dr && t.type !== "checkbox") setDraft(t.dataset.dr, t.type === "number" ? +t.value : t.value);
  });
  document.addEventListener("change", async (e) => {
    const t = e.target, c = t.dataset.chg, L = league();
    if (t.dataset.dr && t.type === "checkbox") { setDraft(t.dataset.dr, t.checked); render(); return; }
    if (!c) return;
    if (c === "league") { selectLeague(t.value); return; }
    if (c.startsWith("pf.")) { S.pv.f[c.slice(3)] = t.value; render(); return; }
    if (c === "pform.league") {
      const keep = { ...(S.pf || {}), chosen: true, rid: "", by: "", byNum: "", against: "", againstNum: "", kind: "" };
      if (t.value !== S.lid) await selectLeague(t.value);
      S.tab = "protests"; S.pv.mode = "new"; S.pf = keep; render(); return;
    }
    if (c.startsWith("pform.") && S.pf) {
      const k = c.slice(6); S.pf[k] = t.value;
      if (k === "by" || k === "against") { const d = raceDrivers(S.pf.rid).find((x) => x.id === t.value); S.pf[k + "Num"] = d ? d.num : ""; }
      if (["rid", "by", "against"].includes(k)) render();
      return;
    }
    if (c === "reply.driver" && S.reply) { S.reply.driver = t.value; S.reply.text = $("#rpText").value; S.reply.video = $("#rpVideo").value; render(); return; }
    if (c.startsWith("dec.") && S.dec) {
      const k = c.slice(4); S.dec[k] = t.type === "checkbox" ? t.checked : t.value;
      if (["driver", "penV", "apply"].includes(k)) render();
      return;
    }
    if (c === "impRound") { S.imp.round = +t.value; render(); }
    if (c === "impRace") { S.imp.race = t.value; render(); }
    if (c === "file" && t.files[0]) readFile(t.files[0]);
    if (c === "raceTime") {
      const v = t.value.trim(); const sec = v ? CORE.secs(v) : null;
      if (v && !(sec > 0)) { toast("Skriv tiden som mm:ss.000, for eksempel 20:20.571.", "err"); return; }
      await write(() => S.db.doc("leagues/" + L.id + "/results/" + S.sel).update({ raceTime: sec, raceTimeSrc: sec ? "manuell" : "" }), sec ? "Løpstiden er lagret." : "Løpstiden er fjernet.");
    }
    if (c === "half") await write(() => S.db.doc("leagues/" + L.id + "/results/" + S.sel).update({ half: t.checked }));
    if (c === "penT" || c === "penV") {
      const key = t.dataset.key, res = S.results[S.sel]; const cur = (res.pen || {})[key];
      let val;
      if (c === "penT") val = t.value ? { t: t.value, v: t.value === "pts" ? (cur && cur.v) || 5 : 0 } : null;
      else val = { t: "pts", v: Math.max(0, parseFloat(t.value) || 0) };
      await write(() => S.db.doc("leagues/" + L.id + "/results/" + S.sel).update({ pen: { [key]: val } }));
    }
    if (c === "drv") {
      const f = t.dataset.f; let v = t.value.trim();
      if (f === "div") v = +v;
      if (f === "name" && !v) { render(); return; }
      await write(() => S.db.doc("leagues/" + L.id + "/drivers/" + t.dataset.id).update({ [f]: v }));
    }
    if (c === "nRounds") {
      const n = Math.max(1, Math.min(30, parseInt(t.value, 10) || 1)); const D = S.draft;
      while (D.rounds.length < n) D.rounds.push({ track: "", date: "" });
      D.rounds.length = n; render();
    }
    if (c === "logo" && t.files[0]) {
      const img = new Image(); const url = URL.createObjectURL(t.files[0]);
      img.onload = () => {
        const max = 220, k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        S.draft.logo = cv.toDataURL("image/png"); URL.revokeObjectURL(url); render();
      };
      img.onerror = () => toast("Bildet kunne ikke leses.", "err");
      img.src = url;
    }
  });

  init();
})();
