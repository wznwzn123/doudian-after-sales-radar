// 宣传片录屏用的演示数据：店铺、订单、买家都是虚构的，不是真实数据库数据。
const min = 60000, iso = (ms) => new Date(Date.now() + ms).toISOString(), ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const db = {
  shop_stores: [
    { id: "s1", user_id: "u1", name: "演示店铺·家居馆", platform: "抖店", status: "active", created_at: ago(40) },
    { id: "s2", user_id: "u1", name: "演示店铺·数码店", platform: "抖店", status: "active", created_at: ago(35) },
    { id: "s3", user_id: "u1", name: "演示店铺·美妆铺", platform: "抖店", status: "active", created_at: ago(20) },
  ],
  after_sales_tasks: [
    { id: "t1", user_id: "u1", store_id: "s1", order_id: "DEMO-6930012", buyer_name: "王**", tracking_no: "YT7712345678", status: "待举证", submission_status: "pending", risk: "高风险", deadline: iso(42 * min), deadline_at: iso(42 * min), rejection_count: 1, after_sales_type: "仅退款", reason: "买家称未收到货", order_amount: 129, refund_amount: 129, created_at: ago(1) },
    { id: "t2", user_id: "u1", store_id: "s2", order_id: "DEMO-6930025", buyer_name: "李**", tracking_no: "JT0098765432", status: "协商中", submission_status: "pending", risk: "高风险", deadline: iso(118 * min), deadline_at: iso(118 * min), after_sales_type: "退货退款", reason: "商品与描述不符", order_amount: 399, refund_amount: 399, created_at: ago(1) },
    { id: "t3", user_id: "u1", store_id: "s3", order_id: "DEMO-6930031", buyer_name: "张**", tracking_no: "YD4455667788", status: "待处理", submission_status: "pending", risk: "普通", deadline: iso(165 * min), deadline_at: iso(165 * min), after_sales_type: "退货退款", order_amount: 59.9, refund_amount: 59.9, created_at: ago(2) },
    { id: "t4", user_id: "u1", store_id: "s2", order_id: "DEMO-6930047", buyer_name: "赵**", tracking_no: "ST3322110099", status: "仲裁中", submission_status: "pending", risk: "普通", after_sales_type: "仅退款", order_amount: 88, refund_amount: 30, created_at: ago(3) },
    { id: "t5", user_id: "u1", store_id: "s3", order_id: "DEMO-6930058", buyer_name: "孙**", tracking_no: "ZT5566778899", status: "待处理", submission_status: "pending", risk: "普通", deadline: iso(212 * min), deadline_at: iso(212 * min), after_sales_type: "仅退款", order_amount: 76, refund_amount: 76, created_at: ago(2) },
    { id: "t6", user_id: "u1", store_id: "s1", order_id: "DEMO-6930052", buyer_name: "陈**", status: "已完成", submission_status: "submitted_manual", risk: "普通", updated_at: new Date().toISOString(), order_amount: 45, refund_amount: 0, created_at: ago(4) },
  ],
  evidence_files: [
    { id: "f1", user_id: "u1", task_id: "t1", file_name: "发货视频.mp4", mime_type: "video/mp4", storage_path: "u1/tasks/t1/a.mp4", created_at: ago(1) },
    { id: "f2", user_id: "u1", task_id: "t1", file_name: "签收截图.jpg", mime_type: "image/jpeg", storage_path: "u1/tasks/t1/b.jpg", created_at: ago(1) },
    { id: "f3", user_id: "u1", task_id: "t1", file_name: "质检报告.pdf", mime_type: "application/pdf", storage_path: "u1/library/q.pdf", library_id: "l1", created_at: ago(1) },
  ],
  evidence_library: [{ id: "l1", user_id: "u1", file_name: "质检报告.pdf", mime_type: "application/pdf", storage_path: "u1/library/q.pdf", usage_count: 3, created_at: ago(9) }],
  tracking_records: [
    { id: "k1", user_id: "u1", task_id: "t1", tracking_no: "YT7712345678", carrier: "圆通", last_match: "已签收：快件已由本人签收", updated_at: iso(-20 * min), created_at: ago(1) },
    { id: "k2", user_id: "u1", task_id: "t2", tracking_no: "JT0098765432", carrier: "极兔", last_match: "派件中：快递员正在派送", updated_at: iso(-35 * min), created_at: ago(1) },
  ],
  after_sales_events: [
    { id: "e1", user_id: "u1", task_id: "t1", event_type: "rejected_negotiation", message: "拒绝协商：已发货，买家称未收到", created_at: ago(1) },
    { id: "e2", user_id: "u1", task_id: "t1", event_type: "evidence_manual", message: "录入举证：物流签收记录", created_at: iso(-50 * min) },
    { id: "e3", user_id: "u1", task_id: "t1", event_type: "tracking_queried", message: "快递100 查询：已签收", created_at: iso(-20 * min) },
  ],
};
module.exports = { db };
