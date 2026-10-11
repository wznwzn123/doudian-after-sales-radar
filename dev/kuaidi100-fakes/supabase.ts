// Fake @supabase/supabase-js for dev/kuaidi100.handler.test.ts: in-memory tables + RLS-like user filter.
export const state: any = { db: {}, users: { "tok-u1": "u1", "tok-u2": "u2" }, clients: [], admins: [], authUsers: {}, adminCalls: [], rpcs: {}, pk: {}, deny: {}, passwords: {}, signIns: [], signOuts: [], signInError: null };
export function createClient(_url: string, _key: string, opts: any) {
  const auth = opts?.global?.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const uid = state.users[token] || null;
  const secret = String(_key).startsWith("sb_secret_");
  state.clients.push({ key: _key, auth });
  const from = (table: string) => {
    const st: any = { op: "select", f: [], gte: [], like: [], payload: null, maybe: false, order: null, limit: 0 };
    const rows = () => (state.db[table] = state.db[table] || []);
    const visible = (r: any) => secret || r.user_id === uid; // RLS: user_id = auth.uid(); secret key bypasses RLS
    const match = (r: any) => visible(r) && st.f.every(([k, v]: any) => r[k] === v) && st.gte.every(([k, v]: any) => String(r[k]) >= v) && st.like.every(([k, v]: any) => new RegExp("^" + String(v).split("%").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "s").test(String(r[k] ?? "")));
    const run = async () => {
      if (state.deny[table]) return { data: null, error: { message: "permission denied for table " + table } };
      if (st.op === "select") {
        let out = rows().filter(match).map((r: any) => ({ ...r }));
        if (st.order) out.sort((a: any, b: any) => String(a[st.order[0]]).localeCompare(String(b[st.order[0]])) * (st.order[1]?.ascending === false ? -1 : 1));
        if (st.limit) out = out.slice(0, st.limit);
        return st.maybe ? { data: out[0] || null, error: null } : { data: out, error: null };
      }
      if (st.op === "insert") {
        if (!secret && st.payload.user_id !== uid) return { data: null, error: { message: "RLS violation" } };
        const pk = state.pk[table];
        if (pk && rows().some((r: any) => pk.every((k: string) => r[k] === st.payload[k]))) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows().push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...st.payload });
        return { data: null, error: null };
      }
      if (st.op === "update") {
        const hit = rows().filter(match);
        if (table === "tracking_records" && st.payload.last_match === null) return { data: null, error: { message: "not-null" } };
        hit.forEach((r: any) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
      if (st.op === "delete") {
        const keep = rows().filter((r: any) => !match(r));
        state.db[table] = keep;
        return { data: null, error: null };
      }
    };
    const b: any = new Proxy({}, { get(_t, p) {
      if (p === "then") return (res: any, rej: any) => run().then(res, rej);
      return (...a: any[]) => {
        if (p === "select") { /* columns ignored */ }
        else if (p === "eq") st.f.push([a[0], a[1]]);
        else if (p === "gte") st.gte.push([a[0], a[1]]);
        else if (p === "like") st.like.push([a[0], a[1]]);
        else if (p === "order") st.order = a;
        else if (p === "limit") st.limit = a[0];
        else if (p === "maybeSingle") st.maybe = true;
        else if (p === "insert") { st.op = "insert"; st.payload = a[0]; }
        else if (p === "update") { st.op = "update"; st.payload = a[0]; }
        else if (p === "delete") st.op = "delete";
        else throw new Error("fake supabase: unsupported " + String(p));
        return b;
      };
    } });
    return b;
  };
  return {
    from,
    async rpc(name: string, args?: any) {
      if (state.rpcs[name]) return state.rpcs[name](args, uid);
      if (name === "is_admin") return { data: !!uid && state.admins.includes(uid), error: null };
      return { data: null, error: { message: "unexpected rpc " + name } };
    },
    auth: {
      async signInWithPassword(c: any) {
        state.signIns.push({ ...c, key: _key });
        if (state.signInError) return { data: { user: null, session: null }, error: state.signInError };
        const ph = c.phone ? String(c.phone).replace(/^\+/, "") : null;
        const id = Object.keys(state.authUsers).find((k) => (c.email && state.authUsers[k].email === c.email) || (ph && state.authUsers[k].phone === ph));
        if (!id || state.passwords[id] !== c.password) return { data: { user: null, session: null }, error: { message: "Invalid login credentials", code: "invalid_credentials" } };
        return { data: { user: { id }, session: { access_token: "tmp" } }, error: null };
      },
      async signOut(o: any) { state.signOuts.push(o); return { error: null }; },
      async getUser(t: string) { const id = state.users[t]; return id ? { data: { user: { id, ...(state.authUsers[id] || {}) } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }; },
      admin: {
        async getUserById(id: string) {
          if (!secret) return { data: { user: null }, error: { message: "User not allowed" } };
          const u = state.authUsers[id]; return u ? { data: { user: { id, ...u } }, error: null } : { data: { user: null }, error: { message: "User not found" } };
        },
        async updateUserById(id: string, attrs: any) {
          if (!secret) return { data: { user: null }, error: { message: "User not allowed" } };
          state.adminCalls.push({ id, attrs });
          const others = Object.keys(state.authUsers).filter((k) => k !== id);
          const ph = attrs.phone ? String(attrs.phone).replace(/^\+/, "") : null;
          if (ph && others.some((k) => state.authUsers[k].phone === ph)) return { data: { user: null }, error: { message: "A user with this phone number has already been registered" } };
          if (attrs.email && others.some((k) => state.authUsers[k].email === attrs.email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
          const u = state.authUsers[id];
          if (u) {
            if (attrs.password) u.password = attrs.password;
            if (ph) { u.phone = ph; u.phone_confirmed_at = new Date().toISOString(); }
            if (attrs.email) { u.email = attrs.email; u.email_confirmed_at = new Date().toISOString(); }
          }
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
}
