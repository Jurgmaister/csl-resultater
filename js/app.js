/* CSL Resultater – brukergrensesnitt */
(() => {
  const S = {
    db: null, sb: null, session: null, dl: null, canWrite: false, login: false, loginMode: "in", loginSent: "", loginEmail: "", admins: null, ready: false, slow: false, offline: false,
    leagues: [], lid: null, drivers: [], results: {}, unsubs: [],
    tab: "standings", stMode: "all", resMode: "all", sel: null,
    imp: { round: 1, race: null, parsed: null, file: "", err: "", paste: false, busy: false },
    draft: null, draftFor: null, confirm: null, newLeague: false, q: "", pending: false, busy: "",
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
      } catch (e) {}
    }, 250);
  }

  async function checkAdmin() {
    S.canWrite = S.session ? await DATA.isAdmin() : false;
    S.admins = null;
    if (!S.canWrite && ["import", "setup"].includes(S.tab)) S.tab = "standings";
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
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    S.sb = sb;
    DATA.init(sb, { onWrite: scheduleReload, cache: { leagues: () => S.leagues, results: () => S.results } });
    S.db = DATA.db;
    try {
      const { data } = await sb.auth.getSession(); S.session = data.session;
      if (S.session) S.canWrite = await DATA.isAdmin();
      S.leagues = await DATA.loadLeagues();
    } catch (e) { clearTimeout(slowT); S.ready = true; S.err = "Ligadataene kan ikke leses akkurat nå (" + (e.message || e.code) + ")."; render(); return; }
    clearTimeout(slowT); S.slow = false; S.ready = true;
    sb.auth.onAuthStateChange((ev, session) => {
      const was = S.session && S.session.user.id, now = session && session.user.id;
      S.session = session;
      if (ev === "PASSWORD_RECOVERY") { S.login = true; S.loginMode = "newpw"; render(); return; }
      if (was !== now) { S.login = false; S.loginSent = ""; checkAdmin(); }
    });
    sb.channel("csl-endringer")
      .on("postgres_changes", { event: "*", schema: "public", table: "leagues" }, () => scheduleReload("leagues"))
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => scheduleReload("drivers"))
      .on("postgres_changes", { event: "*", schema: "public", table: "results" }, () => scheduleReload("results"))
      .subscribe();
    pickLeague();
  }

  async function selectLeague(id) {
    S.lid = id; S.drivers = []; S.results = {}; S.sel = null; S.draft = null; S.imp.parsed = null; S.confirm = null;
    if (id) store.set("csl.lid", id);
    render();
    if (id) {
      try {
        const [d, r] = await Promise.all([DATA.loadDrivers(id), DATA.loadResults(id)]);
        if (S.lid !== id) return;
        S.drivers = d; S.results = r; render();
      } catch (e) { toast("Kunne ikke hente ligaen: " + (e.message || ""), "err"); }
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
    const fn = { standings: viewStandings, results: viewResults, import: viewImport, drivers: viewDrivers, setup: viewSetup }[S.tab];
    v.innerHTML = fn(L);
    if (S.tab === "import") bindDrop();
  }

  function renderTop() {
    const L = league();
    const opts = S.leagues.map((l) => `<option value="${esc(l.id)}" ${l.id === S.lid ? "selected" : ""}>${esc(l.name)}</option>`).join("");
    $("#leaguebar").innerHTML = S.leagues.length
      ? `<label class="sr" for="leagueSel">Liga</label><select id="leagueSel" data-chg="league">${opts}</select>
         ${S.canWrite ? `<button class="btn ghost sm" data-act="newLeague">+ Ny liga</button>` : ""}` : "";
    const tabs = [["standings", "Standings"], ["results", "Resultater"], ["import", "Importer"], ["drivers", "Førere"], ["setup", "Oppsett"]]
      .filter(([k]) => S.canWrite || !["import", "setup"].includes(k));
    $("#tabs").innerHTML = L && !S.newLeague ? tabs.map(([k, t]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-act="tab" data-v="${k}" aria-current="${S.tab === k ? "page" : "false"}">${t}</button>`).join("") : "";
    const em = S.session && S.session.user && S.session.user.email;
    $("#account").innerHTML = S.sb ? (em ? `<span class="who" title="${esc(em)}">${esc(em)}</span><button class="btn ghost sm" data-act="logout">Logg ut</button>`
      : `<button class="btn ghost sm" data-act="login">Logg inn</button>`) : "";
    const ro = $("#ro");
    ro.hidden = S.canWrite || !S.ready || !!S.err || S.login;
    if (!ro.hidden) ro.innerHTML = `<div class="wrap">${em
      ? `Du er logget inn som ${esc(em)}, men er ikke lagt til som arrangør. Be en arrangør legge deg til under Oppsett → Arrangører.`
      : `Du ser resultatene uten å være logget inn. Arrangører <button class="linkbtn inv" data-act="login">logger inn</button> for å importere og redigere.`}</div>`;
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
      <div class="row"><button class="btn primary" type="submit" ${busy}>Lagre passord</button></div></form>`;
    else if (m === "up") body = `<p class="muted">Første gang? Lag et passord for e-postadressen din. Du kan importere og redigere når en arrangør har lagt deg til under Oppsett → Arrangører.</p>
      <form data-form="signup" class="stack">${email}
      <label class="fld"><span>Velg passord (minst 8 tegn)</span><input id="pw1" type="password" required minlength="8" autocomplete="new-password" /></label>
      <label class="fld"><span>Gjenta passordet</span><input id="pw2" type="password" required minlength="8" autocomplete="new-password" /></label>
      <div class="row"><button class="btn primary" type="submit" ${busy}>Opprett konto</button>${cancel}</div></form>
      <p class="small">Har du allerede konto? <button class="linkbtn" data-act="loginMode" data-v="in">Logg inn</button></p>`;
    else if (m === "forgot") body = `<p class="muted">Skriv e-postadressen din, så sender vi en lenke der du kan velge nytt passord.</p>
      <form data-form="forgot" class="stack">${email}<div class="row"><button class="btn primary" type="submit" ${busy}>Send lenke</button>
      <button class="btn ghost" type="button" data-act="loginMode" data-v="in">Tilbake</button></div></form>`;
    else body = `<p class="muted">For arrangører. Alle andre kan se standings og resultater uten å logge inn.</p>
      <form data-form="login" class="stack">${email}
      <label class="fld"><span>Passord</span><input id="loginPw" type="password" required autocomplete="current-password" /></label>
      <div class="row"><button class="btn primary" type="submit" ${busy}>Logg inn</button>${cancel}</div></form>
      <p class="small"><button class="linkbtn" data-act="loginMode" data-v="up">Ny arrangør? Lag passord</button> · <button class="linkbtn" data-act="loginMode" data-v="forgot">Glemt passord?</button></p>`;
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
    const st = CORE.computeStandings(L, S.results, S.drivers, mode);
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
    const body = m.st.rows.map((r) => `<tr>
        <td class="pos">${r.pos}</td><td class="name">${esc(r.name)}</td>${divCol ? `<td class="num"><span class="div d${r.div || 1}">${r.div || 1}</span></td>` : ""}
        ${keys.map((k) => { const c = r.cells[k.id]; if (!c) return `<td class="num"></td>`;
          const cls = [c.dq ? "dsq" : c.rank <= 3 ? "p" + c.rank : "", c.dropped ? "drop" : ""].join(" ");
          return `<td class="num ${cls}" title="${c.dq ? "Diskvalifisert" : c.rank ? c.rank + ". plass" : ""}">${c.dq ? "DSQ" : fmtPts(c.pts)}</td>`; }).join("")}
        <td class="num tot">${fmtPts(r.total)}</td></tr>`).join("");
    return head + `<div class="tablewrap"><table class="grid st">
      <thead><tr><th rowspan="2" class="pos">Pos</th><th rowspan="2">Fører</th>${divCol ? `<th rowspan="2" class="num">Div</th>` : ""}${thG}<th rowspan="2" class="num">Total</th></tr><tr>${thR}</tr></thead>
      <tbody>${body}</tbody></table></div>
      <p class="legend"><span class="sw p1"></span>1. plass <span class="sw p2"></span>2. plass <span class="sw p3"></span>3. plass i løpet${+L.bestOf ? ` <span class="drop">00</span> ikke tellende` : ""}</p>`;
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
    const rows = CORE.computeRace(res, L, driverMap());
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
    const out = [], styles = [];
    list.forEach((r) => {
      const pos = mode === "d2" ? (r.dq ? "DSQ" : r.d2pos) : r.dq ? "DSQ" : r.cpos;
      const pen = r.p ? (r.p.t === "pts" ? "-" + fmtPts(r.p.v) : r.p.t) : 0;
      const row = mode === "d2" ? [pos, r.dq ? "" : r.cpos] : [pos];
      row.push(r.num, r.name);
      if (mode === "all" && d2on) row.push(r.div);
      row.push(r.car, r.start ?? "", r.dq && !/L$/.test(r.gap) ? r.out : r.gap, r.led, r.best, r.laps, r.inc,
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
    const ctrl = S.canWrite ? `<label class="chk"><input type="checkbox" data-chg="half" ${res.half ? "checked" : ""}/> Halve poeng</label>
      ${confirmDel ? `<span class="confirm">Slette resultatet? <button class="btn sm danger" data-act="delRes">Slett</button><button class="btn sm ghost" data-act="cancelConfirm">Avbryt</button></span>`
        : `<button class="btn sm ghost" data-act="askDelRes">Slett resultat</button>`}` : "";
    const head = `<div class="viewhead"><div><h2>R${res.round} ${esc(raceLabel(L, res.race))} · ${esc(trackOf(L, res.round))}</h2>
      <p class="muted">${esc(res.format || "")}${res.source ? " · " + esc(res.source) : ""}${imported ? " · importert " + imported : ""}</p></div>
      <div class="tools">${d2on ? `<div class="seg"><button class="${mode === "all" ? "on" : ""}" data-act="resMode" data-v="all">Totalt</button><button class="${mode === "d2" ? "on" : ""}" data-act="resMode" data-v="d2">${esc(d2n)}</button></div>` : ""}${exportBar("race")}</div></div>`;
    const list = mode === "d2" ? m.rows.filter((r) => r.d2pos != null || (r.dq && r.div === 2)) : m.rows;
    const body = list.map((r) => {
      const pos = mode === "d2" ? (r.dq ? "DSQ" : r.d2pos) : r.dq ? "DSQ" : r.cpos;
      const rk = mode === "d2" ? r.d2pos : r.cpos;
      const pts = mode === "d2" ? r.d2pts ?? 0 : r.pts;
      return `<tr class="${r.dq ? "isdq" : ""}"><td class="pos ${!r.dq && rk <= 3 ? "p" + rk : ""}">${pos}</td>
        ${mode === "d2" ? `<td class="num muted">${r.dq ? "" : r.cpos}</td>` : ""}
        <td class="num">${esc(r.num)}</td><td class="name">${esc(r.name)}</td>
        ${mode === "all" && d2on ? `<td class="num"><span class="div d${r.div}" title="Divisjon fra ${r.divSrc}">${r.div}</span></td>` : ""}
        <td class="car">${esc(r.car)}</td><td class="num">${r.start ?? ""}</td><td class="num mono">${esc(r.dq && !/L$/.test(r.gap) ? r.out : r.gap)}</td>
        <td class="num">${r.led}</td><td class="num mono">${esc(r.best)}</td><td class="num">${r.laps}</td><td class="num">${r.inc}</td>
        <td class="num tot">${fmtPts(pts)}</td><td class="pen">${penCell(r)}</td></tr>`;
    }).join("");
    const nDq = m.rows.filter((r) => r.dq).length, n2 = m.rows.filter((r) => r.div === 2).length;
    return head + picker + `<div class="bar">${ctrl}<span class="muted small">${m.rows.length} førere · ${n2} i ${esc(d2n)}${nDq ? " · " + nDq + " DSQ" : ""}</span></div>
      <div class="tablewrap"><table class="grid res"><thead><tr>
        <th class="pos">${mode === "d2" ? "Pos" : "Pos"}</th>${mode === "d2" ? `<th class="num">Totalt</th>` : ""}<th class="num">#</th><th>Fører</th>
        ${mode === "all" && d2on ? `<th class="num">Div</th>` : ""}<th>Bil</th><th class="num">Start</th><th class="num">Gap</th><th class="num">Ledet</th>
        <th class="num">Beste runde</th><th class="num">Runder</th><th class="num">Inc</th><th class="num">Poeng</th><th>Straff</th></tr></thead>
        <tbody>${body}</tbody></table></div>
      <p class="legend">Straff: poengtrekk trekkes fra løpets poeng. DNF, DNS og DSQ gir 0 poeng. DSQ flytter de bak opp en plass. Status DQ i filen gir 0 poeng automatisk.</p>`;
  }

  function penCell(r) {
    const p = r.p;
    if (!S.canWrite) return p ? (p.t === "pts" ? "-" + fmtPts(p.v) : p.t) : "";
    const t = p ? p.t : "";
    const o = (v, l) => `<option value="${v}" ${t === v ? "selected" : ""}>${l}</option>`;
    return `<div class="penbox"><select data-chg="penT" data-key="${esc(r.key)}" aria-label="Straff for ${esc(r.name)}">${o("", "–")}${o("pts", "Poengtrekk")}${o("DNF", "DNF")}${o("DNS", "DNS")}${o("DSQ", "DSQ")}</select>
      ${t === "pts" ? `<input type="number" min="0" step="1" value="${esc(p.v || 0)}" data-chg="penV" data-key="${esc(r.key)}" aria-label="Poengtrekk" />` : ""}</div>`;
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
        track: p.track || "", date: p.date || "", importedAt: new Date().toISOString(), half: false, pen: {}, rows: p.rows });
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
    if (!S.draft || S.draftFor !== L.id) { S.draft = JSON.parse(JSON.stringify({ name: L.name, races: L.races, rounds: L.rounds, scale: L.scale, d2: L.d2 || { enabled: false, name: "Division 2", ownPoints: true }, bestOf: L.bestOf || 0, logo: L.logo || "" })); S.draftFor = L.id; }
    const D = S.draft;
    const conf = S.confirm === "delLeague";
    if (!S.admins && !S.adminsLoading) { S.adminsLoading = true; DATA.listAdmins().then((a) => { S.admins = a; S.adminsLoading = false; softRender(); }).catch(() => { S.adminsLoading = false; }); }
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
          return `<li><span>${esc(a.email)}${me ? ` <span class="tag">deg</span>` : ""}</span>${me ? "" : `<button class="btn sm ghost" data-act="rmAdmin" data-email="${esc(a.email)}">Fjern</button>`}</li>`; }).join("")}</ul>`
          : `<p class="muted small">Henter…</p>`}
        <form data-form="addAdmin" class="addrow"><input id="adminEmail" type="email" placeholder="e-post til ny arrangør" required aria-label="E-post" /><button class="btn" type="submit">Legg til</button></form>
        <p class="muted small">Den nye arrangøren logger inn med samme e-postadresse.</p></section>
      <section class="panel danger"><h3>Slett liga</h3><p class="muted small">Sletter oppsett, førere og alle resultater for «${esc(L.name)}» for alle i gruppa.</p>
        ${conf ? `<span class="confirm">Er du sikker? <button class="btn sm danger" data-act="delLeague">Slett ligaen</button><button class="btn sm ghost" data-act="cancelConfirm">Avbryt</button></span>` : `<button class="btn sm ghost" data-act="askDelLeague">Slett liga</button>`}</section>
      </div>`;
  }
  function setDraft(path, val) {
    const D = S.draft; if (!D) return;
    if (path === "scaleText") { D.scale = String(val).split(/[,;\s]+/).map((x) => parseFloat(x.replace(",", "."))).filter((x) => isFinite(x)); return; }
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
    login: () => { S.login = true; S.loginMode = "in"; S.loginSent = ""; render(); },
    closeLogin: () => { S.login = false; render(); },
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
    addRace: () => { const D = S.draft; let k = "R" + (D.races.length + 1); while (D.races.find((r) => r.key === k)) k += "x"; D.races.push({ key: k, label: "Race " + (D.races.length + 1), short: "R" + (D.races.length + 1) }); render(); },
    rmRace: (b) => { S.draft.races.splice(+b.dataset.i, 1); render(); },
    logoReset: () => { S.draft.logo = ""; render(); },
    saveSetup: async () => {
      const L = league(), D = S.draft;
      if (!D.name.trim()) return toast("Serien må ha et navn.", "err");
      if (!D.scale.length) return toast("Poengskalaen er tom. Skriv inn poeng skilt med komma.", "err");
      const lost = Object.values(S.results).filter((r) => r.round > D.rounds.length || !D.races.find((x) => x.key === r.race)).length;
      const ok = await write(() => S.db.doc("leagues/" + L.id).update({ name: D.name.trim(), races: D.races, rounds: D.rounds, scale: D.scale, d2: D.d2, bestOf: +D.bestOf || 0, logo: D.logo || "" }), "Oppsettet er lagret.");
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
      S.login = false; S.loginMode = "in"; toast("Passordet er lagret."); checkAdmin(); return;
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
    if (c === "impRound") { S.imp.round = +t.value; render(); }
    if (c === "impRace") { S.imp.race = t.value; render(); }
    if (c === "file" && t.files[0]) readFile(t.files[0]);
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
