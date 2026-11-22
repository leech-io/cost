# Cost Read-only MCP Implementation Plan

> **For agentic workers:** After the user approves both this plan and its design, use `superpowers:executing-plans` or the explicitly chosen execution method. Do not implement before approval. Track each step with checkboxes.

**Goal:** 本机 stdio MCP 只支持账单查询和支出分类统计，复用现有 Cost HTTP API。

**Architecture:** 独立 Node.js ESM 适配器；官方 MCP SDK 负责协议和 schema，私有 HTTP client 仅访问固定 GET API，现有 Go 服务继续负责身份和账本隔离。

**Tech Stack:** Node >=22.16（CI Node 24），JavaScript `.mjs` + JSDoc，`@modelcontextprotocol/sdk@1.32.2`、`zod@4.6.7`、Node test runner；现有 Go 后端不升级。

**Spec:** [2026-11-22 只读 MCP 设计](../specs/2026-11-22-readonly-mcp-design.md)

**Status:** 用户已确认并授权当前会话在 `feat/readonly-mcp` 执行。实现和本地验证已进行，最终审查状态与结果见[验证记录](../../ops/2026-11-22-readonly-mcp-validation.md)。未推送或部署，未接入真实账本。

## 全局约束

- 当前 main 基线 `9020b910266899d7ff5f6ed1fa241018b37a5946`；保留未跟踪的 `deploy/compose.desktop.yaml`。实施前检查最新状态，从合适 main 基线建立/复用 `feat/readonly-mcp`，不覆盖其他任务，不直接在 main 实现。
- 只有两个工具；固定三个 GET API；适配器无 SQL、账单写操作、登录/刷新/导出、监听端口或 DB 凭据。允许原后端首次创建空账本和默认分类，此例外已获用户确认；MCP annotations 按已知副作用声明 readOnlyHint:false，而不是声称数据库绝对只读。
- 首版分类统计仅支出；时间按 Asia/Shanghai；尾日包含；安全整数分；复用现有后台统计，不修复或重定义 P2 标记、币种和退款口径。
- session 与 development 明确分离；凭据由用户手动提供仓库外文件；不扫描用户数据、不把 token 写到 Git/命令行/AI 参数或日志。
- 每调用 10 秒、上游每响应 2 MiB、结果 256 KiB；不自动翻页、重试、跟随重定向或缓存账单。
- 项目文档放本仓库；本计划获批不授权推送、PR、合并、清理工作树、部署或真实账本访问。计划暂不含自动提交步骤。
- 默认由当前会话直接实施；若用户另选代理方式按其选择执行，不重复建立另一套 ECC 计划。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `mcp/package.json`、`mcp/package-lock.json` | private ESM 包、固定依赖、Node 范围及 `npm test` 脚本。 |
| `mcp/src/config.mjs` | 解析 origin、认证模式和凭据路径；`readCredentials(config)` 每调用读取、校验文件归属/权限和 token。 |
| `mcp/src/schemas.mjs` | 两工具严格 input/output schemas；`normalizeBillQuery(args, now)`、`normalizeStatsQuery(args, now)` 处理日期与显式默认值。 |
| `mcp/src/client.mjs` | `createCostClient(config, {fetchImpl})` 返回 `listEntries(query, signal)`、`stats(query, signal)`、`categories(signal)`；隐藏底层通用 request，仅 GET allowlist。 |
| `mcp/src/tools.mjs` | `createTools(client,{now})` 返回 `listBills(args)` 和 `categoryStats(args)`，补分类名、裁剪字段及处理 limit；结果不记录真实内容。 |
| `mcp/src/server.mjs` | `createServer({tools})` 注册两个工具、schema、annotations；处理预期业务失败为 MCP isError。 |
| `mcp/src/index.mjs` | 读配置、建立 stdio transport、处理退出；stdout 仅协议消息。 |
| `mcp/tests/*.test.mjs`、`fixtures/cost-api.json` | 参数、HTTP、业务投影、协议子进程与脱敏测试；只用合成数据。 |
| `backend/internal/api/mcp_contract_test.go` | 基于现有 Memory API 和 fake WeChat，验证供 MCP 使用的 GET 契约、统计和隔离，不改后端生产实现。 |
| `.github/workflows/ci-cd.yml` | 增加独立 MCP 检查 job，Node 24，保留现有检查与部署条件。 |
| `scripts/plan-ci.py`、`scripts/tests/test_ci_plan.py` | mcp-only 变化不部署的回归与实现。 |
| `mcp/README.md`、`mcp/.env.example` | 本机运行、凭据更新、两个客户端示例、限制及故障处理。 |
| `docs/api/2026-11-22-readonly-mcp-api.md` | 最终工具契约与错误行为。 |
| `docs/ops/2026-11-22-readonly-mcp-validation.md` | 实际命令结果、客户端联调状态与未验证项；不能提前写通过。 |
| `README.md`、`docs/README.md` | 项目入口和文档索引。 |

不创建无实现的功能脚手架；文件在对应任务中随测试与实现落地。

## 审查重点

1. 401、权限错误、坏响应不能伪装成“没有账单”；凭据不向重定向目标泄露。
2. month/custom 互斥、闰年、上海日/月边界，0 金额及 account_id=0 不丢失。
3. 当前页与全部匹配项汇总的区别；memory/mysql Query 差异不影响投影；支出排行 limit 不改变总计。
4. payload 无任意 URL/方法/ledger_id；仅两个工具；token 原文或 HTTP 错误正文不出现在 stderr 和工具错误中。
5. mcp-only、混合运行代码、文档、测试和手动 full 事件的部署判断；测试数据与真实账本严格分离。

## Task 1 配置、凭据和参数契约

**Files:** 创建 `mcp/package.json`、lockfile、`src/config.mjs`、`src/schemas.mjs`、`tests/config.test.mjs`、`tests/schemas.test.mjs`。

**Interfaces:** 配置返回 `{baseURL,authMode,credentialsFile}`；`readCredentials(config)` 返回仅私有 client 使用的 token；两个 normalize 函数返回固定 HTTP 查询参数与规范化 period。日期以注入 now 测试，不依赖系统当天。

- [x] 获批后检查分支和工作区；已有功能分支不盲目切换，按项目规则建立/复用实现分支。
- [x] 建立最小 ESM 包并生成锁文件；核对候选依赖发布信息与 `npm audit --omit=dev`。直接依赖改动或高风险问题先报告，不带病更新版本假装仍是原批准方案。
- [x] 先写失败测试：BASE_URL 缺省、非 origin、userinfo、远程明文、坏 authMode；凭据非绝对/仓库内/软链接/非本人/权限过宽/空值/超 4 KiB；session 不匹配 hex64；development 指向远程均失败。
- [x] 先写失败测试：month 与日期混用、单边日期、闰年、366 天上限、page=0/page_size=101、q 超限、账户/金额 0 值、未知字段、range=all 或 income 分类排行等；合法日期和分页返回明确规范化值。
- [x] 运行 `cd mcp && node --test tests/config.test.mjs tests/schemas.test.mjs`，确认因缺少行为失败；实现最小配置及 schema，再运行同命令通过。
- [x] 凭据读取无并发全局缓存；实现权限与归属验证，读取时避免最终路径软链接与替换竞态（打开 no-follow、对 fd fstat、按同 fd 读取），不输出内容。

## Task 2 仅 GET 的 Cost HTTP client

**Files:** 创建 `mcp/src/client.mjs`、`tests/client.test.mjs`。

**Interfaces:** client 三个方法只返回经校验的 API 数据；调用方传入共享 AbortSignal；外部不能调用任意 URL/method request。

- [x] 写本地假 HTTP 服务测试：精确 query 编码、Bearer 或开发头不混用、三路径 allowlist、跟随跳转被禁止、超时/取消、2 MiB+1、坏 Content-Type/JSON/schema、非安全整数、401/403/5xx；上游敏感错误正文不透传。
- [x] 运行 `cd mcp && node --test tests/client.test.mjs` 观察失败；实现内建 fetch、redirect:error、流式大小限制及错误白名单，再执行通过。
- [x] 断言所有请求为 GET；token 只发到配置 origin；不尝试 POST 登录/刷新或开发令牌回退；日志里放哨兵 token/备注并验证无泄露。

## Task 3 两个业务工具与现有 API 契约

**Files:** 创建 `mcp/src/tools.mjs`、`tests/tools.test.mjs`、`tests/fixtures/cost-api.json`、`backend/internal/api/mcp_contract_test.go`。

**Interfaces:** `listBills` 返回规范化期间、分页、精简账单、全量 summary；`categoryStats` 返回 summary 与支出排行/总类别数/has_more。纯业务投影不发其他请求，不从当前页重新求合计。

- [x] 写工具失败测试：默认本月、跨月过滤、中文 q、category/account 0 边界、账单空页但 total>0、返回 500 字备注、分类缺失 warning、不输出内部字段；金额用 101/102 分等值验证没有浮点换算。
- [x] 写统计失败测试：week/month/year/custom 参数映射、同额按分类 ID 排序、limit 裁剪但 summary 不变、收入仅在 summary、空结果、已停用分类、分类缺失、256 KiB+1 最终响应失败。
- [x] 运行 `cd mcp && node --test tests/tools.test.mjs` 观察失败；实现工具并通过；`backend_current` 的 flag/币种限制是显式 metadata/说明，不增加新的财务算法。
- [x] Go 契约测试使用 `store.NewMemory()`、fake WeChat、`httptest`，种两套独立用户/账本的合成记录；验证 GET 当前账本隔离、撤销/过期、软删除排除、上海尾日包含、分页全量汇总和 stats 仅支出分类；验证首次初始化及重复查询不重复创建，并核对已有账单不被读取过程改动。
- [x] Node fixtures 保存合成原始 API 响应；Go 测试核对其关键字段与当前 API 的同场景输出，防止只用假 JSON 自证正确。不可从真实库导出 fixtures。
- [x] 运行 `cd backend && go test ./internal/api -run TestReadOnlyMCPContract -count=1`；fixture 合同不符先定位，不修改后端业务以迁就 MCP。

## Task 4 MCP 注册、stdio 与进程集成

**Files:** 创建 `mcp/src/server.mjs`、`src/index.mjs`、`tests/protocol.test.mjs`、`tests/stdio.test.mjs`。

**Interfaces:** `createServer({tools})` 可用于 SDK 内存连接测试；生产入口由客户端子进程启动，只连接 StdioServerTransport。

- [x] 用官方 SDK client 写失败测试：initialize → tools/list 恰好两个工具 → tools/call；schema/annotations 齐全，structuredContent 与 text JSON 一致；未知工具及未知字段不能穿透 HTTP client。
- [x] 实现注册与结果映射，执行 `cd mcp && node --test tests/protocol.test.mjs` 通过。
- [x] 以 `process.execPath` spawn 真正 `src/index.mjs`，用临时安全凭据文件和合成本地 API 完成上述协议链；测试坏启动配置非零退出、stderr 脱敏、stdout 逐行 JSON、stdin 关闭或 SIGTERM 后无遗留子进程。
- [x] 运行 `cd mcp && node --test tests/stdio.test.mjs` 通过。客户端使用直接 node 命令，不依赖可能向 stdout 打 banner 的 npm start。

## Task 5 CI 与部署隔离

**Files:** 修改 `.github/workflows/ci-cd.yml`、`scripts/plan-ci.py`、`scripts/tests/test_ci_plan.py`。

- [x] 先补回归：仅 mcp/src、lockfile、README 或 tests 变化不要求生产部署；mcp+backend运行代码仍需部署；unknown-base 只检查；manual full 保持原显式含义。
- [x] 运行 `python3 -m unittest discover -s scripts/tests -p test_ci_plan.py -v` 观察 mcp-only 用例失败；最小修改分类逻辑，再执行通过。
- [x] 增加独立 `mcp-checks` job（Node 24、working-directory mcp、npm ci、npm test），保留现有 backend/miniprogram/checks；不把 MCP job 加为生产部署必要前提，不改部署包内容、不接触生产 secrets。
- [x] 运行既有 actionlint（已安装才直接调用；否则在获批环境安装到临时工具目录）与脚本测试，核对不会因为仅本机 MCP 变化部署服务器。

## Task 6 文档、整体验证与交付

**Files:** 新增 MCP README、.env.example、API/验证文档，更新根 README 与 docs/README 索引。

- [x] 文档覆盖两个工具 schema、返回/错误、原后端口径、session 的 7 天有效期及重新登录步骤；解释游客数据不在后端、凭据权限和只读 token 的现有限制。
- [x] Codex TOML 示例用绝对 Node、入口脚本和凭据文件路径；通用 JSON MCP 示例同样不放 token。其他 DeepSeek 客户端仅对其实际支持的 stdio 机制说明，不宣称所有 DeepSeek 产品都可连接。
- [x] `mcp/.env.example` 只描述安全占位值；程序只读取进程环境，不自动读取 dotenv/backend .env。运行示例确保凭据不出现在命令行参数或 Git 文件中。
- [x] 执行 `cd mcp && npm ci && npm test`，以及 `cd backend && go test -race ./... && go vet ./... && go build ./...`。新 Go 契约测试必须执行；本设计未改 SQL/认证实现，不声称普通测试证明真实 MySQL 已验证。
- [x] 在仓库根执行 `python3 -m unittest discover -s scripts/tests -v`；若 CI 文件调整影响既有验证，再按仓库约定运行其余检查。检查 `git diff --check`、文档链接、暂存文件范围、凭据与生成物遗漏。
- [x] 做一次覆盖设计和最终差异的审查，修复影响正确性的问题后重跑相关检查；记录真实测试结果和未执行的客户端/真实后端联调状态，不捏造红灯或独立审查。
- [x] 提供两个本机工具的实际调用证据（合成数据）、改动摘要和后续连接说明。只有用户另外明确同意后，才配置客户端读取真实账本；不自动推送、PR、合并或上线。

## 实施前确认清单

- [x] 用户确认完整设计与本计划，包括 session 文件、Node 适配器和仅支出分类统计的范围。连接方式及首次初始化例外已有局部确认，不能充当本项整体批准。
- [x] 执行方式确认；建议当前会话直接执行，各任务按 TDD 推进，最终审查一次。
- [ ] 可读取的现有 backend 地址和有效凭据只在实际接入前由用户本机提供，不能从仓库或聊天反查。

勾选只表示已有实际执行证据；未执行的真实接入另行授权，不由本计划批准自动触发。

## 2026-11-22 实施授权与依赖修订

用户已明确批准完整设计和计划，授权在功能分支开发，保留既有改动，先交付验证结果，不推送或部署。原 SDK 1.29.0 / Zod 3.25.76 的 npm 审计发现高危问题；用户随后明确批准改用 SDK 1.32.2 / Zod 4.6.7。其他架构和功能范围不变。

## 实施记录与内部裁定

- 配置/规范化、HTTP、工具投影测试经历失败到通过；Go 契约和子进程生命周期属于既有接口与集成验证，未宣称每个补充用例都有行为红灯。测试日志在本次临时验证目录，长期结论写入仓库验证文档。凭据所有者检查有实现，自动测试未切换操作系统 UID。
- 为保证两次 GET 使用同一身份且共享截止时间，增加私有调用快照 `client.forCall` 及 shutdown signal；对外工具和查询接口不变。最终响应上限计入 text 和 structuredContent 的重复内容。
- SDK 允许的间接依赖范围内，以非强制 npm audit fix 将 @hono/node-server 锁定至2.1.11，未增加直接依赖或 override；锁文件重装、测试和审计通过。
- 真实后端地址和有效会话暂不提供、不自动搜取；这不阻塞合成数据范围的实现和交付。
