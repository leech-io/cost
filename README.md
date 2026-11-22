# Cost 记账

> 公开文档脱敏说明（2026-11-18）：个人路径、部署标识及真实账本数据已省略或改为占位示例。历史验证结论保留，不代表使用占位示例重新执行。示例路径使用前须替换；部署脚本的内置默认路径以源码为准，本次未调整脚本。

Cost 是供个人使用的记账项目，交互对标 iCost：原生微信小程序负责操作，Go 后端处理身份和账单，MySQL 持久保存数据。当前一个部署服务一个用户、一个账本；登录后自动建立并绑定个人账本。

代码已整理到同一私有仓库，微信登录已完成开发者工具真实联调；后端与 MySQL 已通过 Docker 部署到腾讯云，小程序尚未正式发布。域名 ICP 接入备案、HTTPS 与真机验收仍待完成。历史验证见 [登录验证](docs/ops/2026-10-22-monorepo-wechat-auth-validation.md)，当前数据库状态见 [表前缀与数据迁移记录](docs/ops/2026-10-22-mysql-prefix-data-migration.md)，iCost 重定位验证见 [M1 验证记录](docs/ops/2026-10-26-icost-realignment-validation.md)。

## 功能与边界

- 本机 stdio MCP：向支持 MCP 的 AI 客户端提供账单查询和支出分类统计；安装、凭据和连接示例见 [MCP 使用说明](mcp/README.md)。不包含真实客户端接入或生产发布。

- 账单新增、修改、删除、分类选择和按月查询；明细页按日分组可折叠，带剩余月预算卡。
- 全屏记账键盘：支出/收入切换、5 列分类宫格、计算器键盘（+×−÷、保存再记）、账户选择条（不指定或自建账户，记住上次选择）。
- 底部导航：“账本”使用账本图标，“统计”使用柱状图图标，选中显示蓝色。
- 统计页五档（周/月/年/全部/自定义范围）：收支/结余/日均指标、支出柱状图、分类排行。
- 月预算：总预算与分类预算，超支提醒与剩余日均；预算模型支持周/月/年三粒度，UI 首版提供月。
- 分类支持 48 个统一线性图标与 Emoji 双轨选择，加载失败回退 Emoji；分类管理可关闭提示，并在二次确认后将内置分类统一为系统图标，自建分类不受影响。009 保护式更新旧默认 Emoji，010 迁移补图标 key 与系统角色，见[线性图标 API 与升级](docs/api/2026-11-11-category-line-icons-api.md)、[验证记录](docs/ops/2026-11-11-category-line-icons-validation.md)。
- 分类管理、账户与转账、跨月搜索与组合筛选。账户为用户自建的记账标签（现金/微信/支付宝/银行卡/其他），不绑定外部账户；账单可标记所属账户，余额 = 期初 + 收入 − 支出 + 转入 − 转出；明细行显示所属账户；搜索同时匹配备注与分类名。
- 金额输入只接受数字和最多两位小数，账单及预算统一为整数分；月份按 Asia/Shanghai 划分。
- 微信登录、自有 7 天会话；单人全权管理自己账本的全部记录。
- 游客模式：不登录也能记账（记录只存本机，可在账本/统计/搜索/日历中查看、编辑、删除），微信登录后按 `client_request_id` 幂等合并进账本；昵称不再作为进入门槛，未填写时默认「微信用户」。
- 微信登录复用已保存昵称；首次或历史账号缺昵称时必须补填后使用，设置页可修改。昵称保存至 `t_users.nickname`，首次需用户主动选择或填写，不能通过 openid 自动获取。接口与升级说明见 [昵称 API](docs/api/2026-11-03-wechat-nickname-api.md)。
- 支持主动选择微信头像，登录补填页和设置页“个人资料”可上传/更换；图片和稳定读取路径保存在用户表，下次登录自动带入。首页右上角优先展示用户头像，未上传或图片读取失败时显示当前账本图标。头像可选，接口与 008 升级说明见 [头像 API](docs/api/2026-11-03-wechat-avatar-api.md)。
- 设置页点击顶部账本卡片可编辑名称与图标，保存后返回首页自动刷新；接口见 [账本资料编辑](docs/api/2026-11-03-ledger-profile-api.md)。
- 创建请求使用 client_request_id 去重；不支持离线同步。

已提供账单详情、搜索与收支日历；删除采用软删除，5 秒内可撤销。编辑时保留未传入的账户与扩展标记。使用此版本前须显式升级数据库至 010（006 新增 `deleted_at`，007 新增用户 `nickname`，008 新增 `avatar_url`/`avatar_data`，009 保护式更新默认 Emoji，010 新增线性图标及内置角色），本机应用账号无 DDL 权限，迁移方式见下文。头像功能本次验证及待验证项见 [验证记录](docs/ops/2026-11-03-wechat-avatar-validation.md)。

账单字段已预留退款关联、报销/不计统计/不计预算标记与币种（模型与接口透传），UI 暂未开放。当前不提供多账本切换、图片附件、标签管理、退款和模板操作。本轮检查及未完成的 MySQL/真机验证见 [主流程修复验证](docs/ops/2026-10-26-icost-rescue-validation.md)。

## 仓库结构

```text
cost/
├── backend/              Go 1.23+ 后端、数据库迁移和测试
│   ├── cmd/api/          启动入口
│   ├── internal/         auth、api、domain、store
│   └── .env.example      本地配置模板
├── miniprogram/          微信开发者工具导入这个目录
│   ├── pages/            登录、账本、统计、设置
│   ├── utils/            请求、会话、金额和接口地址配置
│   └── tests/            前端逻辑和文件检查
├── scripts/dev.sh        仓库根目录启动入口
├── deploy/               本地与云端 Docker Compose 配置
├── docs/                 文档索引、ADR、接口、运行与开发流程
├── cost.code-workspace   VS Code 前后端工作区
├── AGENTS.md             仓库开发约定
└── CLAUDE.md             Claude Code 入口
```

本地开发请使用自己的仓库检出路径（本文以 `/path/to/cost` 表示），统一从本仓库进入开发。

## 环境要求

| 工具 | 用途 |
|---|---|
| Go 1.23 或更新版本 | 编译和运行后端 |
| MySQL 8.4 | 持久保存账单、用户与会话 |
| 微信开发者工具、有效小程序 AppID、开发者账号 | 编译小程序和获取真实微信登录 code |
| 架构兼容的 Node.js | 运行前端测试；小程序运行本身无需 npm 构建 |
| Docker Compose（可选） | 没有现成 MySQL 时启动本地数据库 |

## 首次运行

以下命令除特别注明外，均在仓库根目录执行。

### 1. 准备数据库

已有本地 MySQL 和 cost 数据库时继续使用，不要再启动一个占用 3306 的数据库实例。新环境可选：

```sh
docker compose -f deploy/compose.local.yaml up -d mysql
```

此配置只把 MySQL 暴露到本机回环地址。默认开发数据库连接示例见配置模板，不能直接用作生产凭证。已有数据库在升级前先备份；不要执行会删除数据卷的 `docker compose down -v`。

### 2. 配置后端

仅在尚无本地配置时复制模板，避免覆盖已有密码和连接：

```sh
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

| 配置 | 本地使用要求 |
|---|---|
| COST_ADDR | 默认 `0.0.0.0:8080`，用于局域网真机联调 |
| COST_ENV | 本地为 `development` |
| COST_STORE | 真实账单使用 `mysql` |
| COST_MYSQL_DSN | 填写自己的数据库账号、密码和地址 |
| COST_AUTH_MODE | 使用 `wechat` |
| WECHAT_APP_ID | 与 miniprogram/project.config.json 的 appid 一致 |
| WECHAT_APP_SECRET | 对应小程序的服务端密钥 |

AppSecret 不得提交 Git、写入小程序源码或输出到日志。

本机现有配置已保留在 backend/.env。启动脚本自动加载它；直接运行 `go run` 或二进制不会自动加载该文件。MySQL 账户必须有业务表权限，执行迁移时还需具备建表、改表和删除表的权限（005 会重建预算表并 DROP 家庭协作三表）。本机应用账号 `cost_app` 无 DDL 权限，本地迁移用 root 走 socket 执行：

```sh
COST_STORE=mysql COST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/cost?parseTime=true&charset=utf8mb4&loc=UTC' go run ./cmd/api -migrate
```

（在 backend/ 目录执行；服务端部署用 compose 的 `cost_migrator` 专用账号，见 deploy/compose.cloud.yaml。）

### 3. 迁移和启动后端

备份确认后执行显式迁移；正常启动不会自动改表。当前数据库使用固定 `t_` 前缀，全部 9 张表及字段有中文注释；旧库由新版迁移命令安全改名、重构预算表并移除家庭协作三表，不需要手工删表或重建数据。升级前停止旧版后端，迁移后启动新版，旧版 SQL 不支持改名后的结构：

```sh
./scripts/dev.sh -migrate
./scripts/dev.sh
```

第二个命令持续运行，占用当前终端；在另一个终端检查：

```sh
curl http://127.0.0.1:8080/health
```

健康接口应显示 `status=ok`、`auth_mode=wechat`；它是进程存活检查，不代表数据库、微信登录或账本功能全部验证成功。停止本地服务可在运行终端按 Ctrl+C。

### 4. 打开小程序

微信开发者工具导入 **miniprogram/**，不是 backend/ 或仓库根目录。AppID 需与后端一致，登录的微信需有相应开发者权限。

- 开发者工具开发版默认使用本地 `http://127.0.0.1:8081`（对应当前 `COST_ADDR`）；手机预览、体验/正式版自动使用 `https://api.xiachen.xyz`，上传前不需要手动修改地址。
- 仅微信开发者工具的开发版显示“开发环境连接”。需要自定义端口或在工具中连接云端时，可手动改地址并保存。
- 手机端不显示调试入口，不读取本地或局域网调试地址；旧 `cost_base_url` 缓存已停用。新版开发工具显式设置保存在 `cost_devtools_base_url`，不随代码包上传。
- 本地 HTTP 联调可按开发者工具要求调整域名校验，但提审验收必须开启域名与证书校验。手机预览与体验版连接生产环境，新增/修改会影响真实账本；本地联调使用开发者工具。
- 公开地址在 miniprogram/utils/config.js 维护，与服务器 `COST_DOMAIN=api.xiachen.xyz` 保持一致；网络与真机验收见 [审核登录修复验证](docs/ops/2026-11-13-review-production-backend-validation.md)。
- 后端本地 `.env` 使用 `COST_ENV=development`、监听 `0.0.0.0:8080`；云端 Compose 使用 `COST_ENV=production`，由 Caddy 转发 HTTPS 到内部 `api:8080`。完整对应关系与上线步骤见 [开发与发布环境配置](docs/ops/2026-10-27-environment-configuration.md)。

### 5. 登录并开始记账

1. 点击“微信登录”。已有昵称直接进入明细页；首次或缺昵称时选择/填写昵称并保存后进入。登录后自动建立并绑定个人账本（含 iCost 默认分类）。
2. 登录态保持 7 天；退出登录在“设置”页底部操作。

## 常见问题

| 现象 | 处理 |
|---|---|
| 服务端尚未配置微信登录 | 检查服务端 AppID/AppSecret，保存后重启服务 |
| 无法连接后端 | 确认服务运行、端口、接口地址、网络和微信开发调试设置 |
| 8080 已占用 | 先确认是否已有 Cost 服务运行，避免重复启动 |
| 重启后账单消失 | 检查是否误用 memory 存储；真实数据必须使用 mysql |
| 数据库迁移失败 | 停止服务、确认已备份，再按迁移记录排查；005 迁移会 DROP 家庭协作三表，执行前必须备份 |
| Node 报 bad CPU type | 换用与本机架构兼容的 Node；本机首次验证使用 Codex 随附运行时 |

## 验证

在 backend/ 中执行：

```sh
go test -race ./...
go vet ./...
go build -o bin/cost-api ./cmd/api
```

涉及认证持久化或数据库升级时，还需运行隔离 MySQL 集成测试。以下是本机 root socket 的示例，应替换为具备创建/删除测试库权限的测试管理连接：

```sh
COST_TEST_MYSQL_ADMIN_DSN='root@unix(/tmp/mysql.sock)/' go test -race ./...
```

测试自动创建随机命名数据库并清理，不使用业务 cost 库。未设置该变量时 MySQL 集成测试跳过，普通测试通过不能视为 MySQL 已验证。

在仓库根目录执行（小程序测试用架构兼容的 Node）：

```sh
node --test 'miniprogram/tests/*.test.js'
```

微信能力还需要分别验证平台编译、真实微信登录和手机真机；自动测试不能代替这些操作。最新实际结果与剩余项记录在 [iCost 重定位 M1 验证记录](docs/ops/2026-10-26-icost-realignment-validation.md)，历史记录见 [登录验证](docs/ops/2026-10-22-monorepo-wechat-auth-validation.md)。

## 开发流程与文档

开发按 Superpowers：需求与设计 → 实施计划 → TDD → 审查 → 验证。具体规范见 [AGENTS.md](AGENTS.md) 和 [开发流程](docs/superpowers/2026-10-22-development-workflow.md)。

专题文档采用 `YYYY-MM-DD-english-topic.md`，按 ADR、API、运行和 Superpowers 分类；README.md 作为各目录索引保留固定名称。从 [docs/README.md](docs/README.md) 查阅全部文档。

本次已有实现的设计为事后补录，未保留完整事前计划、TDD 红灯和独立审查记录；文档明确说明该缺口，不把测试通过等同于流程全部完成。

## 发布状态

CI 检查与自动部署分别判断：仅修改测试代码、测试目录内数据、`docs/`、README 或本 CI 规划配置时，继续运行后端、小程序和部署脚本检查，但跳过生产部署。运行代码、依赖、迁移或部署输入变化仍按原流程发布。无法识别本次 push 的前置提交时只检查；手动运行工作流并勾选 `full=true` 可明确要求部署。PR 始终只检查。

GitHub Actions 自动 CI/CD 配置见 [接入与操作说明](docs/ops/2026-10-23-automatic-cicd.md)：PR 运行检查，main push 检查成功后自动部署后端。首次需要配置服务器专用 SSH 密钥和仓库 Secrets；是否已启用及最近部署结果以 GitHub Actions 为准。小程序仍需单独上传审核发布。

后端和 MySQL 已部署云端，手动备份恢复已验证；本地及云端数据库均完成 `t_` 前缀和注释升级，本地账目与月预算已合并至云端，云端原有记录保留（真实账目数量不公开）。操作与回退边界见 [迁移记录](docs/ops/2026-10-22-mysql-prefix-data-migration.md)。HTTPS/域名、自动备份、入口限流、真机验证以及小程序备案、隐私说明和审核尚待完成，不能据此确认正式上线就绪。iCost 重定位（M1）已完成代码与隔离测试验证，真实库 005 迁移（DROP 家庭三表）需先备份再执行，UI 需在微信开发者工具中按原型逐屏核对。

后端默认微信认证；显式的 development 令牌模式只供本地后端测试，新小程序不使用该令牌。设置 COST_ENV=production 后，程序禁止开发令牌认证及内存存储，但这些检查不代替部署和发布验收。

## Redis 可选资料缓存

配置 `COST_REDIS_ADDR` 与 `COST_REDIS_PASSWORD` 后，后端使用 Redis 缓存分类与账本资料五分钟，修改成功后立即逻辑失效；Redis 故障回退数据库。两项同时为空时禁用，不影响现有部署。账单、统计、余额与认证保持原数据库流程。当前实现面向单 API 进程，扩容前须改为共享失效。服务器启用、回退和 HIT 验收见 [Redis 资料缓存](docs/ops/2026-11-04-redis-reference-cache.md)。
