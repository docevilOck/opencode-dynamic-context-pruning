# Dynamic Context Pruning 插件

[English](README.md)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/dansmolsky)
[![npm version](https://img.shields.io/npm/v/@tarquinen/opencode-dcp.svg)](https://www.npmjs.com/package/@tarquinen/opencode-dcp)

通过管理会话上下文，自动降低 OpenCode 中的 token 使用量。

![DCP in action](assets/images/dcp-demo9.png)

## 安装

通过 CLI 安装：

```bash
opencode plugin @tarquinen/opencode-dcp@latest --global
```

该命令会安装包，并把它加入你的全局 OpenCode 配置。

可用语言版本：

- [English](README.md)
- [简体中文](README.zh-CN.md)

## 工作原理

DCP 通过 `compress` 工具和自动清理机制缩减上下文体积。它不会修改你的会话历史，而是在请求发送给 LLM 之前，用占位内容替换掉已裁剪的部分。

### Compress

`Compress` 是暴露给模型使用的工具，它会把已经结束、且不再需要逐字保留的对话内容，替换成高保真的技术摘要。你可以把它理解为比 OpenCode 自带 compaction 更聪明的版本。它不是在会话触达最大上下文时对整段编程会话做一次静态压缩，而是允许模型在任务完成后自行决定何时触发，并且只压缩那些已经不需要保留原文的特定消息。

DCP 支持两种压缩模式：

- `range` 模式：压缩连续的一段对话，生成一个或多个摘要。
- `message` 模式（实验性）：独立压缩单条原始消息，让模型能更精细地管理上下文。

在 `range` 模式下，如果新的压缩范围与旧压缩范围重叠，旧摘要会被嵌套进新摘要，避免多轮压缩后信息被逐层稀释。两种模式都会保留受保护的工具输出（例如 subagent 和 skill）以及受保护的文件模式，确保关键上下文不会丢失。你还可以开启 `protectUserMessages`，在压缩时完整保留用户消息；但要注意，如果你经常把大段日志直接粘贴进提示词，这些内容之后也不会再被压缩掉。

### 去重

识别重复的工具调用（工具名相同、参数相同），仅保留最新一次输出。该逻辑会在 `compress` 运行时重新计算，因此只有和压缩同时发生时才会影响 prompt cache。

### 清理错误输入

在可配置的轮数之后（默认 4 轮），裁剪掉执行失败的工具调用输入。错误信息本身会保留，只移除可能很大的输入内容。该逻辑同样会在使用 `compress` 工具时重新计算。

## 配置

DCP 使用独立配置文件，按以下顺序查找：

1. 全局：`~/.config/opencode/dcp.jsonc`（或 `dcp.json`），首次运行时自动创建
2. 自定义配置目录：如果设置了 `OPENCODE_CONFIG_DIR`，则查找 `$OPENCODE_CONFIG_DIR/dcp.jsonc`（或 `dcp.json`）
3. 项目级：项目目录下 `.opencode/dcp.jsonc`（或 `dcp.json`）

后面的层级会覆盖前面的层级，因此项目配置优先级最高。修改配置后需要重启 OpenCode。

### 配置模板

下面这份 `默认配置` 本身就可以直接作为完整模板使用。

通常分成两份配置：

- `opencode.json`：注册插件路径
- `dcp.jsonc`：配置 DCP 行为，包括 backend 压缩模型

> [!NOTE]
> 如果你使用较小上下文窗口的模型，例如 GitHub Copilot 系列模型或本地模型，建议把 `compress.minContextLimit` 和 `compress.maxContextLimit` 调低到与实际上下文容量匹配。

> [!IMPORTANT]
> 默认配置会自动生效。只有在你想查看或覆盖默认值时，才需要展开下面的内容。

<details>
<summary><strong>默认配置</strong>（点击展开）</summary>

```jsonc
{
    "$schema": "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
    // 启用或禁用插件
    "enabled": true,
    // 当 npm 上出现更新的 latest 版本时，自动更新通过 npm 安装的 DCP
    // 锁定具体版本号的插件声明不会自动更新
    "autoUpdate": true,
    // 启用调试日志，输出到 ~/.config/opencode/logs/dcp/
    "debug": false,
    // 通知展示级别："off"、"minimal" 或 "detailed"
    "pruneNotification": "detailed",
    // 通知类型："chat"（会话内）或 "toast"（系统弹窗）
    "pruneNotificationType": "chat",
    // Slash 命令配置
    "commands": {
        "enabled": true,
        // 通过命令保护不被裁剪的额外工具（例如 /dcp sweep）
        "protectedTools": [],
    },
    // 手动模式：关闭自治上下文管理，
    // 工具只会在显式触发 /dcp 命令时运行
    "manualMode": {
        "enabled": false,
        // 为 true 时，即使在手动模式下，
        // 自动清理（deduplication、purgeErrors）仍然会执行
        "automaticStrategies": true,
    },
    // 在工具调用后的 <turns> 轮消息内保护其不被裁剪
    "turnProtection": {
        "enabled": false,
        "turns": 4,
    },
    // 实验性配置
    "experimental": {
        // 允许 DCP 在 subagent 会话中生效
        "allowSubAgents": false,
        // 启用 dcp-prompts 目录下的用户自定义提示词覆盖
        // 默认为 false，此时会忽略这些覆盖文件和目录
        "customPrompts": false,
    },
    // 通过 glob 模式保护文件操作不被裁剪
    // 模式匹配的是 tool parameters.filePath（例如 read/write/edit）
    "protectedFilePatterns": [],
    // 统一的上下文压缩工具与行为配置
    "compress": {
        // 压缩模式："range"（把一段内容压成块级摘要）
        // 或实验性的 "message"（压缩单条原始消息）
        "mode": "range",
        // 权限模式："allow"（不提示）、"ask"（提示确认）、"deny"（不注册工具）
        "permission": "allow",
        // 在聊天通知中展示压缩内容
        "showCompression": false,
        // 允许活跃摘要 token 扩展有效 maxContextLimit
        "summaryBuffer": true,
        // 软上限：超过后，DCP 会持续注入更强的压缩提示
        // （频率由 nudgeFrequency 控制），从而显著提高压缩触发概率
        // 支持数字或 "X%" 形式，表示模型上下文窗口的百分比
        "maxContextLimit": 100000,
        // 软下限：低于该值时，不再发出轮次/迭代提醒
        // 达到或超过该值时，提醒重新开启
        // 支持数字或 "X%" 形式
        "minContextLimit": 50000,
        // 可选：按 providerID/modelID 为 maxContextLimit 单独覆写
        // 如果设置了，该值优先于全局 maxContextLimit
        // 支持数字或 "X%"
        // 示例：
        // "modelMaxLimits": {
        //     "openai/gpt-5.3-codex": 120000,
        //     "anthropic/claude-sonnet-4.6": "80%"
        // },
        // 可选：按模型覆写 minContextLimit
        // 如果设置了，该值优先于全局 minContextLimit
        // "modelMinLimits": {
        //     "openai/gpt-5.3-codex": 50000,
        //     "anthropic/claude-sonnet-4.6": "25%"
        // },
        // 上下文阈值提示的触发频率（1 = 每次 fetch，5 = 每 5 次触发一次）
        "nudgeFrequency": 5,
        // 自上一次用户消息后，累计到多少条消息开始添加压缩提醒
        "iterationNudgeThreshold": 15,
        // 控制用户消息后压缩提醒的强度
        // "strong" = 更容易压缩，"soft" = 较弱
        "nudgeForce": "soft",
        // 这些工具的完成输出会被追加进压缩摘要
        "protectedTools": [],
        // 压缩时保留包裹在 <protect>...</protect> 中的文本
        "protectTags": false,
        // 压缩时保留你的消息原文
        // 注意：大段粘贴进来的提示内容将不会再被压缩
        "protectUserMessages": false,
        // 可选：使用独立 backend 模型生成压缩摘要
        // 开启后，主模型只传消息 ID / range ID，
        // DCP 会创建隔离 session 并调用该模型生成 summary
        // 要启用它，把 enabled 设为 true，并填写 providerID/modelID 格式的 model
        "backend": {
            "enabled": false,
            "mode": "session-prompt",
            "timeoutMs": 60000,
            // "model": "openai/gpt-5-mini"
        },
    },
    // 自动裁剪策略
    "strategies": {
        // 删除重复的工具调用（同名工具 + 相同参数）
        "deduplication": {
            "enabled": true,
            // 额外保护不被裁剪的工具
            "protectedTools": [],
        },
        // 对失败工具，在 X 轮后裁剪其输入
        "purgeErrors": {
            "enabled": true,
            // 失败工具输入在多少轮之后被裁剪
            "turns": 4,
            // 额外保护不被裁剪的工具
            "protectedTools": [],
        },
    },
}
```

</details>

### Compress Backend 独立模型模式

默认情况下，主模型调用 `compress` 工具时会同时传入目标 ID 和最终 `summary`。你也可以开启独立 backend 模型：

```jsonc
{
    "compress": {
        "backend": {
            "enabled": true,
            "mode": "session-prompt",
            "timeoutMs": 60000,
            "model": "openai/gpt-5-mini",
        },
    },
}
```

开启 backend 模式后：

- `model` 必须是 `providerID/modelID` 形式的单个字符串
- 主模型不再传 `summary`，工具 schema 只接受 `messageId` 或 `startId`/`endId`
- DCP 会创建一个隔离的 backend session，把选中的对话内容发送给配置的模型
- 每次压缩都会额外增加一次模型调用
- 如果 backend 生成失败，本次压缩直接失败，不会回退到主模型摘要
- 该 backend 模型也必须已经在当前机器的 OpenCode provider/model 配置中可用
- 如果你是从上面的完整模板开始改，只需要把 `compress.backend.enabled` 改成 `true`，再填写 `compress.backend.model`

### 命令

DCP 提供 `/dcp` slash 命令：

- `/dcp`：显示可用的 DCP 命令
- `/dcp context`：显示当前会话的 token 占用拆分（system、user、assistant、tools 等），以及通过裁剪节省了多少
- `/dcp stats`：显示所有会话累计的裁剪统计信息
- `/dcp sweep`：裁剪自上一条用户消息以来的所有工具输出。可附带可选数量参数，例如 `/dcp sweep 10` 表示裁剪最近 10 次工具调用。遵循 `commands.protectedTools`
- `/dcp manual [on|off]`：切换手动模式，或显式设置开关状态。开启后，AI 不会再自动使用上下文管理工具
- `/dcp compress [focus]`：执行一次 `compress`。可选 `focus` 文本用于指定要压缩的内容，具体行为遵循当前 `compress.mode`
- `/dcp decompress <n>`：按 ID 恢复一个当前生效的压缩结果，例如 `/dcp decompress 2`。不带参数执行时，会列出可恢复的压缩 ID、token 体积和主题
- `/dcp recompress <n>`：按 ID 重新应用一个已被用户解压的压缩结果，例如 `/dcp recompress 2`。不带参数执行时，会列出可重新压缩的 ID、token 体积和主题

### 提示词覆盖

DCP 暴露了 6 个可编辑提示词：

- `system`
- `compress-range`
- `compress-message`
- `context-limit-nudge`
- `turn-nudge`
- `iteration-nudge`

该功能默认关闭。需要在 DCP 配置中将 `experimental.customPrompts` 设为 `true` 才会启用。

启用后，系统会把默认提示词写入 `~/.config/opencode/dcp-prompts/defaults/`，以纯文本文件形式保存。该目录下会附带一个 `README.md`，说明每个提示词的用途，以及如何创建覆盖文件。

如果你想自定义行为，只需在 overrides 目录下放置同名文件，并以纯文本方式编辑即可。

如果你想重置某个覆盖项，删除对应的覆盖文件即可。

### 受保护工具

默认情况下，以下工具始终不会被裁剪：
`task`、`skill`、`todowrite`、`todoread`、`compress`、`batch`、`plan_enter`、`plan_exit`、`write`、`edit`

`commands` 和 `strategies` 中的 `protectedTools` 数组，都会在这份默认列表基础上继续追加。

对于 `compress` 工具，`compress.protectedTools` 用于确保指定工具输出被附加到压缩摘要中。默认包含 `task`、`skill`、`todowrite` 和 `todoread`。

## 对 Prompt Caching 的影响

LLM 提供商通常依赖“前缀完全匹配”来命中 prompt cache。DCP 一旦裁剪内容，就会改写消息，因此从那个位置开始，旧的缓存前缀会失效。

**权衡点：** 你会损失一部分 cache read，但会换来更小的上下文、更低的 token 消耗，以及更少由陈旧上下文引起的幻觉。在大多数长会话场景里，这种收益通常大于缓存失效的代价。

> [!NOTE]
> 根据测试，开启 DCP 时缓存命中率大约为 85%，不开启时约为 90%。

**以下场景基本不受影响：**

- **按请求计费**：例如 GitHub Copilot 这类按请求次数而不是按 token 计费的提供商
- **缓存与非缓存 token 同价**：例如 Cerebras 这类对缓存 token 和普通 token 采用同样计费方式的提供商

## 许可证

AGPL-3.0-or-later
