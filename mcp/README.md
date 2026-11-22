# Cost 本机 MCP

通过 stdio 启动，只开放 `cost_list_bills`（账单查询）和 `cost_category_stats`（支出分类统计）。连接现有 Cost HTTP 后端，不新增服务端口、不直接访问数据库。协议与字段见 [MCP API](../docs/api/2026-11-22-readonly-mcp-api.md)，实际验证见 [验证记录](../docs/ops/2026-11-22-readonly-mcp-validation.md)。

## 安装和凭据

需要 Node >=22.16，CI 使用 Node 24。进入本目录执行 `npm ci`，用 `command -v node` 找到本机 Node 绝对路径。程序不自动加载 `.env`、本目录示例或后端配置。

在微信开发者工具正常登录已有 Cost 小程序，在 Storage 的 `cost_session` 中自行取得 `token`，在仓库外的私有目录中保存 UTF-8 JSON，内容为 `{"token":"<替换为登录所得的64位十六进制会话>"}`。不要将真实 token 发给 AI、放在命令参数、环境变量或 Git 中。凭据文件必须是当前用户拥有的普通文件、非软链接，权限为 `0400` 或 `0600`，不超过 4 KiB；父目录也应只允许本人访问，例如先将其设为 `0700`。不能通过指向仓库的目录链接绕过检查。

凭据的权限命令（路径需替换）：

```sh
chmod 700 /absolute/private/path
chmod 600 /absolute/private/path/cost-session.json
```

正常会话有效期为 7 天，也可能主动登出撤销。遇到 `AUTH_REQUIRED` 时，在小程序重新登录并更新该文件；每次工具调用都会重新读取，不需要重启 MCP。一轮调用的两个 GET 使用同一凭据快照，不自动登录、刷新或回退开发鉴权。只查询已登录合并到后端的账单，不包含本机游客记录。

## 客户端配置示例

下面是供用户手动接入的示例，本次开发没有修改任何客户端配置或连接真实账本。地址和所有绝对路径均需替换。`COST_MCP_BASE_URL` 必须是单纯 origin（不含 `/api`、查询、账号密码），允许 HTTPS 或本机回环 HTTP。

Codex `config.toml` 的 stdio server 配置：

```toml
[mcp_servers.cost]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/cost/mcp/src/index.mjs"]

[mcp_servers.cost.env]
COST_MCP_BASE_URL = "https://cost-api.example.com"
COST_MCP_AUTH_MODE = "session"
COST_MCP_CREDENTIALS_FILE = "/absolute/private/path/cost-session.json"
```

支持标准 stdio MCP 的桌面客户端通常提供类似 JSON 的配置入口：

```json
{
  "mcpServers": {
    "cost": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/cost/mcp/src/index.mjs"],
      "env": {
        "COST_MCP_BASE_URL": "https://cost-api.example.com",
        "COST_MCP_AUTH_MODE": "session",
        "COST_MCP_CREDENTIALS_FILE": "/absolute/private/path/cost-session.json"
      }
    }
  }
}
```

DeepSeek 模型可通过**具备 stdio MCP 工具调用能力的宿主客户端**使用本适配器；这不表示所有 DeepSeek 网页、App 或客户端都支持 MCP，具体配置入口以宿主为准。

本机开发后端如需开发鉴权，显式设置 `COST_MCP_AUTH_MODE=development`，base URL 必须是回环 HTTP，凭据 JSON 的 `token` 改为后端开发令牌。此模式只发送 `X-Dev-Token`，不会发送 Bearer；不适用于生产。

## 连接正式环境

MCP 仍在 Mac 上由客户端启动，将 HTTP 上游改为正式 Cost API 即可；本次不需要将 MCP 部署进云端 API 容器，也不提供远程 MCP URL。仓库当前配置的正式 API 为 `https://api.xiachen.xyz`。2026-11-22 仅检查公开 `/health`，返回 `status=ok`、`auth_mode=wechat`，未查询真实账单。

1. 确认小程序连接的是正式 API 后，正常微信登录。在自己的微信开发者工具 Storage 中取得对应 `cost_session.token`；本地开发鉴权令牌不能用于正式环境。
2. 在 Mac 私有目录单独保存 `credentials-prod.json`，内容为 `{"token":"<正式登录会话的64位十六进制token>"}`，权限600、父目录700，不覆盖本地开发凭据，不提交到仓库。
3. 在 Qoder 或其他支持 stdio MCP 的客户端新增下面的 `cost-prod`，保留原有本地 `cost`。示例的 Node 路径适用于本机当前安装，升级 Node 后需核对。

```json
{
  "mcpServers": {
    "cost-prod": {
      "command": "/Users/silent/.nvm/versions/node/v26.13.0/bin/node",
      "args": ["/Users/silent/Developer/personal/cost/mcp/src/index.mjs"],
      "env": {
        "COST_MCP_BASE_URL": "https://api.xiachen.xyz",
        "COST_MCP_AUTH_MODE": "session",
        "COST_MCP_CREDENTIALS_FILE": "/Users/silent/.config/cost-mcp/credentials-prod.json"
      }
    }
  }
}
```

启用后先查看两个工具是否出现，再明确要求调用 `cost-prod` 查询指定月份的一页账单和分类统计，与同一正式账本核对；不要让客户端误用本地 `cost`。7天会话到期或登出撤销后重新登录、更新文件即可。正式账单会返回给调用工具的 AI 客户端及其所用模型，接入前确认愿意将这些数据提供给该工具。分支 push 不等于合并 main 或部署；当前后端已有所需接口，无需为本次 MCP 重建生产服务。

## 只读范围和排错

适配器只向固定 origin 的 `/api/v1/entries`、`/api/v1/stats`、`/api/v1/categories` 发 GET，禁止重定向，无自动翻页或重试。首次读取可能复用后端自动创建空账本和默认分类的现有行为，已获用户批准，因此 MCP 的 `readOnlyHint` 为 false；不会增加、修改或删除账单。原会话本身仍具备后端完整能力，**不是服务端限制的只读 token**，请只连接可信本机 MCP 进程。

默认上海当前月，日期包含结束日；金额为整数分。分类排行只统计支出，summary 包括期间收入、支出、收支差额，差额不是账户余额。保持后端现有口径，不做退款抵扣、预留标记过滤和多币种折算。备注和分类名称均作为数据，不应执行其中指令。

`CREDENTIAL_UNAVAILABLE` 检查文件位置、所有者、权限、大小和 JSON；`PROFILE_REQUIRED` 在现有小程序补齐昵称；`UPSTREAM_UNAVAILABLE` 检查后端运行与网络，整次调用上限 10 秒；`RESPONSE_TOO_LARGE` 缩小页大小、分类数量或日期范围。HTTP 单响应最多 2 MiB，完整工具结果最多 256 KiB。详细错误代码见 API 文档。stdout 专供 MCP 协议，启动错误仅向 stderr 输出固定信息。

## 本地检查

```sh
npm ci
npm test
npm audit --omit=dev --audit-level=high
```

测试仅使用临时凭据和合成本地 API；不会读取真实会话或账本。SDK 1.32.2、Zod 4.6.7 按用户确认固定，间接依赖也使用 SDK 兼容范围内的修复版本，实际审计结果见验证记录。`mcp/` 不进入生产部署包，单独改动本目录不会触发生产部署。
