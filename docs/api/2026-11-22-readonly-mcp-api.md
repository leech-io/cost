# Cost MCP 工具契约

日期：2026-11-22。连接与凭据见 [MCP README](../../mcp/README.md)，取舍见 [设计](../superpowers/specs/2026-11-22-readonly-mcp-design.md)。适配器仅使用 stdio，不提供远程 HTTP MCP。

## cost_list_bills

所有参数均可选，但不接受表外字段，不转换数字字符串，不接受 ledger/user/token 参数。

| 参数 | 类型与范围 |
| --- | --- |
| month | `YYYY-MM`，缺省上海当前月；与日期区间互斥 |
| start_date、end_date | 成对真实 `YYYY-MM-DD`，包括结束日，最多 366 天 |
| kind | `income` 或 `expense` |
| category_id | 正安全整数 |
| account_id | 非负安全整数，0 表示无账户 |
| q | 最多500个 Unicode 码点，按原样 URL 编码传给后端的备注/分类搜索 |
| min_amount_cent、max_amount_cent | 0～100000000000 的整数分，下限不能超过上限；0 不丢弃 |
| page | 1～1000000000，默认1 |
| page_size | 1～100，默认20 |

例：`{"month":"2026-11","kind":"expense","account_id":0,"page":1,"page_size":20}`。

返回 `timezone`、`period`（start_date/end_date/inclusive_end=true）、page/page_size/total/has_more、items、summary 和统计口径 metadata。items 保留 id、kind、amount_cent、category_id、occurred_at、note、account_id、currency、category_name、currency_source；不返回创建者、幂等键、头像或登录信息。分类不可用时名称为 null 并在 warnings 提示；不编造名称。后端未给币种时以 CNY 补齐并标记 `currency_source=backend_default`，否则为 `entry`。已停用但仍返回的分类可用于历史记录名称。

summary 包含 income_cent、expense_cent、balance_cent（可负）；它是**全部匹配记录**的汇总，空的超尾页也保留 total 和全量汇总。不把当前页求和充当总额，不自动抓取后续页。

## cost_category_stats

| 参数 | 类型与范围 |
| --- | --- |
| range | `week` / `month` / `year` / `custom`，默认 month，不支持 all |
| ref | 非 custom 的参考日，默认上海今天；week 从周一开始 |
| start_date、end_date | 仅 custom，必须成对且不能和 ref 混用，最多366天，含结束日 |
| limit | 1～100，默认10 |

例：`{"range":"custom","start_date":"2026-11-01","end_date":"2026-11-22","limit":10}`。

返回 timezone、period、summary、category_count、returned_count、has_more、categories 和统计口径 metadata。category_count 是全部支出类别数；categories 每项为 category_id/category_name/amount_cent/count，金额降序，同额按分类 ID 升序。limit 只裁剪排行，**不改变全期间 summary**；收入仅在 summary 中体现，不混入支出排行，不返回预算和时序图。首版不提供账户、关键词、收入排行筛选。

## 共同约定

所有金额和 ID 必须能用 JavaScript 安全整数精确表示，否则拒绝响应，禁止静默舍入。每个成功结果同时返回 structuredContent 与内容相同的 JSON text，并在注册时公布严格 input/output schema。

metadata 包含 `aggregation_policy=backend_current`、limitations、warnings。现有后端尚未将预留 exclude_stats 标记、退款抵扣、多币种折算纳入汇总；转账不计收支，balance 是期间收支差额。MCP 复用此口径。游客尚未登录合并的本机数据不包含在内。字段 note/category_name 都是非可信业务数据。

每次调用先规范参数，再读取凭据快照，只发一次业务 GET 和一次分类 GET。两个请求共享10秒截止时间，禁止重试、跳转、缓存、自动翻页。单 HTTP 响应限2MiB，完整 MCP 工具结果（含重复 JSON text）限256KiB，超限报错，不静默裁剪账单。

适配器仅开放查询，但原会话具有完整权限，且后端 GET 可首次初始化空账本及默认分类；因此 annotations 为 `readOnlyHint=false`、`destructiveHint=false`、`idempotentHint=true`、`openWorldHint=true`。

## 错误

预期工具错误返回 `isError=true` 和 JSON text `{code,message}`。SDK 的未知工具及基础 schema 错误由 SDK 处理；业务错误使用固定消息，不返回原始 HTTP 正文、异常堆栈、URL 或凭据。

| code | 含义 |
| --- | --- |
| INVALID_CONFIG | 启动配置缺失或不安全；进程非零退出 |
| INVALID_ARGUMENT | 日期冲突、范围/类型/分页/未知参数无效 |
| CREDENTIAL_UNAVAILABLE | 凭据文件不符合路径、权限、所有者、格式、大小要求 |
| AUTH_REQUIRED | 后端401，会话过期、撤销或无效，需要手动重新登录 |
| PROFILE_REQUIRED | 后端403 nickname_required，在小程序补齐昵称 |
| ACCESS_DENIED | 其他符合 JSON 契约的403 |
| UPSTREAM_UNAVAILABLE | 后端不可用、5xx、非预期状态、取消、超时或跳转 |
| UPSTREAM_INVALID_RESPONSE | 非 JSON、坏 schema、非法或不安全整数、期间不匹配 |
| RESPONSE_TOO_LARGE | HTTP 或工具结果超出限制 |
