// 快递100 实时查询的纯逻辑（无 Deno/网络依赖，方便在 Node 里测试）。
// 官方文档：https://api.kuaidi100.com/document/5f0ffb5ebc8da837cbd8aefc
import { createHash } from "node:crypto";

export const QUERY_URL = "https://poll.kuaidi100.com/poll/query.do";

// 前端承运商下拉框里的名字 -> 快递100 公司编码（小写）
export const CARRIER_CODES: Record<string, string> = {
  "顺丰": "shunfeng",
  "中通": "zhongtong",
  "圆通": "yuantong",
  "申通": "shentong",
  "韵达": "yunda",
  "极兔": "jtexpress",
  "京东": "jd",
  "邮政EMS": "ems",
  "德邦": "debangwuliu",
};
// 快递100 要求这些公司带收/寄件人电话
export const PHONE_REQUIRED = new Set(["shunfeng", "zhongtong"]);

// 基本状态 + 高级状态（resultv2=4 时 state / statusCode 可能是细分码，例如 206 无法联系）。官方文档原文名称
export const STATE_TEXT: Record<string, string> = {
  "0": "在途", "1": "揽收", "2": "疑难", "3": "签收", "4": "退签", "5": "派件", "6": "退回", "7": "转投",
  "8": "清关", "10": "待清关", "11": "清关中", "12": "已清关", "13": "清关异常", "14": "拒签",
  "101": "已下单", "102": "待揽收", "103": "已揽收",
  "1001": "到达派件城市", "1002": "干线", "1003": "转递",
  "501": "投柜或驿站",
  "301": "本人签收", "302": "派件异常后签收", "303": "代签", "304": "投柜或站签收",
  "401": "已销单",
  "201": "超时未签收", "202": "超时未更新", "203": "拒收", "204": "派件异常", "205": "柜或驿站超时未取",
  "206": "无法联系", "207": "超区", "208": "滞留", "209": "破损", "210": "销单",
};
// 细分码归到大类（只在没有名称时兜底）
function stateName(code: string): string {
  if (STATE_TEXT[code]) return STATE_TEXT[code];
  if (/^100\d$/.test(code)) return STATE_TEXT["0"];
  if (/^\d{3}$/.test(code)) return STATE_TEXT[code[0]] || "";
  return "";
}

// 账号/配置类错误（不是这个单号的问题）
export const CONFIG_ERRORS = new Set(["503", "601", "501", "502"]);

// 同一单号两次查询至少间隔 30 分钟（快递100 文档：过于频繁会锁单）
export const MIN_INTERVAL_MS = 30 * 60 * 1000;

export function sign(param: string, key: string, customer: string): string {
  return createHash("md5").update(param + key + customer, "utf8").digest("hex").toUpperCase();
}

export function normalizeNo(no: unknown): string {
  return String(no ?? "").replace(/\s+/g, "");
}

export function validPhone(phone: unknown): boolean {
  return /^(\d{4}|1\d{10})$/.test(String(phone ?? ""));
}

export function buildRequest(o: { com: string; num: string; phone?: string; customer: string; key: string }) {
  const p: Record<string, string> = { com: o.com, num: o.num, resultv2: "4", order: "desc" };
  if (o.phone) p.phone = o.phone;
  const param = JSON.stringify(p);
  const body = new URLSearchParams({ customer: o.customer, sign: sign(param, o.key, o.customer), param });
  return { param, body: body.toString() };
}

export type Parsed =
  | { ok: true; state: string; stateText: string; signed: boolean; latest: { time: string; context: string } | null; count: number; lastMatch: string }
  | { ok: false; code: string; message: string };

const ERRORS: Record<string, string> = {
  "400": "请求有误（快递公司或单号不对，或快递100账号未充值）",
  "408": "电话号码校验未通过，请核对收/寄件人手机号后四位",
  "500": "暂时查不到物流信息（可能还没揽收，或单号/快递公司不对）",
  "501": "快递100 服务器错误，请稍后再试",
  "502": "快递100 服务器繁忙，请稍后再试",
  "503": "签名验证失败，请检查 Supabase 里填的 customer 和 key",
  "504": "查询太频繁，请稍后再试（同一单号建议间隔 30 分钟以上）",
  "601": "快递100 账号额度已用完或 key 已过期，请到快递100 后台充值",
};

export function parseResponse(j: any): Parsed {
  if (!j || typeof j !== "object") return { ok: false, code: "bad_response", message: "快递100 返回内容无法识别" };
  if (j.result === false || (j.returnCode && String(j.status ?? "") !== "200")) {
    const code = String(j.returnCode ?? "unknown");
    return { ok: false, code, message: ERRORS[code] || ("快递100 返回错误：" + (j.message || code)) };
  }
  if (String(j.status) !== "200" || !Array.isArray(j.data)) return { ok: false, code: String(j.status ?? "unknown"), message: "快递100 返回错误：" + (j.message || "未知") };
  const state = String(j.state ?? "");
  const items = j.data as any[];
  // 默认 order=desc，最新在前；保险起见按时间取最大
  const latest = items.reduce((a: any, b: any) => (!a || String(b.ftime || b.time) > String(a.ftime || a.time) ? b : a), null);
  // 优先用最新一条轨迹自带的中文状态名，其次按状态码查表
  const stateText = (latest && String(latest.status || "").trim()) || stateName(String(latest?.statusCode ?? "")) || stateName(state) || "未知状态";
  const l = latest ? { time: String(latest.ftime || latest.time || ""), context: String(latest.context || "") } : null;
  const lastMatch = "【" + stateText + "】" + (l ? l.time + " " + l.context : "暂无物流轨迹") + "（快递100）";
  return { ok: true, state, stateText, signed: String(j.ischeck) === "1", latest: l, count: items.length, lastMatch };
}

// 按名称读 Secret：先精确匹配，再容忍大小写和前后空格；值去掉首尾空白
export function findSecret(env: Record<string, string>, name: string): string {
  if (env[name] !== undefined) return String(env[name]).trim();
  const k = Object.keys(env).find((n) => n.trim().toUpperCase() === name);
  return k ? String(env[k]).trim() : "";
}

// 诊断用：列出看起来像快递100 的 Secret「名称」（绝不返回值）
export function similarSecretNames(names: string[]): string[] {
  return names.filter((n) => /kuai\s*di|kd100|快递/i.test(n)).map((n) => JSON.stringify(n)).slice(0, 6);
}
