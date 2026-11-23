# 只读 API key：实施记录（补录）

关联[设计说明](../specs/2026-11-23-readonly-api-key-design.md)。本文在实现后补录，区分已发生事实与待验证事项；不伪造事前计划审批、失败测试或独立审查。

实际顺序：先在 `feat/readonly-mcp` 分支直接实现，再补测试与文档，属于事后补测，不是 TDD。

- [x] 确认分支：`feat/readonly-mcp`（跟踪 `origin/feat/readonly-mcp`），未在 `main` 改动。
- [x] `backend/internal/api/readonly_key.go`：`WithReadOnlyKey` 选项、Bearer 解析与 SHA-256 常量时间比对。
- [x] `backend/internal/api/api.go`：wechat 鉴权分支中先尝试 key；key 命中仅允许 GET/HEAD，映射到 `LedgerForUser(userID)`；失败回落到会话鉴权。
- [x] `backend/cmd/api/main.go`：`COST_APIKEY_SHA256`、`COST_APIKEY_USER_ID` 的读取、格式与模式校验；启动日志只记录是否启用。
- [x] 测试：`readonly_key_test.go`（200/401/403 路径）、`main_test.go`（配置校验四例）。
- [x] 部署：`compose.cloud.yaml` 透传两个变量；`.env.example` 注明生成方式。
- [x] `.gitignore` 忽略 `deploy/compose.desktop.yaml`。
- [x] 更新 README 与文档索引。
- [ ] 用户重建线上镜像、写入 `COST_APIKEY_SHA256` 后用真实 key 验证；本地 MCP 凭据改为 key。
- [ ] 作废此前出现在截图中的微信会话 token。

没有调用独立审查代理；由主代理逐行自查，不能称为独立审查。
