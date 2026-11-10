# herdr-config

我的 [Herdr](https://herdr.dev) 配置。新电脑上一条命令装好，改完一条命令同步。

## 新电脑

先装好 Herdr 并打开一次，然后：

```sh
gh repo clone zhuconv/herdr-config ~/herdr-config && ~/herdr-config/install.sh
```

脚本会被替换的文件先备份到 `~/.config/herdr-app.backup-<时间>/`，可以重复运行。最后它会提示两步需要手动做的事：在 Raycast 里给 "Go to Waiting Agent" 录 ⌘G，以及在辅助功能里允许 Raycast。

## 改了配置之后

在改过的那台电脑上：

```sh
./save.sh          # 把当前配置拷回仓库，commit 并 push
```

其他电脑：

```sh
git pull && ./install.sh
```

## 里面有什么

| 位置 | 内容 |
|---|---|
| `herdr-app/keys.json` | 快捷键：⌘W 分层关闭、⌘⇧W/⌘⇧T 恢复、⌘HJKL 切窗格、⌘G 跳到响铃的 agent、⌃Tab 切换最近的 agent |
| `herdr-app/layouts/my-main.json` | 布局 my-main：灰蓝色焦点框，左栏用 my-agents |
| `herdr-app/mods/my-tabs/` | 标签栏：Overview 按钮、关闭可恢复（reopen.js）、⌘G（waiting.js）、⌃Tab 的访问顺序（recent.js） |
| `herdr-app/mods/agent-switcher/` | ⌃Tab 弹窗 |
| `herdr-app/mods/my-agents/` | 左栏 Agents 列表，显示成 "agent · space" |
| `herdr-app/mods/agent-deck-*` | Overview 面板，来自 [zztalker/herdr-agent-deck](https://github.com/zztalker/herdr-agent-deck) |
| `herdr-app/settings.json`, `themes/warp-dracula.json` | 字体、主题、缩放、提示音 |
| `claude/agent-note` | Claude Code hook：记下最近一条 prompt 和回复的首尾句，给 ⌃Tab 卡片用；`install.sh` 会把它加进 `~/.claude/settings.json` |
| `raycast/` | 任何 app 里按 ⌘G 的 Raycast 脚本；`postkey.c` 让 VS Code 里的 ⌘G 照常查找下一个 |

不同步的：Herdr 自己写的状态（`shared.json`、`view.json`、`data/` 等）、hc 的机器配置（比如 vista，要在新电脑上 `hc machine add`）。
