/* CSL Resultater – kjernelogikk (ren JS, ingen DOM). Brukes av siden og testes i Node. */
const CORE = (() => {
  const pad = (n, w) => String(n).padStart(w, "0");

  function defaultScale() {
    const s = [60, 54, 49, 45, 42, 39, 37, 35, 33, 31];
    for (let p = 29; p >= 1; p--) s.push(p);
    return s;
  }

  function norm(n) {
    return String(n || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function parseCSVText(text) {
    text = String(text).replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function secs(s) {
    s = String(s == null ? "" : s).trim().replace(/^[-+]/, "");
    if (!s || /L$/i.test(s)) return null;
    const v = s.split(":").reduce((a, x) => a * 60 + parseFloat(x), 0);
    return isFinite(v) ? v : null;
  }
  function fmtTime(sec) {
    if (sec == null || !isFinite(sec) || sec <= 0) return "";
    const t = Math.round(sec * 1000), h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000),
      s = Math.floor((t % 60000) / 1000), ms = t % 1000;
    return (h > 0 ? h + ":" + pad(m, 2) : m) + ":" + pad(s, 2) + "." + pad(ms, 3);
  }
  function fmtGap(sec) {
    if (sec == null) return "";
    const t = Math.round(sec * 1000), m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), ms = t % 1000;
    return "-" + (m > 0 ? m + ":" + pad(s, 2) : pad(s, 2)) + "." + pad(ms, 3);
  }
  function fmtLap(sec) {
    if (!sec || sec <= 0) return "";
    const t = Math.round(sec * 1000), m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), ms = t % 1000;
    return m + ":" + pad(s, 2) + "." + pad(ms, 3);
  }
  const lapsDown = (s) => { const m = String(s || "").match(/(\d+)\s*L\b/i); return m ? +m[1] : null; };
  const isDQ = (out) => { const o = String(out || "").trim().toUpperCase(); return o.startsWith("DQ") || o.includes("DISQ"); };
  const int = (v) => { const n = parseInt(String(v == null ? "" : v).trim(), 10); return isFinite(n) ? n : null; };

  function parseCSV(text) {
    const rows = parseCSVText(text);
    const h = rows.findIndex((r) => r.length > 3 && String(r[0]).trim() === "Fin Pos");
    if (h < 0) throw new Error("Fant ikke kolonnen «Fin Pos». Velg en resultatfil eksportert fra iRaceControl eller iRacing.");
    const meta = {};
    if (h >= 2 && String(rows[0][0]).trim() === "Start Time") {
      meta.date = String(rows[1][0] || "").trim();
      meta.track = String(rows[1][1] || "").trim();
    }
    const hdr = rows[h].map((x) => String(x).trim().toLowerCase());
    const col = (n) => hdr.indexOf(n.toLowerCase());
    const isIRC = col("Car Type") >= 0;
    const c = {
      pos: col("Fin Pos"), name: col("Name"), num: col("Car #"), car: isIRC ? col("Car Type") : col("Car"),
      start: col("Start Pos"), iv: col("Interval"), led: col("Laps Led"), best: col("Fastest Lap Time"),
      laps: col("Laps Comp"), inc: col("Inc"), out: col("Out"), cls: col("Car Class ID"), cust: col("Cust ID"),
      avg: col("Average Lap Time"), rtime: col("Race Time") >= 0 ? col("Race Time") : col("Total Time"),
    };
    if (c.name < 0) throw new Error("Fant ikke kolonnen «Name» i filen.");
    const g = (r, k) => (c[k] >= 0 && r[c[k]] != null ? String(r[c[k]]).trim() : "");
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const pos = int(g(r, "pos"));
      if (pos == null || !g(r, "name")) continue;
      const best = g(r, "best");
      out.push({
        pos, name: g(r, "name"), num: g(r, "num"), car: g(r, "car"), start: int(g(r, "start")),
        laps: int(g(r, "laps")) ?? 0, led: int(g(r, "led")) ?? 0, inc: int(g(r, "inc")) ?? 0,
        best: best === "0" ? "" : best, out: g(r, "out"), dq: isDQ(g(r, "out")),
        cls: c.cls >= 0 ? int(g(r, "cls")) : null, cust: c.cust >= 0 ? int(g(r, "cust")) : null, _iv: g(r, "iv"),
        _avg: g(r, "avg"), _rt: g(r, "rtime"),
      });
    }
    if (!out.length) throw new Error("Fant ingen resultatrader under overskriftene.");
    out.sort((a, b) => a.pos - b.pos);
    // iRaceControl oppgir avstand til bilen foran; iRacing oppgir avstand til leder
    let cum = 0, broke = false;
    out.forEach((r, i) => {
      const ld = lapsDown(r._iv);
      if (ld != null) { r.gap = "-" + ld + " L"; broke = true; }
      else {
        const s = secs(r._iv);
        if (s == null) r.gap = "";
        else if (isIRC && !broke) { cum = i === 0 ? 0 : cum + s; r.gap = fmtGap(cum); }
        else r.gap = fmtGap(s);
      }
      delete r._iv;
    });
    // Løpstid for vinneren: egen kolonne hvis filen har det, ellers snittid × runder
    const w = out.find((r) => !r.dq) || out[0];
    let raceTime = null, raceTimeSrc = "";
    if (w) {
      const rt = secs(w._rt), avg = secs(w._avg);
      if (rt && rt > 0) { raceTime = rt; raceTimeSrc = "fil"; }
      else if (avg && avg > 0 && w.laps > 0) { raceTime = Math.round(avg * w.laps * 1000) / 1000; raceTimeSrc = "beregnet"; }
    }
    out.forEach((r) => { delete r._avg; delete r._rt; });
    return { format: isIRC ? "iRaceControl CSV" : "iRacing CSV", track: meta.track || "", date: meta.date || "", rows: out,
             hasClass: c.cls >= 0, raceTime, raceTimeSrc };
  }

  function parseJSON(text) {
    let d = JSON.parse(text);
    if (d.data && d.data.session_results) d = d.data;
    const sr = d.session_results;
    if (!Array.isArray(sr)) throw new Error("JSON-filen har ingen «session_results». Velg en resultatfil fra iRacing.");
    const race = sr.find((s) => /race/i.test(s.simsession_type_name || s.simsession_name || "")) || sr[sr.length - 1];
    let res = (race.results || []).filter((r) => r.finish_position >= 0);
    res = res.filter((r) => {
      const dr = (r.driver_results && r.driver_results[0]) || r;
      return !(/pace car/i.test(dr.display_name || r.display_name || "") || dr.car_class_id === 0 && !(dr.display_name));
    });
    if (!res.length) throw new Error("Fant ingen førere i løpsøkten i JSON-filen.");
    const zero = Math.min(...res.map((r) => r.finish_position)) === 0;
    const starts = res.map((r) => r.starting_position);
    const startsUseful = new Set(starts).size > 1;
    const leader = res.reduce((a, b) => (b.finish_position < a.finish_position ? b : a));
    const leaderLaps = leader.laps_complete || 0;
    const rows = res.map((r) => {
      const dr = (r.driver_results && r.driver_results[0]) || r;
      const cls = dr.car_class_id ?? r.car_class_id;
      const laps = r.laps_complete || dr.laps_complete || 0;
      const pos = r.finish_position + (zero ? 1 : 0);
      let gap = "";
      if (pos === 1) gap = "-00.000";
      else if (laps < leaderLaps) gap = "-" + (leaderLaps - laps) + " L";
      else if (r.interval > 0) gap = fmtGap(r.interval / 10000);
      const liv = r.livery || dr.livery || {};
      return {
        pos, name: r.display_name || dr.display_name || "", num: liv.car_number || "", car: dr.car_name || r.car_name || "",
        start: startsUseful && r.starting_position >= 0 ? r.starting_position + 1 : null, laps, led: r.laps_lead || 0,
        inc: r.incidents || 0, best: r.best_lap_time > 0 ? fmtLap(r.best_lap_time / 10000) : "", out: r.reason_out || "",
        dq: isDQ(r.reason_out), cls: cls === 1 || cls === 2 ? cls : (cls > 0 ? cls : null), cust: dr.cust_id || null, gap,
        _iv: r.interval > 0 ? r.interval / 10000 : 0, _avg: r.average_lap > 0 ? r.average_lap / 10000 : 0,
      };
    }).sort((a, b) => a.pos - b.pos);
    // iRacing JSON: interval er til bilen foran (1/10000 s) – summeres til avstand til leder
    let cum = 0, broke = false;
    rows.forEach((r, i) => {
      if (/L$/.test(r.gap)) broke = true;
      else if (i > 0 && !broke && r.gap) { cum += r._iv; r.gap = fmtGap(cum); }
      delete r._iv;
    });
    const w = rows.find((r) => !r.dq) || rows[0];
    const raceTime = w && w._avg > 0 && w.laps > 0 ? Math.round(w._avg * w.laps * 1000) / 1000 : null;
    rows.forEach((r) => delete r._avg);
    const t = d.track || {};
    const track = [t.track_name, t.config_name].filter(Boolean).join(" – ");
    return { format: "iRacing JSON", track, date: d.start_time || "", rows, hasClass: true, raceTime, raceTimeSrc: raceTime ? "beregnet" : "" };
  }

  function parseFile(name, text) {
    const t = String(text).replace(/^﻿/, "").trim();
    if (t.startsWith("{")) return parseJSON(t);
    return parseCSV(t);
  }

  const round2 = (v) => Math.round(v * 100) / 100;
  const scaleVal = (scale, p) => (p >= 1 && p <= scale.length ? +scale[p - 1] || 0 : 0);

  /** Tidsstraff: legger sekunder til tiden for førere på samme runde som vinneren og sorterer på nytt.
      Førere som er runde(r) bak beholder rekkefølgen. Endrer pos og gap, og gir vinneren rtAdd
      (sekunder vinnerens tid er lengre enn opprinnelig vinnertid). */
  function applyTimePens(rows) {
    if (!rows.some((r) => r.tpen)) return;
    const live = rows.filter((r) => !r.dq).sort((a, b) => a.pos - b.pos);
    let prevK = 0;
    live.forEach((r, i) => {
      r.origPos = r.pos;
      const ld = lapsDown(r.gap), g = secs(r.gap);
      if (ld != null) { r._k = Math.max(ld, prevK); r._t = i; }
      else if (prevK === 0 && (g != null || i === 0)) { r._k = 0; r._t = (g || 0) + (r.tpen || 0); }
      else { r._k = Math.max(prevK, 1); r._t = i; } // bak en runde-bak-fører eller uten tid: behold rekkefølgen
      prevK = r._k;
    });
    live.sort((a, b) => a._k - b._k || a._t - b._t || a.origPos - b.origPos);
    const base = live.length && live[0]._k === 0 ? live[0]._t : 0;
    live.forEach((r, i) => {
      r.pos = i + 1;
      if (r._k === 0) r.gap = fmtGap(r._t - base);
      delete r._k; delete r._t;
    });
    if (live[0]) live[0].rtAdd = base;
    // DSQ-rader beholder plass bak de som fullførte
    rows.filter((r) => r.dq).forEach((r, i) => { r.origPos = r.pos; r.pos = live.length + i + 1; });
  }

  /** Beregner plass og poeng for ett løp. drivers: Map(normKey -> driver).
      extra: straffer fra protestsaker [{key, t: "pts"|"time"|"DSQ", v, case}] */
  function computeRace(result, league, drivers, extra) {
    const scale = league.scale || defaultScale();
    const half = result.half ? 0.5 : 1;
    const pen = result.pen || {};
    const d2on = !!(league.d2 && league.d2.enabled);
    const own = !(league.d2 && league.d2.ownPoints === false);
    const ex = {};
    (extra || []).forEach((x) => { if (x && x.key) (ex[x.key] = ex[x.key] || []).push(x); });
    const rows = (result.rows || []).map((r) => {
      const key = norm(r.name);
      const drv = drivers.get(key);
      const div = r.cls === 1 || r.cls === 2 ? r.cls : drv ? drv.div || 1 : 1;
      const p = pen[key] || null;
      const pp = ex[key] || [];
      const pdq = pp.some((x) => x.t === "DSQ");
      const dq = !!r.dq || (p && p.t === "DSQ") || pdq;
      const zero = !!(p && (p.t === "DNF" || p.t === "DNS" || p.t === "DSQ")) || pdq;
      const ded = (p && p.t === "pts" ? +p.v || 0 : 0) + pp.filter((x) => x.t === "pts").reduce((s, x) => s + (+x.v || 0), 0);
      const tpen = pp.filter((x) => x.t === "time").reduce((s, x) => s + (+x.v || 0), 0);
      return { ...r, key, div, divSrc: r.cls === 1 || r.cls === 2 ? "fil" : drv ? "fører" : "standard", p, pp, dq, zero, ded, tpen };
    });
    applyTimePens(rows);
    rows.sort((a, b) => (a.dq - b.dq) || (a.pos - b.pos));
    let c = 0, k = 0;
    for (const r of rows) {
      if (r.dq) { r.cpos = null; r.pts = 0; r.d2pos = null; r.d2pts = null; continue; }
      r.cpos = ++c;
      r.pts = r.zero ? 0 : round2(scaleVal(scale, c) * half - r.ded);
      if (d2on && r.div === 2) {
        r.d2pos = ++k;
        r.d2pts = r.zero ? 0 : round2(scaleVal(scale, own ? k : c) * half - r.ded);
      } else { r.d2pos = null; r.d2pts = null; }
    }
    return rows;
  }

  function raceKeys(league) {
    const out = [];
    (league.rounds || []).forEach((rd, i) => (league.races || []).forEach((ra) => {
      out.push({ id: "r" + (i + 1) + "-" + ra.key, round: i + 1, race: ra.key, label: ra.short || ra.label, track: rd.track || "" });
    }));
    return out;
  }

  /** mode: "all" eller "d2". results: {id: resultDoc} */
  function computeStandings(league, results, driverList, mode, extraByRid) {
    const drivers = new Map(driverList.map((d) => [norm(d.name), d]));
    const keys = raceKeys(league);
    const table = new Map();
    for (const k of keys) {
      const res = results[k.id];
      if (!res) continue;
      for (const r of computeRace(res, league, drivers, extraByRid && extraByRid[k.id])) {
        const pts = mode === "d2" ? r.d2pts : r.pts;
        const rank = mode === "d2" ? r.d2pos : r.cpos;
        if (mode === "d2" && r.d2pos == null && !(r.dq && r.div === 2)) continue;
        if (!table.has(r.key)) {
          const drv = drivers.get(r.key);
          table.set(r.key, { key: r.key, name: drv ? drv.name : r.name, num: drv && drv.num ? drv.num : r.num, div: drv ? drv.div : r.div, cells: {} });
        }
        table.get(r.key).cells[k.id] = { pts: r.dq ? 0 : pts ?? 0, rank, dq: r.dq, zero: r.zero, pp: r.pp };
      }
    }
    const best = +league.bestOf || 0;
    const rows = [...table.values()].map((d) => {
      const list = keys.filter((k) => d.cells[k.id]).map((k) => ({ id: k.id, pts: d.cells[k.id].pts }));
      list.sort((a, b) => b.pts - a.pts);
      if (best > 0 && list.length > best) list.slice(best).forEach((x) => (d.cells[x.id].dropped = true));
      d.total = round2(list.filter((x) => !d.cells[x.id].dropped).reduce((s, x) => s + x.pts, 0));
      d.sorted = list.map((x) => x.pts);
      d.wins = keys.filter((k) => d.cells[k.id] && d.cells[k.id].rank === 1).length;
      d.starts = list.length;
      return d;
    });
    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      for (let i = 0; i < Math.max(a.sorted.length, b.sorted.length); i++) {
        const x = a.sorted[i] ?? -1, y = b.sorted[i] ?? -1;
        if (x !== y) return y - x;
      }
      return a.name.localeCompare(b.name, "nb");
    });
    rows.forEach((r, i) => (r.pos = i + 1));
    return { keys, rows };
  }

  function cslTemplate() {
    return {
      name: "CSL GT3 Double Sprint",
      races: [{ key: "H", label: "Heat", short: "Heat" }, { key: "F", label: "Feature", short: "Feat" }],
      rounds: [1, 2, 3, 4, 5, 6].map(() => ({ track: "", date: "" })),
      scale: defaultScale(),
      d2: { enabled: true, name: "Division 2", ownPoints: true },
      bestOf: 0,
      logo: "",
    };
  }

  /** Standardoppsett for protester (ligger i league.protests) */
  function protestDefaults(p) {
    return {
      enabled: false, deadlineH: 48, appealH: 48, perRound: 2, video: "req",
      kinds: ["Kontakt / dytting", "Blokkering", "Utrygg retur til banen", "Ignorerte blått flagg", "Kutting / banegrenser", "Usportslig oppførsel", "Annet"],
      // Regler stewards velger i avgjørelsen (fra CSL-regelheftet). «99 Annet» legges alltid til (RULE_OTHER).
      rules: ["1.1 Code of Conduct", "1.2 Discord", "3.2 Qualifying", "3.3 First lap behavior", "3.4 Overtaking", "3.5 Braking zone",
        "3.6 Yellow Flag / Accident ahead", "3.7 Blue Flag", "3.8 Race Control", "3.10.2 Rolling start", "4.2 Guidelines for multiclass",
        "5 Oval league specific rules", "6 Protest"],
      ...(p || {}),
    };
  }
  const RULE_OTHER = "99 Annet";
  /** Ligaens regler for nedtrekksmenyen, med «99 Annet» til slutt. */
  function protestRules(league) {
    const list = (protestDefaults(league && league.protests).rules || []).map((x) => String(x).trim()).filter((x) => x && !/^99\s+annet$/i.test(x));
    return [...list, RULE_OTHER];
  }

  /** Straffer fra avgjorte protestsaker som skal legges inn i resultatet, gruppert per løp (rid).
      driverName(id) gir førerens navn i dag (navnet kan være endret siden protesten ble sendt inn). */
  /** Straffene i en avgjørelse: d.pens (flere), eller d.pen fra eldre saker. */
  function decisionPens(d) {
    if (!d) return [];
    const list = Array.isArray(d.pens) ? d.pens : d.pen ? [d.pen] : [];
    return list.filter((x) => x && ["pts", "time", "DSQ"].includes(x.t));
  }

  function protestPens(protests, driverName) {
    const out = {};
    (protests || []).forEach((p) => {
      const d = p.decision;
      if (!d || d.outcome !== "pen" || !d.apply || !["decided", "closed"].includes(p.status)) return;
      const pens = decisionPens(d);
      if (!pens.length) return;
      const name = (driverName && driverName(d.driver)) || d.driverName;
      if (!name) return;
      const rid = "r" + p.round + "-" + p.race;
      pens.forEach((x) => (out[rid] = out[rid] || []).push({ key: norm(name), t: x.t, v: +x.v || 0, case: p.no }));
    });
    return out;
  }

  /** Protestfrist: rundens dato + løpsslutt (end, «HH:MM») + deadlineH timer.
   *  Uten løpsslutt: midnatt etter datoen. Uten dato: ingen frist (null). */
  function protestDeadline(league, round) {
    const cfg = protestDefaults(league.protests);
    const rd = (league.rounds || [])[round - 1] || {}, d = rd.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const [y, m, dd] = d.split("-").map(Number);
    const t = /^(\d{1,2}):(\d{2})$/.exec(rd.end || "");
    const base = t ? new Date(y, m - 1, dd, +t[1], +t[2], 0) : new Date(y, m - 1, dd + 1, 0, 0, 0);
    return base.getTime() + (+cfg.deadlineH || 0) * 3600000;
  }

  return { defaultScale, norm, parseCSVText, parseCSV, parseJSON, parseFile, computeRace, computeStandings, raceKeys,
           cslTemplate, fmtGap, fmtLap, fmtTime, secs, isDQ, protestDefaults, protestRules, RULE_OTHER, decisionPens, protestPens, protestDeadline };
})();
if (typeof module !== "undefined") module.exports = CORE;
