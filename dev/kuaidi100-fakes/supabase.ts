// Fake @supabase/supabase-js for dev/kuaidi100.handler.test.ts: in-memory tables + RLS-like user filter.
export const state: any = { db: {}, users: { "tok-u1": "u1", "tok-u2": "u2" }, clients: [] };
export function createClient(_url: string, _key: string, opts: any) {
  const auth = opts?.global?.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const uid = state.users[token] || null;
  state.clients.push({ key: _key, auth });
  const from = (table: string) => {
    const st: any = { op: "select", f: [], gte: [], payload: null, maybe: false, order: null, limit: 0 };
    const rows = () => (state.db[table] = state.db[table] || []);
    const visible = (r: any) => r.user_id === uid; // RLS: user_id = auth.uid()
    const match = (r: any) => visible(r) && st.f.every(([k, v]: any) => r[k] === v) && st.gte.every(([k, v]: any) => String(r[k]) >= v);
    const run = async () => {
      if (st.op === "select") {
        let out = rows().filter(match).map((r: any) => ({ ...r }));
        if (st.order) out.sort((a: any, b: any) => String(a[st.order[0]]).localeCompare(String(b[st.order[0]])) * (st.order[1]?.ascending === false ? -1 : 1));
        if (st.limit) out = out.slice(0, st.limit);
        return st.maybe ? { data: out[0] || null, error: null } : { data: out, error: null };
      }
      if (st.op === "insert") {
        if (st.payload.user_id !== uid) return { data: null, error: { message: "RLS violation" } };
        rows().push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...st.payload });
        return { data: null, error: null };
      }
      if (st.op === "update") {
        const hit = rows().filter(match);
        if (table === "tracking_records" && st.payload.last_match === null) return { data: null, error: { message: "not-null" } };
        hit.forEach((r: any) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
    };
    const b: any = new Proxy({}, { get(_t, p) {
      if (p === "then") return (res: any, rej: any) => run().then(res, rej);
      return (...a: any[]) => {
        if (p === "select") { /* columns ignored */ }
        else if (p === "eq") st.f.push([a[0], a[1]]);
        else if (p === "gte") st.gte.push([a[0], a[1]]);
        else if (p === "order") st.order = a;
        else if (p === "limit") st.limit = a[0];
        else if (p === "maybeSingle") st.maybe = true;
        else if (p === "insert") { st.op = "insert"; st.payload = a[0]; }
        else if (p === "update") { st.op = "update"; st.payload = a[0]; }
        else throw new Error("fake supabase: unsupported " + String(p));
        return b;
      };
    } });
    return b;
  };
  return {
    from,
    auth: { async getUser(t: string) { const id = state.users[t]; return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }; } },
  };
}
