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
    const p = s.split(":");
    const v = p.length > 1 ? (+p[0]) * 60 + parseFloat(p[1]) : parseFloat(p[0]);
    return isFinite(v) ? v : null;
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
    return { format: isIRC ? "iRaceControl CSV" : "iRacing CSV", track: meta.track || "", date: meta.date || "", rows: out,
             hasClass: c.cls >= 0 };
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
        _iv: r.interval > 0 ? r.interval / 10000 : 0,
      };
    }).sort((a, b) => a.pos - b.pos);
    // iRacing JSON: interval er til bilen foran (1/10000 s) – summeres til avstand til leder
    let cum = 0, broke = false;
    rows.forEach((r, i) => {
      if (/L$/.test(r.gap)) broke = true;
      else if (i > 0 && !broke && r.gap) { cum += r._iv; r.gap = fmtGap(cum); }
      delete r._iv;
    });
    const t = d.track || {};
    const track = [t.track_name, t.config_name].filter(Boolean).join(" – ");
    return { format: "iRacing JSON", track, date: d.start_time || "", rows, hasClass: true };
  }

  function parseFile(name, text) {
    const t = String(text).replace(/^﻿/, "").trim();
    if (t.startsWith("{")) return parseJSON(t);
    return parseCSV(t);
  }

  const round2 = (v) => Math.round(v * 100) / 100;
  const scaleVal = (scale, p) => (p >= 1 && p <= scale.length ? +scale[p - 1] || 0 : 0);

  /** Beregner plass og poeng for ett løp. drivers: Map(normKey -> driver) */
  function computeRace(result, league, drivers) {
    const scale = league.scale || defaultScale();
    const half = result.half ? 0.5 : 1;
    const pen = result.pen || {};
    const d2on = !!(league.d2 && league.d2.enabled);
    const own = !(league.d2 && league.d2.ownPoints === false);
    const rows = (result.rows || []).map((r) => {
      const key = norm(r.name);
      const drv = drivers.get(key);
      const div = r.cls === 1 || r.cls === 2 ? r.cls : drv ? drv.div || 1 : 1;
      const p = pen[key] || null;
      const dq = !!r.dq || (p && p.t === "DSQ");
      const zero = !!(p && (p.t === "DNF" || p.t === "DNS" || p.t === "DSQ"));
      const ded = p && p.t === "pts" ? +p.v || 0 : 0;
      return { ...r, key, div, divSrc: r.cls === 1 || r.cls === 2 ? "fil" : drv ? "fører" : "standard", p, dq, zero, ded };
    }).sort((a, b) => (a.dq - b.dq) || (a.pos - b.pos));
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
  function computeStandings(league, results, driverList, mode) {
    const drivers = new Map(driverList.map((d) => [norm(d.name), d]));
    const keys = raceKeys(league);
    const table = new Map();
    for (const k of keys) {
      const res = results[k.id];
      if (!res) continue;
      for (const r of computeRace(res, league, drivers)) {
        const pts = mode === "d2" ? r.d2pts : r.pts;
        const rank = mode === "d2" ? r.d2pos : r.cpos;
        if (mode === "d2" && r.d2pos == null && !(r.dq && r.div === 2)) continue;
        if (!table.has(r.key)) {
          const drv = drivers.get(r.key);
          table.set(r.key, { key: r.key, name: drv ? drv.name : r.name, num: drv && drv.num ? drv.num : r.num, div: drv ? drv.div : r.div, cells: {} });
        }
        table.get(r.key).cells[k.id] = { pts: r.dq ? 0 : pts ?? 0, rank, dq: r.dq, zero: r.zero };
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

  return { defaultScale, norm, parseCSVText, parseCSV, parseJSON, parseFile, computeRace, computeStandings, raceKeys,
           cslTemplate, fmtGap, fmtLap, secs, isDQ };
})();
if (typeof module !== "undefined") module.exports = CORE;
