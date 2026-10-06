import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({error:"Method not allowed"}), {status:405,headers:cors});

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response(JSON.stringify({error:"Missing authorization"}), {status:401,headers:cors});

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(url, serviceKey, { auth: { autoRefreshToken:false, persistSession:false } });
  const { data: userData, error: userErr } = await service.auth.getUser(jwt);
  if (userErr || !userData.user) return new Response(JSON.stringify({error:"Invalid session"}), {status:401,headers:cors});

  const adminId = userData.user.id;
  const { data: admin, error: adminErr } = await service.from("admin_users").select("user_id").eq("user_id", adminId).maybeSingle();
  if (adminErr || !admin) return new Response(JSON.stringify({error:"Forbidden"}), {status:403,headers:cors});

  let body:any = {};
  try { body = await req.json(); } catch {}
  if (body.action !== "list") return new Response(JSON.stringify({error:"Unsupported action"}), {status:400,headers:cors});

  const allUsers:any[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    allUsers.push(...(data.users || []));
    if (!data.users || data.users.length < perPage) break;
    page++;
  }

  const { data: tasks, error: taskErr } = await service.from("after_sales_tasks").select("user_id");
  if (taskErr) throw taskErr;
  const counts = new Map<string, number>();
  for (const t of tasks || []) counts.set(t.user_id, (counts.get(t.user_id) || 0) + 1);

  const users = allUsers.map(u => ({
    id: u.id,
    email: u.email ?? "",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    task_count: counts.get(u.id) || 0,
  }));
  users.sort((a,b) => String(b.last_sign_in_at || b.created_at).localeCompare(String(a.last_sign_in_at || a.created_at)));

  return new Response(JSON.stringify({users}), {status:200,headers:cors});
});
