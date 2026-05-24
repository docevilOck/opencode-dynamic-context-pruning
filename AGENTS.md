<!-- AGENTS.md — 由 project-architecture-init 自动生成 -->

## 项目架构文档

本仓库已建立项目级架构文档，位于 `docs/architecture/`。

### 读写规则

- 在修改代码之前，先阅读相关模块的架构文档，确认职责边界和目录映射
- 架构变更时（新增/删除模块、文件迁移、职责变化），同步更新 `docs/architecture/` 下对应的文档和本规则
- 如果架构文档中标注了“仓库目录映射”，以映射路径为准，不要靠推测找文件

### 文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 架构总览 | `docs/architecture/26-05-23_01_架构总览.md` | 模块全景图、模块列表、顶层目录结构 |
| 启动与宿主集成 | `docs/architecture/modules/26-05-23_02_启动与宿主集成.md` | 插件入口、hook 组装、认证与自动更新 |
| 配置与权限 | `docs/architecture/modules/26-05-23_03_配置与权限.md` | 多层配置合并和 compress 权限裁决 |
| 会话状态与持久化 | `docs/architecture/modules/26-05-23_04_会话状态与持久化.md` | SessionState、持久化和引用编号 |
| 消息处理链路 | `docs/architecture/modules/26-05-23_05_消息处理链路.md` | 消息过滤、查询、注入、子代理结果合并 |
| 压缩引擎 | `docs/architecture/modules/26-05-23_06_压缩引擎.md` | range/message 压缩工具和块状态维护 |
| 命令系统 | `docs/architecture/modules/26-05-23_07_命令系统.md` | `/dcp` 子命令和命令执行拦截 |
| 提示词系统 | `docs/architecture/modules/26-05-23_08_提示词系统.md` | prompt 装配、覆盖和运行时扩展 |
| 辅助与工具 | `docs/architecture/modules/26-05-23_09_辅助与工具.md` | 日志、token 统计、通知、认证和更新 |
