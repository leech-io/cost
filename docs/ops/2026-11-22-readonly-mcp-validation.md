# Cost 本机 MCP 验证记录

日期：2026-11-22。实现位于 `feat/readonly-mcp`，基线 `9020b910266899d7ff5f6ed1fa241018b37a5946`。用户已确认[设计](../superpowers/specs/2026-11-22-readonly-mcp-design.md)和[实施计划](../superpowers/plans/2026-11-22-readonly-mcp.md)，随后明确批准 SDK 1.32.2 / Zod 4.6.7 的安全升级。

## 范围和状态

- 本机 stdio，仅账单查询 `cost_list_bills`、支出分类统计 `cost_category_stats`。
- 未修改 Go 后端生产代码、SQL、数据库结构或生产部署包；增加 Memory API 消费者契约测试。
- 初次交付时保留原有未跟踪 `deploy/compose.desktop.yaml`，未暂存、提交、推送、建 PR、合并或部署；后续用户授权见下文。
- 测试只使用合成本地 HTTP、临时安全凭据和内存账本。未访问真实会话、账单、MySQL 或微信，不以合成结果代表生产联调。
- 最终独立只读代码审查已完成：未发现 Critical、Important 或需报告的 Minor 问题，可交付本地验证结果。审查覆盖未提交的新文件及已有文件差异，不只检查 Git 已跟踪 diff。

## 实际检查

本机 Node 26.13.0；CI 声明 Node 24，尚未远端运行。

| 检查 | 本机结果 |
| --- | --- |
| `cd mcp && npm ci && npm test` | 18 项通过，0失败；含官方 SDK Client 的内存及真实 stdio 子进程测试 |
| `cd mcp && npm audit --omit=dev` | 0 vulnerabilities |
| `cd backend && COST_TEST_MYSQL_ADMIN_DSN= go test -race -count=1 ./...` | 全部包通过；隔离 MySQL 测试因未提供独立测试 DSN 不执行 |
| `cd backend && go vet ./... && go build ./...` | 通过 |
| `python3 -m unittest discover -s scripts/tests -v` | 57项，56通过，1个需要一次性 Docker runner 的 Redis smoke 跳过 |
| `node --test miniprogram/tests/*.test.js` | 171项全部通过 |
| `node miniprogram/tests/validate.js` | JavaScript、JSON及页面文件检查通过 |
| `bash -n scripts/deploy-cloud.sh scripts/setup-cicd.sh` | 通过 |
| 已有临时工具 `actionlint` | 通过 |
| 生产源码包临时构建并核对内容 | 52个文件，未包含 MCP、Node 依赖或契约测试/fixture |

开发过程实际观察配置、参数规范化、HTTP client、工具投影的失败→通过；协议测试先因 server 模块尚未实现失败，补齐后通过；真实子进程生命周期测试是补充集成验证，不伪称每个用例都经历行为红灯。CI 回归先因 MCP 被误判部署失败，修改分类后通过。Go 契约测试验证既有接口，不修改后端业务以迁就 fixture。

审查者独立复跑 CI 分类4项及 diff 检查通过；其受限沙箱禁止监听回环端口，Node 复跑7项通过、11项因 listen EPERM 无法执行。审查者核对了主执行环境18项全部通过与审计0项的日志，不将该沙箱限制当成产品失败，也未宣称在自己的环境全量通过。

## 合成调用结果

官方 SDK 客户端初始化后 `tools/list` 恰好发现两个工具，严格 input/output schema 和已知初始化副作用 annotations 均可见。

1. `cost_list_bills({"month":"2026-11","page_size":1})`：只返回最新一笔500分收入；total=4、has_more=true；summary 仍为 income_cent=500、expense_cent=505、balance_cent=-5，证明汇总覆盖全部匹配记录，而不是本页。
2. `cost_category_stats({"ref":"2026-11-22","limit":1})`：返回餐饮303分、2笔，category_count=2、returned_count=1、has_more=true；summary 仍为500/505/-5。限量不改变全期间总数。

Go 测试种入101分和202分餐饮、202分交通、500分收入，另加软删除、范围外和另一用户数据，核对 Node fixture 的关键字段；同时检查上海尾日包含、重复读取不变、撤销/过期401及重复 GET 默认分类稳定。

安全与边界测试包括严格参数、0值筛选、上海跨月与闰年、未知字段拒绝、只发固定 GET、鉴权不混用、跳转不跟随、取消、2MiB响应限制、安全整数、脱敏错误、256KiB完整工具结果限制。stdin 关闭及 SIGTERM 能中止在途请求并退出，stdout 只包含可解析协议消息。

## 依赖修订

最初 SDK 1.29.0 / Zod 3.25.76 的审计为2高危、1中危，已报告并取得用户升级确认。升级两个直接依赖后还有一个 `@hono/node-server` 静态路径双重解码中危；进一步核对 SDK 声明范围为 `^1.19.9 || ^2.0.5`，使用正常 `npm audit fix --ignore-scripts`（无 force、无新增直接依赖或 override）将间接依赖锁定至兼容的2.1.11。重装锁文件、重测后审计为0项。

## 实施裁定与限制

每工具调用使用一次凭据快照，业务和分类 GET 共用同一10秒截止时间，防止更新文件时混用身份。内部增加 `client.forCall` 和进程 shutdown signal，保留计划的三个固定公开读取方法。完整结果大小同时计入 text 与 structuredContent 的重复内容，超限明确失败。以上是保持外部契约的内部实现细化。

CI 增加独立 `mcp-checks`，不改变 deploy 的 `needs: [checks, plan]`。本机回归验证 MCP-only 不部署、混合后端运行代码仍部署、unknown-base 保守仅检查、manual full 语义保留；本次不实际触发任何部署。

首次 GET 可能初始化空账本及默认分类，用户已批准；会话本身具备原 API 完整权限，不能称为服务端只读 token。统计沿用后端当前退款/标记/币种限制。真实客户端配置、真实后端联调和生产接入未执行，后续需用户明确授权并在本机提供凭据；连接方式见 [MCP README](../../mcp/README.md)。

## 后续本地验收与提交授权

用户随后明确反馈“本地验证成功”，并授权 commit 和 push 到远程仓库。这是用户的手动验收反馈，不改写成自动化测试证据；正式账本查询仍未执行。提交范围仅本次 MCP 源码、锁文件、测试、CI 与相关文档，继续排除原有 `deploy/compose.desktop.yaml`。授权不包含合并、部署或代取正式会话。

提交前重新运行 MCP18项测试、依赖审计、Go race/vet/build、CI分类4项、actionlint 和 diff 检查；结果以本次实际输出核对后再提交。公开正式 API `/health` 已实测返回 `{"auth_mode":"wechat","status":"ok"}`；只证明后端在线和鉴权模式，不证明真实账单查询已联通。正式连接步骤已补入 MCP README。
