# Cost 文档索引

项目概况和首次运行从 [项目 README](../README.md) 开始。

## 目录约定

| 目录 | 内容 |
|---|---|
| adr/ | 架构与技术决策：背景、选择、取舍和影响 |
| api/ | 接口、身份与权限约定 |
| ops/ | 本地运行、联调、迁移、验证与后续运维 |
| superpowers/ | 开发流程，以及 specs/ 设计、plans/ 实施计划 |

专题文档统一使用 `YYYY-MM-DD-english-topic.md`，英文小写，以连字符分隔。日期为文档建立日期，不因小幅修订而更名；历史过程和验证记录在正文注明实际发生日期。入口文件保留 `README.md`，仓库工具入口保留 `AGENTS.md`、`CLAUDE.md`。目录索引随着新增文档更新。

## 架构决策

- [2026-10-22：统一仓库与家庭认证](adr/2026-10-22-monorepo-and-family-auth.md)（实现后补录）
- [ADR 索引及编写规则](adr/README.md)

## 接口

- [2026-11-22：Cost 本机 MCP 工具契约](api/2026-11-22-readonly-mcp-api.md)

- [2026-10-22：微信登录与家庭 API](api/2026-10-22-wechat-auth-and-family-api.md)
- [2026-11-03：微信登录昵称 API](api/2026-11-03-wechat-nickname-api.md)
- [2026-11-03：微信登录昵称记录设计](superpowers/specs/2026-11-03-wechat-nickname-design.md)
- [2026-11-03：微信登录昵称实施计划](superpowers/plans/2026-11-03-wechat-nickname.md)
- [2026-11-03：微信登录昵称验证与升级](ops/2026-11-03-wechat-nickname-validation.md)
- [2026-11-03：账本资料编辑 API](api/2026-11-03-ledger-profile-api.md)
- [2026-11-03：账本编辑与昵称复用设计](superpowers/specs/2026-11-03-ledger-profile-editing-design.md)
- [2026-11-03：账本编辑实施计划](superpowers/plans/2026-11-03-ledger-profile-editing.md)
- [2026-11-03：账本编辑验证记录](ops/2026-11-03-ledger-profile-validation.md)

## 运行与验证

- [2026-11-22：Cost MCP 验证与接入状态](ops/2026-11-22-readonly-mcp-validation.md)

- [仅测试与文档变更不部署：设计（补录）](superpowers/specs/2026-11-17-check-only-ci-design.md)
- [仅测试与文档变更不部署：实施记录（补录）](superpowers/plans/2026-11-17-check-only-ci.md)

- [2026-11-13：审核登录生产接口修复设计](superpowers/specs/2026-11-13-review-production-backend-design.md)
- [2026-11-13：审核登录修复计划](superpowers/plans/2026-11-13-review-production-backend.md)
- [2026-11-13：审核登录修复验证与提审步骤](ops/2026-11-13-review-production-backend-validation.md)

- [2026-11-11：分类线性图标与统一入口设计](superpowers/specs/2026-11-11-category-line-icons-design.md)
- [2026-11-11：分类线性图标实施计划](superpowers/plans/2026-11-11-category-line-icons.md)
- [2026-11-11：分类线性图标 API 与迁移](api/2026-11-11-category-line-icons-api.md)
- [2026-11-11：分类线性图标验证](ops/2026-11-11-category-line-icons-validation.md)

- [2026-11-11：分类候选图标接入设计](superpowers/specs/2026-11-11-category-icons-design.md)
- [2026-11-11：分类候选图标接入计划](superpowers/plans/2026-11-11-category-icons.md)
- [2026-11-11：分类图标迁移与验证](ops/2026-11-11-category-icons-validation.md)

- [2026-11-11：底部导航图标设计](superpowers/specs/2026-11-11-tabbar-icons-design.md)（补录）
- [2026-11-11：底部导航图标实施记录](superpowers/plans/2026-11-11-tabbar-icons.md)（补录）
- [2026-11-11：底部导航图标验证](ops/2026-11-11-tabbar-icons-validation.md)

- [2026-11-11：移除账单导出设计](superpowers/specs/2026-11-11-remove-bill-export-design.md)
- [2026-11-11：移除账单导出实施计划](superpowers/plans/2026-11-11-remove-bill-export.md)
- [2026-11-11：移除账单导出验证](ops/2026-11-11-remove-bill-export-validation.md)

- [2026-11-04：Redis 资料缓存启用与验收](ops/2026-11-04-redis-reference-cache.md)
- [2026-11-04：Redis 资料缓存设计](superpowers/specs/2026-11-04-redis-reference-cache-design.md)
- [2026-11-04：Redis 资料缓存计划](superpowers/plans/2026-11-04-redis-reference-cache.md)

- [2026-11-04：Redis 安装与记账返回首页耗时诊断](ops/2026-11-04-redis-homepage-diagnostics.md)
- [2026-11-04：Redis 与首页诊断设计](superpowers/specs/2026-11-04-redis-homepage-diagnostics-design.md)
- [2026-11-04：Redis 与首页诊断计划](superpowers/plans/2026-11-04-redis-homepage-diagnostics.md)

- [2026-11-04：账单账户标签与搜索回归设计](superpowers/specs/2026-11-04-entry-account-and-search-design.md)
- [2026-11-04：账单账户标签实施计划](superpowers/plans/2026-11-04-entry-account-and-search.md)
- [2026-11-04：账单账户标签验证记录](ops/2026-11-04-entry-account-and-search-validation.md)
- [2026-11-04：首页头像优先展示设计](superpowers/specs/2026-11-04-ledger-header-avatar-design.md)
- [2026-11-04：首页头像实施计划](superpowers/plans/2026-11-04-ledger-header-avatar.md)
- [2026-11-04：首页头像验证](ops/2026-11-04-ledger-header-avatar-validation.md)

- [2026-11-03：CI 字段数量断言修复](ops/2026-11-03-ci-schema-count-fix.md)
- [2026-11-03：微信头像 API](api/2026-11-03-wechat-avatar-api.md)
- [2026-11-03：微信头像设计](superpowers/specs/2026-11-03-wechat-avatar-design.md)
- [2026-11-03：微信头像实施计划](superpowers/plans/2026-11-03-wechat-avatar.md)
- [2026-11-03：微信头像验证记录](ops/2026-11-03-wechat-avatar-validation.md)

- [2026-10-22：微信小程序本地开发](ops/2026-10-22-miniprogram-local-development.md)
- [2026-10-22：统一仓库与登录改造验证记录](ops/2026-10-22-monorepo-wechat-auth-validation.md)

## Superpowers

- [2026-11-22：只读 MCP 设计（已确认）](superpowers/specs/2026-11-22-readonly-mcp-design.md)
- [2026-11-22：只读 MCP 实施计划](superpowers/plans/2026-11-22-readonly-mcp.md)

- [2026-10-22：开发流程规范](superpowers/2026-10-22-development-workflow.md)
- [2026-10-27：环境与开发发布规范](superpowers/2026-10-27-environment-development-workflow.md)
- [数据库迁移模板](superpowers/templates/migration-template.md)
- [2026-10-22：统一仓库与微信登录设计补录](superpowers/specs/2026-10-22-monorepo-wechat-auth-design.md)

原统一仓库与登录改造没有事前实施计划，不补造计划文件或审批记录。后续计划写入 `superpowers/plans/`，并在此添加链接。尚未形成研究或代码地图文档，不创建只有名字的空目录。

## Docker 云端部署

- [2026-10-22：Docker 空账本部署设计](superpowers/specs/2026-10-22-docker-empty-ledger-deployment-design.md)
- [2026-10-22：Docker 部署实施计划](superpowers/plans/2026-10-22-docker-empty-ledger-deployment.md)

容器及空账本已部署，域名/HTTPS 暂缓，实际执行与未覆盖项见验证记录。

- [2026-10-22：Docker 云端部署与运维](ops/2026-10-22-docker-cloud-deployment.md)

- [2026-10-22：Docker 云端部署验证](ops/2026-10-22-docker-cloud-validation.md)

## 数据库表前缀与数据迁移

- [2026-10-22：MySQL 表说明、字段字典与前缀注释设计](superpowers/specs/2026-10-22-mysql-table-prefix-comments-design.md)（2026-11-04 补录：迁移至 008 的 9 张表、63 个字段及历史家庭表说明）
- [2026-10-22：MySQL 前缀与迁移实施计划](superpowers/plans/2026-10-22-mysql-table-prefix-comments.md)
- [2026-10-22：两端升级及本地数据合并云端记录](ops/2026-10-22-mysql-prefix-data-migration.md)

## 自动 CI/CD

- [2026-10-23：设计](superpowers/specs/2026-10-23-automatic-cicd-design.md)
- [2026-10-23：实施计划](superpowers/plans/2026-10-23-automatic-cicd.md)
- [2026-10-23：初始化、自动部署和故障处理](ops/2026-10-23-automatic-cicd.md)

## iCost 重定位（M1 核心闭环）

- [2026-10-27：开发与发布环境配置](ops/2026-10-27-environment-configuration.md)
- [2026-10-27：记账键盘操作键布局修复](ops/2026-10-27-keypad-button-layout.md)
- [2026-10-27：第一批 UI 缺陷修复（展示层）](ops/2026-10-27-ui-display-fixes.md)
- [2026-10-27：统计页导航与排版修复（第二批）](ops/2026-10-27-stats-nav-layout.md)
- [2026-10-27：明细吸顶、列表金额配色与计算器连算（第三批）](ops/2026-10-27-ledger-sticky-d1-calc.md)
- [2026-10-27：字形毛刺真机测试安排](ops/2026-10-27-real-device-glyph-artifact-test.md)
- [2026-10-26：v4.3 主流程修复设计](superpowers/specs/2026-10-26-icost-rescue-design.md)
- [2026-10-26：主流程修复执行记录](superpowers/plans/2026-10-26-icost-rescue.md)
- [2026-10-26：主流程修复验证与升级说明](ops/2026-10-26-icost-rescue-validation.md)
- [2026-10-26：重定位设计（单人账本、统计与预算）](superpowers/specs/2026-10-26-icost-realignment-design.md)
- [2026-10-26：M1 实施计划](superpowers/plans/2026-10-26-icost-realignment.md)
- [2026-10-26：单人账本、统计与预算 API](api/2026-10-26-icost-realignment-api.md)
- [2026-10-26：M1 验证记录](ops/2026-10-26-icost-realignment-validation.md)

## 功能需求清单

- 需求依据为 Master 提供的《cost-原型与需求说明-iCost对标-v2.1.md》与《cost_可交互原型_v4.html》
  （位于 `~/Documents/cost_need/`，含 22 张 iCost 实拍截图 S01~S22），由重定位设计文档引用，不在本仓库内。

## P0 核心功能

- [F01–F04 设计](superpowers/specs/2026-10-23-p0-ledger-design.md)
- [实施计划](superpowers/plans/2026-10-23-p0-ledger.md)
- [搜索、分类、账户与转账 API](api/2026-10-23-p0-ledger-api.md)
- [自动备份与恢复检查](ops/2026-10-23-automatic-backups.md)
- [实现验证与发布检查](ops/2026-10-23-p0-ledger-validation.md)
