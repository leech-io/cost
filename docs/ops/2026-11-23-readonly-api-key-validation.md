# 只读 API key 验证记录

2026-11-23，macOS arm64，Go 1.27.3。以下命令均在 `backend/` 或仓库根目录实际执行并读取输出。

## 静态检查与单元测试

| 命令 | 结果 |
|---|---|
| `gofmt -l .` | 无输出 |
| `go vet ./...` | 通过 |
| `go test -race -count=1 ./...` | 7 个包全部 `ok`（cmd/api、internal/api、auth、cache、domain、store） |
| `COST_TEST_MYSQL_ADMIN_DSN='root@tcp(127.0.0.1:3306)/?parseTime=true' go test -count=1 -run 'MySQL|Integration' -v ./internal/api/` | PASS（隔离临时库，测试后 DROP）；`TestRedisIntegrationReferenceRoutes` 因缺隔离 Redis 按设计 SKIP |

本机 MySQL 为 `127.0.0.1:3306` 的本地实例；测试只创建并删除随机命名的 `cost_test_*` 库，不触碰应用库。

## 本地端到端

以 `COST_ENV=development COST_STORE=memory COST_AUTH_MODE=wechat`（假微信凭据）启动临时实例，监听 `127.0.0.1:18099`，key 为 64 位十六进制测试串：

| 请求 | 结果 |
|---|---|
| `GET /health` | `{"auth_mode":"wechat","status":"ok"}` |
| `GET /api/v1/categories` + 正确 key | 200 |
| `POST /api/v1/categories` + 正确 key | 403 `{"error":"read_only_key"}` |
| `GET /api/v1/categories` + 错误 key | 401 |

临时二进制与日志在验证后删除。

## 未验证

- 云端部署、生产 `COST_APIKEY_SHA256`、真实 key 调用 `api.xiachen.xyz`：待用户重建镜像并配置环境变量。
- 微信登录与昵称流程只在单元/集成测试覆盖，未在真机复测；本次未改会话逻辑。
- 未执行独立代码审查。
