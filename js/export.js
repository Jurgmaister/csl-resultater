/* CSL-eksport: tabellmodell -> PNG (canvas), PDF (jsPDF) og Excel (xlsx-js-style), alt i CSL-design */
const EXPORT = (() => {
  const C = { red: "#FC0003", green: "#8ED152", rowA: "#9DC3EA", rowB: "#D9E2F0", gold: "#FEDA66", silver: "#C0C0C0",
              bronze: "#E96726", ink: "#141c2b", white: "#FFFFFF", muted: "#5b6577" };
  const LIBS = {
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    xlsx: "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js",
  };
  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) loaded[url] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = url; s.onload = res;
      s.onerror = () => { delete loaded[url]; rej(new Error("Kunne ikke laste eksportbiblioteket. Sjekk nettforbindelsen og prøv igjen.")); };
      document.head.appendChild(s);
    });
    return loaded[url];
  }
  const imgCache = {};
  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (!imgCache[src]) imgCache[src] = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    return imgCache[src];
  }
  const fill = { 1: C.gold, 2: C.silver, 3: C.bronze };

  /* ---------- PNG / canvas ---------- */
  async function draw(model, logoSrc) {
    try { await Promise.all([document.fonts.load("700 14px Barlow"), document.fonts.load("500 14px Barlow")]); } catch (e) {}
    const F = "Barlow, 'Arial Narrow', Arial, sans-serif";
    const S = 2, titleH = 46, grpH = 30, lblH = 24, rowH = 23, padX = 7;
    const cols = model.columns;
    const W = cols.reduce((s, c) => s + c.w, 0);
    const H = titleH + grpH + lblH + model.rows.length * rowH + (model.note ? 26 : 2);
    const cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    const g = cv.getContext("2d"); g.scale(S, S);
    g.fillStyle = C.white; g.fillRect(0, 0, W, H);
    g.fillStyle = C.red; g.fillRect(0, 0, W, titleH);
    g.fillStyle = C.green; g.fillRect(0, titleH, W, grpH + lblH);
    const logo = await loadImg(logoSrc);
    let logoW = 0;
    if (logo) {
      const lh = titleH + grpH - 6, lw = (logo.width / logo.height) * lh;
      g.drawImage(logo, 8, 4, lw, lh); logoW = lw + 16;
    }
    g.fillStyle = C.white; g.textBaseline = "middle"; g.textAlign = "center";
    let fs = 19; g.font = `700 ${fs}px ${F}`;
    const avail = W - logoW * 2 - 20;
    while (g.measureText(model.title).width > avail && fs > 12) { fs--; g.font = `700 ${fs}px ${F}`; }
    g.fillText(model.title, W / 2, titleH / 2 + 1);
    // kolonnegrupper (runder)
    let x = 0;
    const xs = cols.map((c) => { const s = x; x += c.w; return s; });
    g.fillStyle = C.ink;
    if (model.groups) {
      let ci = 0;
      for (const gr of model.groups) {
        const gx = xs[ci], gw = cols.slice(ci, ci + gr.span).reduce((s, c) => s + c.w, 0);
        if (gr.label) {
          g.font = `500 12px ${F}`; g.textAlign = "center";
          wrapText(g, gr.label, gx + gw / 2, titleH + grpH / 2, gw - 6, 13);
          g.strokeStyle = "rgba(20,28,43,.35)"; g.lineWidth = 1;
          g.beginPath(); g.moveTo(gx + 3, titleH + grpH + 0.5); g.lineTo(gx + gw - 3, titleH + grpH + 0.5); g.stroke();
          g.beginPath(); g.moveTo(gx + 0.5, titleH + 4); g.lineTo(gx + 0.5, titleH + grpH + lblH); g.stroke();
        }
        ci += gr.span;
      }
    }
    cols.forEach((c, i) => {
      const parts = String(c.label).split("\n");
      g.font = `700 12px ${F}`; g.textAlign = c.align === "l" ? "left" : c.align === "r" ? "right" : "center";
      const tx = c.align === "l" ? xs[i] + padX : c.align === "r" ? xs[i] + c.w - padX : xs[i] + c.w / 2;
      if (parts.length > 1) g.fillText(parts[0], tx, titleH + grpH - 8);
      g.fillText(parts[parts.length - 1], tx, titleH + grpH + lblH / 2);
    });
    g.fillStyle = "#000"; g.fillRect(0, titleH + grpH + lblH - 2, W, 2);
    // rader
    const top = titleH + grpH + lblH;
    model.rows.forEach((row, ri) => {
      const y = top + ri * rowH;
      g.fillStyle = ri % 2 ? C.rowB : C.rowA; g.fillRect(0, y, W, rowH);
      row.forEach((v, ci) => {
        const st = (model.styles && model.styles[ri] && model.styles[ri][ci]) || {};
        if (st.rank && fill[st.rank]) { g.fillStyle = fill[st.rank]; g.fillRect(xs[ci], y, cols[ci].w, rowH); }
        if (st.fill) { g.fillStyle = st.fill; g.fillRect(xs[ci], y, cols[ci].w, rowH); }
        g.strokeStyle = C.white; g.lineWidth = 1; g.strokeRect(xs[ci] + 0.5, y + 0.5, cols[ci].w, rowH);
        const c = cols[ci];
        g.fillStyle = st.color || (st.muted ? C.muted : C.ink);
        g.font = `${st.muted ? "italic " : ""}${st.bold || c.bold ? 700 : 500} 13px ${F}`;
        g.textAlign = c.align === "l" ? "left" : c.align === "r" ? "right" : "center";
        const tx = c.align === "l" ? xs[ci] + padX : c.align === "r" ? xs[ci] + c.w - padX : xs[ci] + c.w / 2;
        let txt = v == null ? "" : String(v);
        while (txt.length > 1 && g.measureText(txt).width > c.w - padX * 2) txt = txt.slice(0, -1);
        g.fillText(txt, tx, y + rowH / 2 + 1);
        if (st.muted && txt) { const w = g.measureText(txt).width, sx = c.align === "l" ? tx : c.align === "r" ? tx - w : tx - w / 2; g.fillRect(sx, y + rowH / 2, w, 1); }
      });
    });
    if (model.note) {
      g.fillStyle = C.muted; g.font = `500 11px ${F}`; g.textAlign = "left";
      g.fillText(model.note, 6, top + model.rows.length * rowH + 14);
    }
    return cv;
  }
  function wrapText(g, text, cx, cy, maxW, lh) {
    const words = String(text).split(" "); const lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    const l2 = lines.slice(0, 2);
    l2.forEach((l, i) => g.fillText(l, cx, cy + (i - (l2.length - 1) / 2) * lh));
  }

  async function png(model, logo) {
    const cv = await draw(model, logo);
    return new Promise((res) => cv.toBlob(res, "image/png"));
  }

  function chunk(model, n) {
    if (model.rows.length <= n) return [model];
    const out = [];
    for (let i = 0; i < model.rows.length; i += n) {
      out.push({ ...model, rows: model.rows.slice(i, i + n), styles: model.styles ? model.styles.slice(i, i + n) : null,
                 note: i + n >= model.rows.length ? model.note : "" });
    }
    return out;
  }

  async function pdf(models, logo) {
    await loadScript(LIBS.pdf);
    const { jsPDF } = window.jspdf;
    let doc = null;
    for (const m of models) {
      for (const part of chunk(m, 40)) {
        const cv = await draw(part, logo);
        const land = cv.width / cv.height > 1.15;
        const o = land ? "landscape" : "portrait";
        if (!doc) doc = new jsPDF({ orientation: o, unit: "pt", format: "a4" }); else doc.addPage("a4", o);
        const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight(), m0 = 24;
        let w = pw - m0 * 2, h = (cv.height / cv.width) * w;
        if (h > ph - m0 * 2) { h = ph - m0 * 2; w = (cv.width / cv.height) * h; }
        doc.addImage(cv.toDataURL("image/png"), "PNG", (pw - w) / 2, m0, w, h, undefined, "FAST");
      }
    }
    return new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
  }

  /* ---------- Excel ---------- */
  function sheet(model) {
    const X = window.XLSX;
    const cols = model.columns, n = cols.length;
    const aoa = [[model.title, ...Array(n - 1).fill("")]];
    const grpRow = Array(n).fill("");
    if (model.groups) { let ci = 0; for (const gr of model.groups) { grpRow[ci] = gr.label || ""; ci += gr.span; } }
    cols.forEach((c, i) => { const p = String(c.label).split("\n"); if (p.length > 1 && !grpRow[i]) grpRow[i] = p[0]; });
    aoa.push(grpRow);
    aoa.push(cols.map((c) => { const p = String(c.label).split("\n"); return p[p.length - 1]; }));
    model.rows.forEach((r) => aoa.push(r.map((v) => (v === "" || v == null ? "" : v))));
    const ws = X.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: n - 1 } }];
    if (model.groups) { let ci = 0; for (const gr of model.groups) { if (gr.span > 1 && gr.label) ws["!merges"].push({ s: { r: 1, c: ci }, e: { r: 1, c: ci + gr.span - 1 } }); ci += gr.span; } }
    ws["!cols"] = cols.map((c) => ({ wch: Math.max(5, Math.round(c.w / 7)) }));
    ws["!rows"] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 18 }];
    const hex = (h) => h.replace("#", "").toUpperCase();
    const white = { style: "thin", color: { rgb: "FFFFFF" } };
    const align = (c) => ({ horizontal: c.align === "l" ? "left" : c.align === "r" ? "right" : "center", vertical: "center" });
    for (let r = 0; r < aoa.length; r++) for (let c = 0; c < n; c++) {
      const ref = X.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: "s", v: "" };
      let s;
      if (r === 0) s = { fill: { fgColor: { rgb: hex(C.red) } }, font: { bold: true, sz: 14, color: { rgb: "FFFFFF" }, name: "Calibri" }, alignment: { horizontal: "center", vertical: "center" } };
      else if (r <= 2) s = { fill: { fgColor: { rgb: hex(C.green) } }, font: { bold: true, sz: r === 1 ? 10 : 11, name: "Calibri" }, alignment: { ...align(cols[c]), horizontal: r === 1 ? "center" : align(cols[c]).horizontal, wrapText: true },
                             border: r === 2 ? { bottom: { style: "medium", color: { rgb: "000000" } } } : {} };
      else {
        const ri = r - 3, st = (model.styles && model.styles[ri] && model.styles[ri][c]) || {};
        const bg = st.fill || (st.rank && fill[st.rank]) || (ri % 2 ? C.rowB : C.rowA);
        s = { fill: { fgColor: { rgb: hex(bg) } }, font: { bold: !!(st.bold || cols[c].bold), italic: !!st.muted, strike: !!st.muted, sz: 11, name: "Calibri", color: { rgb: st.muted ? "5B6577" : "141C2B" } },
              alignment: align(cols[c]), border: { top: white, bottom: white, left: white, right: white } };
      }
      ws[ref].s = s;
    }
    return ws;
  }
  async function xlsx(models) {
    await loadScript(LIBS.xlsx);
    const X = window.XLSX, wb = X.utils.book_new(), used = new Set();
    for (const m of models) {
      let nm = (m.sheet || m.title).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Ark";
      let k = 2; const base = nm; while (used.has(nm)) nm = (base.slice(0, 28) + " " + k++);
      used.add(nm); X.utils.book_append_sheet(wb, sheet(m), nm);
    }
    const buf = X.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function csv(model) {
    const esc = (v) => { const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [model.columns.map((c) => esc(String(c.label).replace("\n", " "))).join(";")];
    model.rows.forEach((r) => lines.push(r.map(esc).join(";")));
    return "﻿" + lines.join("\r\n");
  }

  return { draw, png, pdf, xlsx, csv };
})();
