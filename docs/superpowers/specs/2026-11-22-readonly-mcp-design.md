# Cost 只读 MCP 设计

日期：2026-11-22
状态：用户已确认设计及实施计划，已在 `feat/readonly-mcp` 实施；验证与实际接入状态见[验证记录](../../ops/2026-11-22-readonly-mcp-validation.md)。
代码基线：`9020b910266899d7ff5f6ed1fa241018b37a5946`
实施计划：[只读 MCP 实施计划](../plans/2026-11-22-readonly-mcp.md)

## 目标与确认边界

为 Codex、支持本地 stdio MCP 的 DeepSeek 客户端等提供两个只读能力：查询账单、查询支出分类统计。用户已选择“本机启动 MCP，连接现有 cost 后端”，并明确允许复用后端首次自动初始化空账本和默认分类的行为；不允许新增、修改或删除账单。用户随后明确批准完整设计和实施计划，授权开始开发。

最初规划阶段仅创建设计、计划和索引；获批后在 `feat/readonly-mcp` 分支实现。规划时的未跟踪文件 `deploy/compose.desktop.yaml` 原样保留。不访问真实账本、不配置真实客户端、不提交或推送、不部署。

## 现有代码与口径

| 证据文件 | 现状与设计影响 |
| --- | --- |
| `backend/go.mod` | 后端为 Go 1.23 模块；MCP 适配不应牵动后端工具链。 |
| `backend/internal/api/p0.go` 的 `entryFilter`、`filteredList` | GET `/api/v1/entries` 已支持日期、收支类型、分类、账户、关键词、金额和分页；日期尾日包含，页大小最大 100。 |
| `backend/internal/store/p0_mysql.go` 的 `Query` | 查询使用参数化 SQL、按账本隔离，排除软删除；按发生时间和 ID 降序；汇总面向全部匹配项而非当前页。 |
| `backend/internal/api/api.go` 的 `stats` | GET `/api/v1/stats` 返回期间汇总、序列和支出分类排行；GET `/api/v1/categories` 提供名称。 |
| `backend/internal/domain/domain.go`、`stats.go` | 金额为整数分；分类统计仅支出；转账单独建模，不计收支；时间按 Asia/Shanghai。`StatsFrom` 实际输出的 end 是包含尾日的展示日期，不能仅凭字段注释解释成开区间。 |
| `backend/internal/domain/domain.go` 的 `Summarize` | 当前汇总未应用预留的 `exclude_stats`、退款抵扣或多币种换算。MCP 首版复用现有口径，不悄悄修正或声称具备这些能力。 |
| `backend/internal/api/api.go`、`auth/auth.go`、`auth/mysql.go` | 正常模式使用 64 位十六进制 Bearer 会话，登录后 7 天过期，服务端校验撤销和所属账本。开发模式单独使用 X-Dev-Token，production 禁用开发鉴权。 |
| `miniprogram/utils/api.js` | 微信登录结果保存在开发者工具的 `cost_session`；首版凭据由用户自行取用，不扫描或自动抽取其他程序的登录数据。 |
| `.github/workflows/ci-cd.yml`、`scripts/plan-ci.py` | CI 已使用 Node 24；未识别的新目录默认可能触发生产部署，需要显式把仅本机使用的 `mcp/` 变更归为检查，不部署。 |

### 只读边界与已确认的初始化例外

`api.go` 每次鉴权后会调用 `LedgerForUser`。`store/mysql.go` 与 `store/store.go` 在该用户没有账本时，会自动创建空账本及默认分类；已有账本不会因此新增账单。用户已明确允许这一现有初始化行为。本首版“只读”是账单操作只读，不是数据库绝对零写入，不能把 GET 白名单当作后者的证明。不改动、不删除既有账单、预算、账户或分类；允许的分类写入仅为原后端首次初始化。

严格禁止初始化需要另设只查账本的后端路径，用户本次未选择该方案，不在实施中扩展。测试应覆盖首次初始化一次、重复查询不重复初始化，以及读取不改动既有账单。

## 方案比较与选择

| 方案 | 收益 | 代价与结论 |
| --- | --- | --- |
| 本机 stdio 适配器 → 现有 HTTP API | 复用现有身份、账本隔离和业务口径；不持有 DB 凭据，不改后端，无新监听端口。 | 需要现有后端可访问，微信会话需更新。用户已选连接形态；推荐。 |
| 本机 MCP 直连 Store/MySQL | 可少一层 HTTP。 | 必须自行处理用户身份，现有 Store 未绑定账本时会回退 1；还需分发数据库凭据。首版不采用。 |
| 云端 Streamable HTTP MCP | 客户端可通过 URL 连接。 | 需要独立授权、部署和服务端 MCP 端点；超出用户已选的首版范围。 |

推荐在仓库新增独立 `mcp/` Node.js ESM 包，用官方 `@modelcontextprotocol/sdk`，复用仓库已有 JavaScript 语言与 CI Node 环境，不手写 JSON-RPC。后端 Go 模块不加依赖。官方 Go SDK 当前 main 的 go.mod 要求 Go 1.26，直接追随 main 会扩大本次变更；不因此升级 Go。采用 JavaScript `.mjs` 与 JSDoc，首版不再引入 TypeScript 编译链。

依赖提案：`@modelcontextprotocol/sdk` 固定 `1.32.2`、`zod` 固定 `4.6.7`，使用 lockfile 固定依赖树；它们是经核对的兼容版本候选，不声称为最新版本。实施时验证发布包及依赖审计；若需要改变直接依赖或主要技术方案，回到用户确认。项目运行要求 Node >=22.16，CI 沿用现有 Node 24；本机已发现 Node 26.13.0。规划阶段不安装依赖。

## 组件与数据流

```text
AI 客户端
  └─ stdio → node <cost>/mcp/src/index.mjs
                 ├─ 配置与本机凭据文件
                 ├─ 工具参数和返回结构校验
                 └─ 固定 GET API → 现有 Cost 后端 → 原鉴权/账本隔离 → 原 Store
```

- 只注册 `cost_list_bills`、`cost_category_stats`，不提供通用 HTTP、SQL、登录、导出或写入工具。
- HTTP 访问仅允许固定 GET 路径 `/api/v1/entries`、`/api/v1/stats`、`/api/v1/categories`；用户工具入参不能选择目标主机、任意路径、请求方法、请求头或 ledger/user ID。
- Node 客户端不自动重定向；不执行 shell 命令；stdout 只输出 MCP 消息，错误及日志只写 stderr 且不包含凭据和账单正文。
- 每次工具调用共享 10 秒截止时间；每个 HTTP 响应最大 2 MiB，最终工具结果最大 256 KiB；超限返回明确错误，不默默截断、不自动抓取全部页。首版不做自动重试或结果缓存。

## 工具契约

### cost_list_bills 查询账单

参数（严格校验，拒绝未知字段）：

| 参数 | 规则 |
| --- | --- |
| `month` | 可选 `YYYY-MM`；与 start_date/end_date 二选一。均省略时为北京时间当前月，并在结果回显解析后的期间。 |
| `start_date`、`end_date` | 必须成对提供，真实日历日期 `YYYY-MM-DD`，年份 1000–9999，尾日包含；起始不晚于结束，最多 366 天。不能同时传 month。 |
| `kind` | 可选 `income` 或 `expense`。 |
| `category_id` | 可选，正的 JS 安全整数；只能交由服务端在当前会话账本下查询。 |
| `account_id` | 可选，非负 JS 安全整数，0 表示未关联账户。 |
| `q` | 可选，最多 500 个 Unicode 字符；原 API 按备注或分类名的字面子串匹配，不是 SQL、正则或 AI 语义查询。 |
| `min_amount_cent`、`max_amount_cent` | 可选整数分，范围 0–100000000000；同时提供时 min <= max；0 不能当作未提供。 |
| `page`、`page_size` | page 默认 1，范围 1–1000000000；page_size 默认 20，范围 1–100。超出尾页返回空列表，不重置页码。 |

HTTP 映射：把已归一化参数送入 GET `/api/v1/entries`，再 GET `/api/v1/categories` 补齐名称。不向 AI 暴露 client_request_id、created_by、退款关联等无关内部字段。

返回：`timezone`、`period {start_date,end_date,inclusive_end:true}`、`page`、`page_size`、`total`、`has_more`、`items`、`summary {income_cent,expense_cent,balance_cent}`。items 包含 `id`、`kind`、`amount_cent`、原样 `currency`（缺失时标记为 backend 默认 CNY）、`occurred_at`、`note`、`category_id`、`category_name`、`account_id`。保留原发生时间带时区值，显示归属日按北京时间。名称缺失时返回 null 和 warning，不编造分类，也不扩大查询账本。

summary 直接取原 API 全部匹配项汇总，不将当前页合计冒充总额；不输出原响应的 categories/days 等未要求字段（memory 与 MySQL 的 Query 汇总细节不同）。结果附 `aggregation_policy:"backend_current"` 和口径说明，summary 不声称已经做多币种折算。所有金额、ID、总笔数经 JS 安全整数验证，超出安全范围时明确失败，不能输出失真数字。

### cost_category_stats 支出分类统计

参数：`range` 为 `week|month|year|custom`，默认 month；week/month/year 可给 `ref`（真实 `YYYY-MM-DD`），缺省为北京时间今天。custom 必须给 start_date/end_date，且不允许 ref；非 custom 拒绝 start_date/end_date。custom 尾日包含、最多 366 天。首版不开放 all，避免无界历史扫描；`limit` 默认 10、范围 1–100；不接受 kind=income、账户或关键词等原 stats API 不支持的筛选。

映射：GET `/api/v1/stats` 加 GET `/api/v1/categories`。直接取 summary、categories，不用账单分页重新计算统计。去掉 series 和 budget；按 amount_cent 降序、同额按 category_id 升序确定排名。返回 `timezone`、`period`、`summary`、`category_count`、`returned_count`、`has_more`、`categories [{category_id,category_name,amount_cent,count}]`、口径说明。limit 只裁剪分类排行，不改变全部分类总数和 summary。无数据时金额为 0、列表为空；余额仅指期间收入减支出，不是资金账户余额。

仅支出分类排行，summary 可同时显示期间收入和支出。需收入分类排行、任意组合过滤或跨期比较时，作为后续独立设计，不悄悄扩展首版接口。

两个工具均声明 inputSchema 和 outputSchema，通过 `structuredContent` 返回数据并在 text content 提供同一 JSON 供兼容客户端使用。由于已知首次查询可能初始化账本，两个工具保守声明 `readOnlyHint:false`、`destructiveHint:false`、`idempotentHint:true`、`openWorldHint:true`；工具说明写明只查询账单、允许首次空账本初始化。不能为了客户端免确认而虚报严格只读。注解不替代权限控制，幂等也不表示不同时间查询结果不变。

## 配置与身份

| 环境变量 | 规则 |
| --- | --- |
| `COST_MCP_BASE_URL` | 必填，只能为 origin，无 path/query/fragment/userinfo。允许 HTTPS；HTTP 仅允许 localhost、127.0.0.1 或 [::1]，不允许局域网明文。无默认生产地址。 |
| `COST_MCP_AUTH_MODE` | `session`（默认）或 `development`。不从 backend/.env 自动猜测，不混用两种凭据。 |
| `COST_MCP_CREDENTIALS_FILE` | 必填绝对路径，仓库外、当前用户所有、非软链接、普通文件、POSIX 权限仅限本人读写（0400/0600）。文件最大 4 KiB，每次工具调用读取以支持替换。 |

凭据格式：`{"token":"<由用户本机填写，不写入文档或配置示例>"}`。session 模式校验为 64 位十六进制字符串并映射 Authorization Bearer；development 模式使用非空 token 映射 X-Dev-Token，且目标必须是 loopback HTTP。文件不接受任意请求头、命令、URL 或数据库配置。示例客户端配置只包含凭据文件路径，不包含真实 token。

用户手动在已登录的微信开发者工具中取得当前 backend 对应的 `cost_session.token`，在本机独立凭据文件中保存；不会读取备份、其他用户目录、数据库或聊天记录来获取 token。会话约 7 天过期，401 时重新微信登录并更新本地文件；MCP 不调用登录、自动刷新或伪造身份。403 nickname_required 指示用户在现有小程序完成账户信息，MCP 不替用户修改昵称。无开发令牌回退；production 也不降级。

此设计通过工具注册及固定 GET API 限制账单操作，允许前述已确认的后端初始化例外；复用的微信 token 本身是原有全功能会话，不是服务端只读 scope 的专用 token。获得凭据文件的本机程序可能通过原 API 发起其他操作，因此凭据不传给工具参数、AI 回复、Git 或日志；独立服务端只读 token/OAuth 留到后续版本。当前小程序游客数据只在本机，未登录合并的数据不会出现在此 MCP 中。

列表与分类名称为两次请求，不保证分类重命名的跨请求快照一致。金额、笔数由单次后端查询得到，MCP 不把多次请求拼成财务审计级快照。当前后台汇总的多币种、exclude_stats、退款边界只做如实说明，不宣称已修复。

## 错误处理

配置错误在启动时输出脱敏错误到 stderr 并退出非零；凭据不存在、权限不符或变更为非法时，当前工具失败且不请求后端。协议/参数错误由 SDK 和 schema 处理；业务/网络错误返回 `isError:true` 与稳定 code/message，不伪装成 0 元或空账单。

错误码：`INVALID_ARGUMENT`、`CREDENTIAL_UNAVAILABLE`、`AUTH_REQUIRED`（401）、`PROFILE_REQUIRED`（403 nickname_required）、`ACCESS_DENIED`（其余 403）、`UPSTREAM_UNAVAILABLE`（5xx/连接失败/超时）、`UPSTREAM_INVALID_RESPONSE`（非 JSON、结构或数字非法）、`RESPONSE_TOO_LARGE`。上游消息仅按固定白名单映射，绝不透传 HTML、token、请求头或含 URL 的内部异常。取消或 stdin 关闭终止当前请求并退出，不留后台服务。

## 文件与部署影响

新增 `mcp/package.json`、`package-lock.json`、`.env.example`、`README.md`、`src/`、`tests/`、`tests/fixtures/`。不改 `backend/go.mod`、MySQL schema、小程序业务、生产 Docker/Compose 或用户的 compose.desktop.yaml。

CI 增加独立 MCP 测试 job（Node 24 + npm ci + npm test），不依赖真实 MySQL或个人凭据；部署 planning 逻辑将 `mcp/` 变化识别为无需服务器部署，并添加回归测试。这样也避免修改 CI job 的依赖让 MCP-only 变更走入生产发布。旧后端、部署脚本和小程序检查仍保留。

## 验收标准

- 实际 stdio 子进程完成 initialize、tools/list、两个 tools/call，且只发现两个查询工具，注解如实标记首次初始化副作用；stdout 无杂质。
- 日期边界、分页、0 值、分类名、金额和全量 summary 与既有 API 口径一致，不依靠模型算账。
- 超时、401、403、5xx、非 JSON、超大响应、缺凭据/权限错误、重定向均有确定错误，日志不泄露凭据或账单正文。
- 所有工具触发的上游调用仅为三个固定 GET 路径；拒绝任意 URL、方法、身份和未知参数；只使用合成数据测试。
- MCP-only 变更在 CI 运行检查但不触发生产部署；混合 backend/runtime 变更仍保持原有部署判断。
- 提供 Codex TOML 和通用 MCP 客户端 JSON 示例，说明适用支持 stdio 的客户端，配置只给本地路径和占位值。真实账本联调与客户端接入另行征得用户明确同意后进行。

## 参考资料

- [MCP stdio 协议](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)：stdin/stdout 仅协议消息，日志走 stderr。
- [MCP 工具与结构化结果](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。
- [官方 JS/TS SDK v1.32.2](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.32.2)。
- [官方 Go SDK 工具链要求](https://github.com/modelcontextprotocol/go-sdk/blob/main/go.mod)：main 会变化，实施时重新核对；本设计不升级后端。

## 用户确认记录

本机 stdio 连接方式及首次空账本/默认分类初始化例外先获局部确认。用户随后明确回复“设计和实施计划我确认了”，批准在功能分支开发。实际测试和接入状态单独记录在验证文档中；没有提交、推送或上线。

## 2026-11-22 实施授权与依赖修订

用户已明确批准完整设计和计划，授权在功能分支开发，保留既有改动，先交付验证结果，不推送或部署。原 SDK 1.29.0 / Zod 3.25.76 的 npm 审计发现高危问题；用户随后明确批准改用 SDK 1.32.2 / Zod 4.6.7。其他架构和功能范围不变。
