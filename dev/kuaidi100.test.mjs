// Unit tests for supabase/functions/kuaidi100-query/lib.ts (pure logic, no network, no real 快递100 account).
// Run: node dev/kuaidi100.test.mjs   (Node >= 22.18 strips TypeScript types natively)
import { createHash } from "node:crypto";
const L = await import(new URL("../supabase/functions/kuaidi100-query/lib.ts", import.meta.url));
let bad = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "   <- " + detail}`); };

// sign = MD5(param + key + customer), 32 chars uppercase
const s = L.sign('{"com":"yuantong","num":"YT1"}', "KEY", "CUST");
check("sign: md5(param+key+customer) uppercase hex", s === createHash("md5").update('{"com":"yuantong","num":"YT1"}KEYCUST').digest("hex").toUpperCase() && /^[0-9A-F]{32}$/.test(s), s);
check("sign: utf-8 (Chinese in param)", L.sign("中", "k", "c") === createHash("md5").update(Buffer.from("中kc", "utf8")).digest("hex").toUpperCase());

const r = L.buildRequest({ com: "shunfeng", num: "SF123456", phone: "1234", customer: "CUST", key: "KEY" });
const f = new URLSearchParams(r.body);
check("buildRequest: form fields customer/sign/param", f.get("customer") === "CUST" && f.get("param") === r.param && f.get("sign") === L.sign(r.param, "KEY", "CUST"));
check("buildRequest: param has com/num/phone/resultv2/order", JSON.stringify(JSON.parse(r.param)) === JSON.stringify({ com: "shunfeng", num: "SF123456", resultv2: "4", order: "desc", phone: "1234" }), r.param);
check("buildRequest: key never sent in body", !r.body.includes("KEY"));
check("buildRequest: no phone -> no phone field", !("phone" in JSON.parse(L.buildRequest({ com: "yuantong", num: "YT1", customer: "c", key: "k" }).param)));

check("carrier codes: every non-其他 option mapped", ["顺丰", "中通", "圆通", "申通", "韵达", "极兔", "京东", "邮政EMS", "德邦"].every((c) => /^[a-z]+$/.test(L.CARRIER_CODES[c] || "")) && !L.CARRIER_CODES["其他"]);
check("phone required for 顺丰/中通 only", L.PHONE_REQUIRED.has("shunfeng") && L.PHONE_REQUIRED.has("zhongtong") && !L.PHONE_REQUIRED.has("yuantong"));
check("validPhone", L.validPhone("1234") && L.validPhone("13800138000") && !L.validPhone("123") && !L.validPhone("12345") && !L.validPhone("abcd") && !L.validPhone(""));
check("normalizeNo strips spaces", L.normalizeNo(" SF 12 34 ") === "SF1234" && L.normalizeNo(null) === "");

// success (shape from the official doc)
const ok = L.parseResponse({ message: "ok", state: "0", status: "200", ischeck: "0", com: "yuantong", nu: "YT1",
  data: [{ time: "2026-10-10 14:20:00", ftime: "2026-10-10 14:20:00", context: "已到达上海转运中心" }, { time: "2026-10-09 09:00:00", ftime: "2026-10-09 09:00:00", context: "已揽收" }] });
check("parse ok: state text + latest + count", ok.ok && ok.stateText === "在途" && ok.latest.context === "已到达上海转运中心" && ok.count === 2 && !ok.signed, JSON.stringify(ok));
check("parse ok: last_match text", ok.lastMatch === "【在途】2026-10-10 14:20:00 已到达上海转运中心（快递100）", ok.lastMatch);
const asc = L.parseResponse({ status: "200", state: "3", ischeck: "1", data: [{ ftime: "2026-10-09 09:00:00", context: "揽收" }, { ftime: "2026-10-11 10:00:00", context: "已签收" }] });
check("parse ok: picks newest even if ascending; signed", asc.ok && asc.latest.context === "已签收" && asc.signed && asc.stateText === "签收");
const empty = L.parseResponse({ status: "200", state: "0", data: [] });
check("parse ok: no traces", empty.ok && empty.latest === null && empty.lastMatch.includes("暂无物流轨迹"));
// errors
const e503 = L.parseResponse({ result: false, returnCode: "503", message: "验证签名失败" });
check("parse err 503 -> signature hint", !e503.ok && e503.code === "503" && e503.message.includes("签名"));
const e601 = L.parseResponse({ result: false, returnCode: "601", message: "POLL:KEY已过期" });
check("parse err 601 -> recharge hint", !e601.ok && e601.message.includes("充值"));
const e408 = L.parseResponse({ result: false, returnCode: "408", message: "x" });
check("parse err 408 -> phone hint", !e408.ok && e408.message.includes("手机号"));
const eX = L.parseResponse({ result: false, returnCode: "999", message: "奇怪的错误" });
check("parse err unknown code keeps upstream message", !eX.ok && eX.message.includes("奇怪的错误"));
check("parse garbage", !L.parseResponse(null).ok && !L.parseResponse("x").ok && !L.parseResponse({ status: "200" }).ok);

check("findSecret: exact, then case/space tolerant, value trimmed", L.findSecret({ KUAIDI100_KEY: " k \n" }, "KUAIDI100_KEY") === "k" && L.findSecret({ " kuaidi100_key ": "v" }, "KUAIDI100_KEY") === "v" && L.findSecret({ KUAIDI_KEY: "v" }, "KUAIDI100_KEY") === "");
check("similarSecretNames: names only, never values", JSON.stringify(L.similarSecretNames(["KUAIDI_KEY", "kuaidi-100-customer", "SUPABASE_URL", "OTHER"])) === JSON.stringify(['"KUAIDI_KEY"', '"kuaidi-100-customer"']));
const adv = L.parseResponse({ status: "200", state: "206", ischeck: "0", data: [{ ftime: "2026-10-10 16:18:27", context: "客户地址无人，且无法联系上收件人，投递失败" }] });
check("advanced state code 206 -> 无法联系 (was 未知状态 in production)", adv.ok && adv.stateText === "无法联系" && adv.lastMatch.startsWith("【无法联系】"), JSON.stringify(adv));
const named = L.parseResponse({ status: "200", state: "5", data: [{ ftime: "2026-10-11 09:00:00", context: "已放入驿站", status: "投柜或驿站", statusCode: "501" }] });
check("item status name preferred", named.ok && named.stateText === "投柜或驿站");
const codeOnly = L.parseResponse({ status: "200", state: "3", data: [{ ftime: "2026-10-11 09:00:00", context: "签收", statusCode: "303" }] });
check("item statusCode used when no name", codeOnly.ok && codeOnly.stateText === "代签");
check("unknown sub-code falls back to its group; 100x -> 在途", L.parseResponse({ status: "200", state: "299", data: [] }).stateText === "疑难" && L.parseResponse({ status: "200", state: "1009", data: [] }).stateText === "在途");
console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
