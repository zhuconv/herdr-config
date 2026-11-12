# herdr-config

我的 [Herdr](https://herdr.dev) 配置。新电脑上一条命令装好，改完一条命令同步。

## 新电脑

先装好 Herdr 并打开一次，然后：

```sh
gh repo clone zhuconv/herdr-config ~/herdr-config && ~/herdr-config/install.sh
```

脚本会被替换的文件先备份到 `~/.config/herdr-app.backup-<时间>/`，可以重复运行。最后它会提示两步需要手动做的事：在 Raycast 里给 "Go to Waiting Agent" 录 ⌘G，以及在辅助功能里允许 Raycast。

## 远程机器（Herdr 里的远程 space）

在远程机器的 Herdr 终端里直接运行的 Claude 会话，也能在 ⌃Tab 卡片上显示最近的 prompt 和回复，但要先给那台机器装上 hook（那台需要有 python3）：

```sh
./install.sh --remote a5k      # 机器名来自 hc machine ls
```

已经装好的有 a5k、2a5k、4vita2、4vita5。vista 不适用：那里的 Claude 跑在计算节点上，连不到 login1 上的 hc。

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
| `herdr-app/layouts/my-main.json` | 布局 my-main：灰蓝色焦点框，左栏上面是 my-projects、下面是 my-agents |
| `herdr-app/mods/my-projects/` | 左上角 Projects：project 由若干个"机器 · 目录"组成，对话按所在目录归类（子目录跟父目录走），没归类的在 Unsorted。点 project 那一行，顶部 tab 栏就切到这个 project（回到上次用的 tab），折叠点那一行右边的小箭头。拖动目录胶囊可以在组内排序，或拖进别的 project（拖回 Unsorted 也行），也可以右键它移动、新建 project；胶囊上的色点就是它在顶部那一组的颜色；点开胶囊，路径右边的 + 在该目录新开 Claude；右键 project 改名、换图标或删除（目录回到 Unsorted）；拖动 project 排序 |
| `herdr-app/mods/my-tabs/` | 标签栏：只显示当前 project 的 tab（所有 space、所有机器），一个"机器 · 目录"一组：组前一个色点（和左栏胶囊的点同色，点它折叠），组下面一条同色细线。把 tab 拖到另一个 tab 中间合并成分屏（按住 ⌥ 是上下分），拖到边缘排序，不同机器的不能合并；分屏 tab 里的一段拖到空白处拆回单独的 tab。还有 Overview 按钮、关闭可恢复（reopen.js）、⌘G（waiting.js）、⌃Tab 的访问顺序（recent.js）。`projects.js` 是 my-projects/model.js 的拷贝（mod 不能引用别的 mod 的文件） |
| `herdr-app/mods/agent-switcher/` | ⌃Tab 弹窗 |
| `herdr-app/mods/my-agents/` | 左栏 Agents 列表，显示成 "agent · space" |
| `herdr-app/mods/agent-deck-*` | Overview 面板，来自 [zztalker/herdr-agent-deck](https://github.com/zztalker/herdr-agent-deck) |
| `herdr-app/settings.json`, `themes/warp-dracula.json` | 字体、主题、缩放、提示音 |
| `claude/agent-note` | Claude Code hook：记下最近一条 prompt 和回复的首尾句，给 ⌃Tab 卡片用；`install.sh` 会把它加进 `~/.claude/settings.json` |
| `raycast/` | 任何 app 里按 ⌘G 的 Raycast 脚本；`postkey.c` 让 VS Code 里的 ⌘G 照常查找下一个 |

不同步的：Herdr 自己写的状态（`shared.json`、`view.json`、`data/` 等）、hc 的机器配置（比如 vista，要在新电脑上 `hc machine add`）。
