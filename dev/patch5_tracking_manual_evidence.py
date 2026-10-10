import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()


def once(text, old, new, label):
    n = text.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, got {n}"
    return text.replace(old, new)


# ---------- version 6.5 -> 6.6
src = once(src, "<title>售后雷达 Pro 6.5</title>", "<title>售后雷达 Pro 6.6</title>", "title")
src = once(src, '<div class="title">售后雷达 Pro 6.5</div>', '<div class="title">售后雷达 Pro 6.6</div>', "login title")
src = once(src, "Pro 6.5 · 云端工作台", "Pro 6.6 · 云端工作台", "app sub")
src = once(src, 'const APP_VERSION="6.5.0";', 'const APP_VERSION="6.6.0";', "app version")

# ---------- replace the prompt-based tracking(id) (its upsert used onConflict:"task_id" but the table has no unique
#            constraint on task_id, so it errored silently and never wrote a tracking record)
a = src.index("async function tracking(id){")
b = src.index("async function deleteTask(id){")
assert a < b and src.count("async function tracking(id){") == 1
NEWTRACK = r'''const CARRIERS=["顺丰","中通","圆通","申通","韵达","极兔","京东","邮政EMS","德邦","其他"];
/* tracking_records 表没有 task_id 唯一约束，不能用 upsert(onConflict)；先查再改/插 */
async function saveTrackingRecord(taskId,f){const ex=await sb.from("tracking_records").select("id").eq("task_id",taskId).order("created_at",{ascending:true}).limit(1);if(ex.error)return ex;const rid=Array.isArray(ex.data)?ex.data[0]?.id:null;const row={...f,updated_at:new Date().toISOString()};return rid?sb.from("tracking_records").update(row).eq("id",rid):sb.from("tracking_records").insert({user_id:session.user.id,task_id:taskId,...row})}
async function tracking(id){const t=tasks.find(x=>x.id===id);if(!t)return toast("售后不存在");const r=await sb.from("tracking_records").select("*").eq("task_id",id).order("created_at",{ascending:true}).limit(1);const rec=Array.isArray(r.data)?r.data[0]:null;const no=t.tracking_no||rec?.tracking_no||"";$("modalbox").innerHTML='<div class="actions" style="justify-content:space-between"><b>快递盯单</b><button class="btn" onclick="closeModal()">关闭</button></div><div class="notice" style="margin:8px 0">手动录入快递单号并记录物流状态。目前不会自动查询物流，状态由你手动记录；以后接入快递接口后会自动更新。</div><input id="tk_no" class="input" placeholder="快递单号" value="'+esc(no)+'"><select id="tk_carrier" style="margin-top:7px">'+optList(CARRIERS,rec?.carrier||"顺丰")+'</select><label class="muted" style="display:block;margin:8px 0"><input id="tk_mon" type="checkbox"'+((rec?rec.monitoring:t.monitoring!==false)?" checked":"")+'> 持续盯单（首页「盯单中」会统计）</label><div class="muted">最近物流状态（手动记录）</div><textarea id="tk_match" rows="3" placeholder="例如：10-10 14:20 已到达上海转运中心">'+esc(rec?.last_match||"")+'</textarea><div class="actions" style="margin-top:8px"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveTracking(\''+id+'\')">保存</button></div>';$("modal").classList.remove("hidden")}
async function saveTracking(id){const t=tasks.find(x=>x.id===id);if(!t)return toast("售后不存在");const no=($("tk_no").value||"").replace(/\s+/g,"");if(!/^[A-Za-z0-9\-]{6,40}$/.test(no))return toast("请输入正确的快递单号（6-40 位字母、数字或横线）");const carrier=$("tk_carrier").value,mon=$("tk_mon").checked,match=($("tk_match").value||"").trim();const u=await sb.from("after_sales_tasks").update({tracking_no:no,monitoring:mon,updated_at:new Date().toISOString()}).eq("id",id);if(u.error)return toast(u.error.message);const s=await saveTrackingRecord(id,{tracking_no:no,carrier,monitoring:mon,last_match:match});if(s.error)return toast("盯单记录保存失败："+s.error.message);await sb.from("after_sales_events").insert({user_id:session.user.id,task_id:id,event_type:"tracking_updated",message:"快递 "+carrier+" "+no+(mon?"，持续盯单":"，停止盯单")+(match?"；物流：" +match:"")});closeModal();await refresh();openTask(id);toast("快递盯单已保存")}
/* ---------- 手动录入举证：原因 / 补充说明 / 视频；只保存，不自动提交 ---------- */
function manualEvidence(id){const t=tasks.find(x=>x.id===id);if(!t)return toast("售后不存在");$("modalbox").innerHTML='<div class="actions" style="justify-content:space-between"><b>手动录入举证</b><button class="btn" onclick="closeModal()">关闭</button></div><div class="notice" style="margin:8px 0">举证内容由你自己填写，系统只负责保存、提醒和管理提交状态，不会替你向平台提交。</div><div class="muted">举证原因（事实、时间线、你的诉求）</div><textarea id="me_reason" rows="5">'+esc(t.evidence_reason)+'</textarea><div class="muted" style="margin-top:8px">补充说明（保存时带时间追加在举证原因后面）</div><textarea id="me_extra" rows="3" placeholder="例如：买家后来又提出……"></textarea><div class="muted" style="margin-top:8px">视频</div><div class="actions"><button class="btn blue" onclick="pickEvidence(\'video\')">选择视频上传</button></div><input id="me_video" class="input" style="margin-top:7px" placeholder="视频说明或网盘链接（可选）"><div class="actions" style="margin-top:8px"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveManualEvidence(\''+id+'\')">保存</button></div>';$("modal").classList.remove("hidden")}
async function saveManualEvidence(id){const t=tasks.find(x=>x.id===id);if(!t)return toast("售后不存在");const reason=($("me_reason").value||"").trim(),extra=($("me_extra").value||"").trim(),video=($("me_video").value||"").trim();if(!reason&&!extra&&!video)return toast("请至少填写一项内容");let text=reason;const stamp=fmt(new Date().toISOString());if(extra)text+=(text?"\n\n":"")+"【补充 "+stamp+"】"+extra;if(video)text+=(text?"\n\n":"")+"【视频 "+stamp+"】"+video;const r=await sb.from("after_sales_tasks").update({evidence_reason:text,updated_at:new Date().toISOString()}).eq("id",id);if(r.error)return toast(r.error.message);const parts=[reason&&reason!==(t.evidence_reason||"").trim()?"举证原因":"",extra?"补充说明":"",video?"视频说明":""].filter(Boolean);await sb.from("after_sales_events").insert({user_id:session.user.id,task_id:id,event_type:"evidence_manual",message:"手动录入举证："+(parts.join("、")||"无变化")});closeModal();await refresh();openTask(id);toast("举证内容已保存（未提交）")}
'''
src = src[:a] + NEWTRACK + src[b:]

# ---------- detail: button for manual evidence entry
src = once(
    src,
    '<button class="btn" onclick="rejectNegotiation(\'${id}\')">拒绝协商</button>',
    '<button class="btn" onclick="rejectNegotiation(\'${id}\')">拒绝协商</button><button class="btn blue" onclick="manualEvidence(\'${id}\')">录入举证内容</button>',
    "manual evidence button",
)

# ---------- createTask: write the tracking record when a number is given
src = once(
    src,
    'monitoring:!!$("tt").value};let r=await sb.from("after_sales_tasks").insert(row).select().single();if(r.error)return toast(r.error.message);closeModal();',
    'monitoring:!!$("tt").value};let r=await sb.from("after_sales_tasks").insert(row).select().single();if(r.error)return toast(r.error.message);if(row.tracking_no){const s=await saveTrackingRecord(r.data.id,{tracking_no:row.tracking_no,monitoring:true});if(s.error)toast("盯单记录保存失败："+s.error.message)}closeModal();',
    "createTask tracking record",
)

# ---------- saveTask: keep the tracking record in step when the number is edited
src = once(
    src,
    'if(r.error)return toast(r.error.message);await sb.from("after_sales_events").insert({user_id:session.user.id,task_id:id,event_type:"task_saved",message:"更新售后信息"});',
    'if(r.error)return toast(r.error.message);if(patch.tracking_no&&patch.tracking_no!==(current?.tracking_no||"")){const s=await saveTrackingRecord(id,{tracking_no:patch.tracking_no});if(s.error)toast("盯单记录同步失败："+s.error.message)}await sb.from("after_sales_events").insert({user_id:session.user.id,task_id:id,event_type:"task_saved",message:"更新售后信息"});',
    "saveTask tracking sync",
)
# saveTask reads `current` after the awaited update; capture the old number first
src = once(
    src,
    'const id=current.id;const r=await sb.from("after_sales_tasks").update(patch).eq("id",id);',
    'const id=current.id,oldNo=current.tracking_no||"";const r=await sb.from("after_sales_tasks").update(patch).eq("id",id);',
    "saveTask oldNo",
)
src = once(src, 'patch.tracking_no!==(current?.tracking_no||"")', 'patch.tracking_no!==oldNo', "saveTask oldNo use")

open(path, "w", encoding="utf-8").write(src)
print("patched OK, bytes:", len(src.encode("utf-8")))
