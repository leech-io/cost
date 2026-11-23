# 只读 API key 认证（设计补录）

2026-11-23 为 Cost 的只读 MCP 增加独立于微信会话的访问方式。本文在实现完成后补录，不代表事前设计审批；实际顺序为“实现 → 补测试”，不符合 AGENTS 要求的 TDD 流程。本环境未找到仓库引用的 Superpowers 技能包，不能声称完整执行了该技能流程。

## 背景

只读 MCP 复用微信小程序会话 token，需要用户登录微信开发者工具取出 `cost_session`，约 7 天过期。用户要求“MCP 配置好即可访问、不需要微信 token”，同时不接受公网无鉴权。

## 目标与边界

- 在保留微信登录（`COST_AUTH_MODE=wechat`）的同时，增加一条静态 key 访问路径。
- key 只读：服务端只放行 `GET`/`HEAD`，其他方法返回 `403 {"error":"read_only_key"}`。
- 服务端只保存 key 的 SHA-256 摘要；明文只存在于用户本机 MCP 凭据文件。
- 不做：多用户/多账本、写权限、OAuth、密钥管理界面、限流与审计扩展。

## 接口与配置

| 项 | 约定 |
|---|---|
| `COST_APIKEY_SHA256` | 可选。key 的 SHA-256 摘要，必须为 64 位十六进制；仅允许与 `COST_AUTH_MODE=wechat` 同时设置 |
| `COST_APIKEY_USER_ID` | 可选，默认 1；key 映射到的单用户账本 |
| 请求头 | `Authorization: Bearer <key>`；key 约定为 64 位十六进制随机串，兼容 MCP 现有校验 |
| 成功 | 与微信会话相同的 `GET` 路由，读该用户账本 |
| 失败 | key 不匹配回落到微信会话鉴权（无会话即 401）；非 GET/HEAD 返回 403 |

实现位置：`backend/internal/api/readonly_key.go`（选项与常量时间比对）、`backend/internal/api/api.go`（鉴权分支）、`backend/cmd/api/main.go`（配置校验与装配）。部署透传见 `deploy/compose.cloud.yaml` 与 `deploy/.env.example`。

## 权限与安全

- 摘要与请求 key 使用 `subtle.ConstantTimeCompare` 比较；key 不写入日志、配置示例或 Git。
- key 与微信会话相互独立：微信登录、会话撤销、昵称校验均不受影响；key 请求跳过昵称校验。
- key 长期有效，轮换 = 更换环境变量并重启 api；泄露即换。
- 单用户模型下 `COST_APIKEY_USER_ID` 决定可读账本，配置错误会读到其他账本，默认 1 与当前部署一致。

## 验收

- 配置校验：摘要格式错误、在 `development` 模式下设置 key、非法用户 ID 均在启动时报错。
- 行为：正确 key 的 `GET` 返回 200；错误或缺失 key 返回 401；`POST` 带 key 返回 403 `read_only_key`；`/health` 不变。
- 回归：`go test -race ./...`、`go vet ./...`、构建通过；认证变更补跑隔离 MySQL 集成测试。
- 未覆盖：云端部署与真实生产 key（需用户重建镜像并配置环境变量）。

## 风险

- 静态 key 没有过期机制，安全性取决于随机性与保密；建议 `openssl rand -hex 32` 生成并妥善保存。
- 只读约束在 HTTP 层实施，不是数据库只读账号；若将来扩展写接口，需要保持方法白名单。
- 未加 key 专属限流；现有 `GET` 路由均为读操作，影响有限。
