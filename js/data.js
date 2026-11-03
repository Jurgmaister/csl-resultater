/* Datalag mot Supabase. Gir samme doc()/collection()-grensesnitt som appen ble skrevet mot,
   slik at stiene "leagues/{id}", "leagues/{id}/drivers/{id}" og "leagues/{id}/results/{rid}" virker som før. */
const DATA = (() => {
  let sb = null, onWrite = () => {}, cache = { leagues: () => [], results: () => ({}) };

  function err(e) {
    if (!e) return;
    const rls = e.code === "42501" || /row-level security|permission denied/i.test(e.message || "");
    const out = new Error(rls ? "Du har ikke tilgang til å endre dette." : e.message || "Ukjent feil");
    out.code = rls ? "invalid_argument" : e.code || "unavailable";
    throw out;
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

  const LEAGUE_COLS = ["name"];
  function splitLeague(d) { const { name, createdAt, id, ...config } = d; return { name, config }; }

  function ref(path) {
    const p = path.split("/");
    const id = p[p.length - 1];
    if (p.length === 2 && p[0] === "leagues") return {
      id,
      async set(d) { const { name, config } = splitLeague(d); const { error } = await sb.from("leagues").upsert({ id, name, config }); err(error); onWrite("leagues"); },
      async update(patch) {
        const cur = cache.leagues().find((l) => l.id === id) || {};
        const merged = { ...cur, ...patch };
        const { name, config } = splitLeague(merged);
        const { error } = await sb.from("leagues").update({ name, config }).eq("id", id); err(error); onWrite("leagues");
      },
      async delete() { const { error } = await sb.from("leagues").delete().eq("id", id); err(error); onWrite("leagues"); },
    };
    if (p.length === 4 && p[2] === "drivers") {
      const lid = p[1];
      return {
        id,
        async set(d) { const { error } = await sb.from("drivers").upsert({ id, league_id: lid, name: d.name, num: d.num || "", div: d.div || 1, cust: d.cust || null }); err(error); onWrite("drivers"); },
        async update(patch) { const { error } = await sb.from("drivers").update(patch).eq("id", id); err(error); onWrite("drivers"); },
        async delete() { const { error } = await sb.from("drivers").delete().eq("id", id); err(error); onWrite("drivers"); },
      };
    }
    if (p.length === 4 && p[2] === "results") {
      const lid = p[1];
      return {
        id,
        async set(d) { const { error } = await sb.from("results").upsert({ league_id: lid, rid: id, round: d.round, race: d.race, data: d }); err(error); onWrite("results"); },
        async update(patch) {
          const cur = { ...(cache.results()[id] || {}) }; delete cur.id;
          const next = { ...cur, ...patch };
          if (patch.pen) next.pen = { ...(cur.pen || {}), ...patch.pen };
          const { error } = await sb.from("results").update({ data: next, updated_at: new Date().toISOString() }).eq("league_id", lid).eq("rid", id); err(error); onWrite("results");
        },
        async delete() { const { error } = await sb.from("results").delete().eq("league_id", lid).eq("rid", id); err(error); onWrite("results"); },
      };
    }
    throw new Error("Ukjent sti: " + path);
  }

  const db = {
    doc: ref,
    collection: (path) => ({ doc: (id) => ref(path + "/" + (id || uuid())) }),
  };

  async function loadLeagues() {
    const { data, error } = await sb.from("leagues").select("id,name,config,created_at").order("created_at");
    err(error);
    return (data || []).map((r) => ({ ...(r.config || {}), id: r.id, name: r.name, createdAt: r.created_at }));
  }
  async function loadDrivers(lid) {
    const { data, error } = await sb.from("drivers").select("id,name,num,div,cust").eq("league_id", lid).order("name");
    err(error);
    return data || [];
  }
  async function loadResults(lid) {
    const { data, error } = await sb.from("results").select("rid,data").eq("league_id", lid);
    err(error);
    const out = {}; (data || []).forEach((r) => (out[r.rid] = { ...r.data, id: r.rid })); return out;
  }
  async function isAdmin() { const { data, error } = await sb.rpc("is_admin"); if (error) return false; return !!data; }
  async function listAdmins() { const { data, error } = await sb.from("admins").select("email,added_at").order("added_at"); err(error); return data || []; }
  async function addAdmin(email) { const { error } = await sb.from("admins").insert({ email: email.trim().toLowerCase() }); err(error); }
  async function removeAdmin(email) { const { error } = await sb.from("admins").delete().eq("email", email); err(error); }

  function init(client, hooks) { sb = client; onWrite = hooks.onWrite; cache = hooks.cache; }
  return { init, db, loadLeagues, loadDrivers, loadResults, isAdmin, listAdmins, addAdmin, removeAdmin };
})();
