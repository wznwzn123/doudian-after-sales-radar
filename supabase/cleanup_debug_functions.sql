-- 售后雷达：清理调试遗留的测试函数
--
-- 已用真实库（只读查询）核对：这 5 个函数没有被任何触发器、其他函数、RLS 策略或前端代码引用。
--   device_test_user()      SECURITY DEFINER，anon 可执行，只返回 auth.uid()
--   hello_test()            返回 'hello'
--   one_param_test(text)    原样返回参数
--   test_device_function()  返回 {"ok": true}
--   test_security_function() 返回 {"ok": true}
-- 删除它们不影响任何功能，只是去掉多余的、匿名可调用的入口（Supabase 安全检查会提示）。
--
-- 状态：待在 Supabase SQL Editor 手动执行（本文件不会被前端或自动流程运行）。
-- 回滚：这些只是测试函数，不需要回滚；如确需恢复，按上面的说明重新创建即可。

drop function if exists public.device_test_user();
drop function if exists public.hello_test();
drop function if exists public.one_param_test(text);
drop function if exists public.test_device_function();
drop function if exists public.test_security_function();
