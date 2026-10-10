# 快递100 物流查询（Pro 6.7）

## 怎么工作
手机页面「快递」弹窗 → 点「用快递100查询物流」→ 调用我们自己的 Supabase Edge Function `kuaidi100-query` → 函数在服务端调用快递100 实时查询接口 → 把最新状态写进 `tracking_records.last_match`，并记一条 `tracking_queried` 事件。

- 快递100 的 `customer` 和 `key` **只放在 Supabase 的 Edge Function Secrets**（名字 `KUAIDI100_CUSTOMER`、`KUAIDI100_KEY`），不在前端、不在仓库、不需要发给任何人。
- 函数用「调用者自己的登录身份」读写数据库（受 RLS 限制），只能查自己的售后；函数里**没有用 service_role / secret key**。
- 平台的 JWT 校验关闭（`verify_jwt=false`），函数里用 `auth.getUser()` 自己校验登录。
- 同一售后 30 分钟内只能查一次（快递100 文档说同一单号查询过于频繁会锁单）。签名错误、额度用完这类配置错误不计入，修好可以马上重试。
- 顺丰、中通需要收件人或寄件人手机号后四位：只在查询时临时传给快递100，**不保存**。
- 承运商选「其他」不能查询（不知道快递100 编码）。编码表在 `supabase/functions/kuaidi100-query/lib.ts`，德邦用的是 `debangwuliu`，请以快递100 后台的官方编码表为准核对。
- 只查询、只更新物流状态，**不会自动改售后状态，也不会自动提交举证**。

## 状态
- Edge Function `kuaidi100-query` 已部署到 Supabase（版本 1，ACTIVE）。没填 Secrets 时，登录用户调用会得到「快递100 还没有配置」。
- 前端 6.7（查询按钮）已上线（PR #1）。6.7.1：售后详情顶部直接显示当前物流状态。
- 6.9：按你的要求删掉了「快递盯单」弹窗、快递监控记录卡片和「盯单中」，只保留详情顶部的物流状态。承运商在「新建售后」或详情的「售后信息」里选，选了才能查。顺丰、中通因为要手机号后四位（不保存），目前查不了。
- 6.8：点开售后时自动查一次（同一售后 30 分钟内最多一次，会消耗快递100 额度）。顺丰、中通要手机号后四位，按你的决定不保存，所以这两家只能在「快递盯单」里手动查；承运商「其他」不能查；已签收/退签/拒签的不再自动查。

## 测试（都是假数据，不是对真实快递100 / 真实数据库的测试）
- `node dev/kuaidi100.test.mjs`：签名、请求参数、返回解析（Node ≥ 22.18）。
- `deno test --no-lock --config dev/kuaidi100-fakes/deno.json --allow-env --allow-read dev/kuaidi100.handler.test.ts`：完整跑 `index.ts`，只把 Supabase 客户端和快递100 的 HTTP 请求换成假的。
- `node dev/stage2.test.js index.html`：前端按钮（函数返回值是桩）。

## 官方文档
- 实时快递查询接口：https://api.kuaidi100.com/document/5f0ffb5ebc8da837cbd8aefc
