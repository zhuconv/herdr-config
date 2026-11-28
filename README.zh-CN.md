# herdr-config

[English](README.md) | 中文

**我的 [Herdr](https://herdr.dev) 桌面版配置，为在好几台机器上同时跑很多个 Claude Code 会话而做。**

一个 project 可以跨机器、跨目录。顶部 tab 栏一次只显示一个 project，按目录分组，其余靠快捷键。新电脑上一条命令装好，改完一条命令存回仓库。

![装好这套配置的 Herdr：左边是 Projects 面板，顶部是当前 project 按目录分组的 tab，左下是 Agents 列表](docs/herdr-demo.png)

**在浏览器里试：**[zhuconv.github.io/herdr-config](https://zhuconv.github.io/herdr-config/) 是这套配置的可点击模型，用的是示例名字。把 tab 拖到一起、点 project 的 **+**、到处右键试试；角落里的卡片写了可以试哪些操作。

## 能做什么

- **Projects 面板**（左上）。一个 project 由若干个"机器 · 目录"组成。每个 Claude 对话归到包含它所在目录的 project（子目录跟父目录走），没归类的在 Unsorted。点 project 那一行折叠/展开。点目录胶囊列出它的对话；你所在的那个胶囊会自己打开。拖动胶囊，或右键它，可以挪到别的 project。
- **在 ActivityWatch 里按 project 记时间。** Herdr 的窗口标题写着你正在用的对话和它的 project（按 Projects 面板的归法）：`Herdr — <project> · <对话> · <程序>`，比如 `Herdr — paper · fix-figures · Claude Code`。ActivityWatch 的窗口监视器记录前台窗口的标题，所以每个 project 写一条分类规则（`^Herdr — paper( ·|$)`），就能统计每个 project 花的时间，人不在电脑前的时间不算。shell 没有对话这一段（`Herdr — paper · zsh`），归到它所在 tab 的 project；不属于任何 project 的目录跟面板一样算 Unsorted（`Herdr — Unsorted · …`）。Herdr 自己的窗口里看不到这个标题：Window 菜单、Dock 菜单、调度中心和共享屏幕时选窗口的列表里才看得到。
- **在任意机器上新建目录。** project 那一行右边的 **+**（或右键 → New directory…）：选机器、填路径，边输入边提示那台机器上的文件夹（Tab 补全），在那台机器上建好目录、加进这个 project，并在里面开 Claude。
- **一次只看一个 project 的 tab。** 顶部栏显示当前 project 在所有 space、所有机器上的 tab，按目录分组。一个目录有两个以上 tab 时，前面一个色点、下面一条细线。tab 上只写 agent 的名字，左边的编号就是 ⌘1–⌘9 用的号。
- **拖动分屏。** 把一个 tab 拖到另一个上面合成分屏（按住 ⌥ 是上下分），拖到边缘是排序。拆回来：把名字从分屏 tab 里拖出来、右键它，或者点窗格标题栏上的按钮。
- **Fork 一个对话。** 鼠标移到 Claude 窗格的标题栏上，点 Fork：旁边开出这段对话的一个副本，同一台机器、同一个目录，名字是「<名字> (fork)」（用的是 Claude Code 自己的 `--resume <id> --fork-session`）。`claude attach` 打开的后台会话也能 Fork，原来的会话照常进行，不受影响。在 Slurm 集群上，跑在计算节点上的 Claude（窗格经 ssh 或 idev 连过去的）也能 Fork，副本开在那个计算节点上：新窗格在 login 节点上，只负责 ssh 过去，Claude 不会跑在 login 节点上。
- **后台会话也算。** 用 `claude attach` 打开的会话也出现在面板、tab 栏和 Agents 列表里，状态和前台 agent 一样：工作中、需要你、做完了（看过之前一直显示）。做完或需要你时，弹 Herdr 同样的提示、响同样的声音，⌘G 也能跳过去。状态取自 Claude Code 自己给每个会话记的记录，Mac 上的和服务器上的都算（`./install.sh --remote <机器>` 把 hook 装到服务器上）。
- **压缩对话不提醒。** Claude 在两个回合之间压缩对话时，会当成一个回合做完来报告。这包括它在空闲时自己做的压缩（长对话在最后一次回复约一小时后、prompt 缓存过期之前），也包括 `/compact`，所以 Herdr 会当成这个会话又做完了一次来提醒你。hook 在压缩开始时清掉窗格的状态，Herdr 就把压缩结束当成已经看过：不响声音、不弹提示，也不显示“做完了”。还没看过的完成照样保留标记。如果压缩开始时 Claude 本来就在工作（子代理的压缩，或者回合结束后后台代理还在跑），hook 就不动状态：这种压缩结束时 Claude 什么也不报告，状态清掉后会一直空着，通过 ssh 跑的 Claude 就会从 Agents 列表和 Projects 面板里消失。
- **关掉 manager 前先问。** 要关的窗格、tab 或 space 里有终端用 `hc run` 开过别的终端（比如 manager agent 的 worker）时，Herdr 会先问，并列出它们：哪些会继续跑但没法再汇报，哪些会跟着结束。选 Close，这些 worker 继续跑；选 End all，它们跟着一起结束，worker 自己起的 worker 也算（关 tab 的话是宽限期到了才结束，所以 ⌘⇧T 还能全部找回来）。鼠标停在哪个按钮上，它会结束的那几行就标红。点一个可以 peek 看它，关掉 peek 就回到这个问题。
- **在别的机器上开 worker。** 装了 `hc-workers` 这个 skill，你对话的那个 agent（manager，Claude 或 Codex 都行）可以在你的各台机器上开 Claude 或 Codex 会话，替它们处理确认提示，把它们的汇报转告给你。它们在 Agents 列表里挂在 manager 下面，你也可以直接打开任何一个，自己指挥。
- **一个 agent 一个名字。** Claude 的 tab 显示它的会话名，也就是 `/rename` 设的那个。改 tab 名（双击，或右键 → Rename），会话名跟着改：tab 栏等 Claude 空闲、输入框为空时替你输入 `/rename`，然后让 tab 重新跟随会话名。有 Codex 或好几个 agent 的 tab，只改 tab 名。
- **Antigravity CLI（agy）也一样。** agy 用对话名给自己的终端命名（hook 就是它的 title 命令）：`/rename` 起的名字，没有就用 agy 自己给对话起的标题。所以窗格标题栏、tab、Agents 列表、⌃Tab 和通知都用这个名字叫它，在 agy 里 `/rename` 一下，这些地方都跟着变。改它的 tab 名也会改对话名，和 Claude 一样。它的 ⌃Tab 卡片显示最近的 prompt 和回复；关掉的或退出的 agy，⌘⇧T 能接回来（`agy --conversation <id>`）。装这套之前就在跑的 agy，重开之后才显示名字。
- **退出的 agent 也能找回来。** 窗格里只跑着这个 agent 的（worker、manager、fork），agent 一退出（Ctrl+C、`/exit`、崩溃），窗格就跟着没了，tab 里只剩它时 tab 也没了。⌘⇧T 在原来的 tab 和目录里用 `claude --resume`（agy 用 `agy --conversation`）接回这个会话；这个会话要是已经在别处跑着，就跳到那里，不开第二份。
- **把 worker 留成 tab。** 鼠标移到 Agents 列表里 worker 那一行，点它的 keep 按钮（或者右键 → Keep as tab，或者在它的 peek 里点 keep）：它变成它自己那台机器上的一个 tab，视图跳过去。这个 tab 跟着启动它的 agent 走，不管它在哪个目录、哪台机器上跑：归到那个 agent 的 project 和胶囊里，在顶部栏里紧跟在它的 tab 后面。它那一行、它的窗格标题栏和左栏里的条目都标出它在哪台机器上。Send back（它的 tab、窗格和那一行的右键菜单里都有）把它送回启动者下面，继续运行。关掉它的 tab（⌘W 或 ×）也一样：关 tab 不会结束 worker，⌘⇧T 能再把它显示出来。
- **按名字找会话。** 装了 `hc-find` 这个 skill，agent 能按你平时叫的名字，找到你的另一个 Claude 或 Codex 会话（在它的 hc 连得到的任何机器上），并读它：现在的屏幕，或者最近几轮。要从连得到那台机器的地方问：Mac 全都连得到。
- **Claude 命令的短名。** `/ren <名字>` 就是 `/rename <名字>`，`/u` 是 `/usage`，`/m` 是 `/model`，`/st` 是 `/status`。短名后面打个空格，输入框里就换成完整的命令，回车就和打全名一样，后面的参数照带。短名后面直接回车也会跑对应的命令，只是 Claude 正在回答时，要等这一轮答完。Claude Code 自己没有给内置命令起别名的设置（[#94614](https://github.com/anthropics/claude-code/issues/94614) 等请求都被关掉了），所以这是一个 Claude Code mod，每个新会话都会加载。短名是 `agent-plugin/claude/mods/short-names/hooks/register.ts` 开头的一张表。
- **新的 Claude 会话自动起名。** 新会话根据第一条消息给自己起名，像聊天应用给对话起标题那样：Haiku 用两三个词概括这次的工作（`oauth-retry`、`csv-export`），而不是照抄消息的开头。这就是会话自己的名字，和 `/rename` 起的一样，所以输入框、窗格标题栏、tab、Agents 列表、`/resume` 和 hc 都显示它。第一条消息因此多等大约一秒。你起过的名字（`/rename`、`claude -n`、Fork 出来的）不会被改，旧会话也不会：只有新会话的前几条消息会给它起名。它在同一个 mod 里：`agent-plugin/claude/mods/short-names/hooks/register.ts`。
- **按别名切换 Claude 账号。** `/auth gt` 用 cswap（`uv tool install claude-swap`）存的登录，把你打这条命令的会话（连同它的 subagent）切到你叫 gt 的那个账号，整台机器和其他会话不动；`/auth off` 换回来，会话恢复后也还记得，输入框下面会有一行显示它。只打 `/auth` 会列出所有账号，以及哪些在这台机器上登录着；没登录或登录过期的账号会给出登录的命令。要让一台机器把还没登录的账号都登上，在那台机器的终端里跑 `~/.claude/mods/accounts/signin`：它一个接一个地登录，每登一个先存进 cswap 再登下一个，最后切回原来的账号。每台机器的每个账号都要在那台机器上自己登录：拷到另一台机器的登录，只要任何一边刷新一次就失效了。另外，会话发布的每个 artifact 链接都带上发布它的账号（`…#acct=gt`）：Zen 的 mod [Claude Accounts](https://github.com/zhuconv/zen-config-monorepo/tree/main/multi-cc-switcher) 会用那个账号打开它。你的别名和邮箱在 `~/.config/claude-accounts/accounts.json`，不在这个仓库里。它也是一个 Claude Code mod：`agent-plugin/claude/mods/accounts/hooks/register.ts`。

### 快捷键

| 按键 | 作用 |
|---|---|
| ⌥1–⌥9 | 显示从上往下第 N 个 project 的 tab。按住 ⌥ 能看到编号 |
| ⌘1–⌘8、⌘9 | 栏里第 N 个 tab；最后一个 tab |
| ⌃Tab、⌃⇧Tab | 回到你上一个待过的窗格：agent、后台会话、shell，甚至分屏的另一半都算。每张卡片显示最近的 prompt 和回复 |
| ⌘G | 跳到最近响铃（需要你，或者做完了）的 agent。它所在窗格的边框外会亮起一圈同色的光晕，随即淡出，一眼看出是 tab 里哪个窗格。配合 Raycast 在任何 app 里都能用 |
| ⌘W | 先关窗格，再关 tab，最后关 space。⌘⇧W 或 ⌘⇧T 恢复，退出的 agent 也会接回来 |
| ⌘T | 在当前 space 新开一个 tab |
| ⌘H ⌘J ⌘K ⌘L | 在窗格之间移动 |

如果当前机器连不上（比如在等登录），⌘T 和 ⌘W 在那台机器上做不了事，就改为打开一个本机终端，并在右下角提示登录命令。

## 需要什么

- macOS，装好 [Herdr](https://herdr.dev) 并打开过一次
- 登录好的 [GitHub CLI](https://cli.github.com)（`gh`），用来 clone 这个私有仓库
- Xcode Command Line Tools（`clang`），编译两个小程序
- Python 3 和 [Claude Code](https://claude.com/claude-code)，给 hook 用
- 可选：[Raycast](https://www.raycast.com)，让 ⌘G 在任何 app 里都能用

## 新电脑上安装

```sh
gh repo clone zhuconv/herdr-config ~/herdr-config && ~/herdr-config/install.sh
```

会被替换的文件先备份到 `~/.config/herdr-app.backup-<时间>/`，可以重复运行。最后它会列出两步需要手动做的事：在 Raycast 里给 "Go to Waiting Agent" 录 ⌘G，以及在辅助功能里允许 Raycast。

## 远程机器

在远程机器的 Herdr 终端里跑的 Claude 会话，也能填 ⌃Tab 卡片、显示工作中/空闲，前提是那台机器装了 hook（那台需要有 `python3`）。同一条命令也会把 `hc-workers` skill（这样那台机器上的 agent 也能当 manager）、Claude 命令的短名，以及 `/auth` 和这台 Mac 的账号表装过去（`/auth` 还需要那台机器上装了 cswap）：

```sh
./install.sh --remote <机器名>      # 来自 hc machine ls；每台机器跑一次
```

在 Slurm 集群上，Claude 跑在计算节点上，hook 通过 ssh 把标签交给 login 节点（`$HC_VIA`，或 idev 里 Slurm 给的 `$SLURM_SUBMIT_HOST`）。标签里也有对话所在的节点，所以 Fork 的副本也开在那个节点上。

## 改了配置之后

在改过的那台电脑上：

```sh
./save.sh          # 把当前配置拷回仓库，commit 并 push
```

其他电脑：

```sh
git pull && ./install.sh
```

## Herdr 提示更新时

更新不会覆盖这套配置：Herdr 只重写它自带的 mod 和布局，自带的被改过的话，会先挪到一边再写新版。它不保证的是这些 mod 更新后还能照常工作，因为有几处依赖了 Herdr 内部：⌘G 的光晕照抄了它算窗格位置的代码，合并 tab 直接改它的布局文档，从它那里复制来的 mod 也收不到它的改动。所以 Herdr 一有更新准备好，标签栏（my-tabs 的 `updatecheck.js`）就自动跑 `herdr-update-check`，在更新提示旁边弹一条通知说结果：可以直接 Restart、有几处要先看，或者先别更新。重启之后它再跑一遍，告诉你所有 mod 是否都能加载。点通知可以看完整报告。也可以手动跑：

```sh
herdr-update-check           # 这次更新对这套配置安全吗？不安全时会说要看哪里
herdr-update-check --after   # 点 Restart 之后：mod 都能加载吗，各台机器没问题吧
herdr-update-check --show before   # 上一次的报告（after 同理）
```

它在这些 mod 依赖 Herdr 的地方，对比正在用的版本和等着装的版本的源码（mod 接口，用到的命令、标签和名字，算窗格位置的代码，布局格式，复制来的 mod），并检查 herdr-core：是否换了新一代 core，以及哪些机器的 core 带着还没发布的修复（`update-check.py` 里的 `FIXES`）：在这些机器上点设置 → Machines 里的 Update，会换成不带修复的发布版。`--from 0.1.16 --to 0.1.17` 可以对比任意两个版本。`install.sh` 会把它链接到 `~/.local/bin`。

## 里面有什么

| 位置 | 内容 |
|---|---|
| `herdr-app/keys.json` | 上面那些快捷键 |
| `herdr-app/layouts/my-main.json` | 布局 my-main：灰蓝色焦点框；左栏最上面一条用 my-chrome，往下是 my-projects、my-agents；窗格标题栏用 my-pane，右键菜单用 my-menu |
| `herdr-app/mods/my-projects/` | Projects 面板，逻辑在 `model.js`。`optwatch.c` 是个小程序，`install.sh` 把它编译到 `~/.local/bin/herdr-optwatch`：它告诉左栏 ⌥ 有没有按住，也告诉 tab 栏拖到栏下面的拖动什么时候松手，因为 mod 只有拿到键盘焦点才知道修饰键（焦点通常在终端里），鼠标也只有在 mod 上方时才听得到。它只在 Herdr 是前台 app 时运行。`title.js` 用焦点所在的对话和它的 project 给 Herdr 窗口起标题，给 ActivityWatch 用（见「能做什么」） |
| `herdr-app/mods/my-tabs/` | tab 栏，还有 Overview 按钮、关闭后可恢复（`reopen.js`，退出的 agent 也能接回来）、关闭会断开还在跑的子终端时先问一句（`ask.js`；`workers.js` 判断哪些是 worker，关闭时把它们送回而不是结束，并在要求时结束 manager 的所有 worker）、⌘G（`waiting.js`；`glow.js` 算出跳到的窗格在哪，给 my-glow 画光晕：Herdr 的边框画在窗格里面，也不告诉 mod 窗格在哪，所以它照 Herdr 的排法，用布局和这个 tab 的分屏算出来）和 ⌃Tab 的顺序（`recent.js`）。`rename.js` 让改只有一个 Claude 或一个 agy 的 tab 名时，会话名跟着改。`jobs.js` 从 `~/.claude/jobs` 里 Claude Code 的记录得出后台会话（`claude attach`）的状态，是监听文件变化，不是轮询：tab 栏把状态写到会话所在终端的 `note.job` 标签上，其他面板读这个标签；响铃规则和 Herdr 一样。服务器上的会话来自 hook 在那边写的 `note.bg` 标签，从 Herdr 自己的终端列表里读（Herdr 不在前台时不重画，所以那时每 2 秒看一次）。把 worker 留成 tab 和送回，走它的 `keep`、`sendback`、`peek` 三个命令，Agents 列表、菜单和 peek 都用它们（`peek.js` 负责打开 peek）。`layoutdoc.js` 合并两个 tab 时，一次改写那台机器的布局，所以出来就是分好屏的样子；Herdr 的命令只能在当前焦点窗格旁边分屏，那样得先单独显示目标 tab。这个布局格式不是公开接口，哪天变了，合并会退回用那些命令。`projects.js` 是 my-projects 的 `model.js` 的拷贝，因为 mod 不能引用别的 mod 的文件。`updatecheck.js` 在 Herdr 有更新准备好时、以及重启之后，自动跑 `herdr-update-check` 并弹通知说结果（见「Herdr 提示更新时」） |
| `herdr-app/mods/my-glow/` | ⌘G 在窗格外的光晕，分成几条贴着窗格四边（浮层窗口，不抢键盘）。等 Herdr 窗口到前台后，光晕用 0.15 秒从边框往外晕开，停 0.3 秒，再用 0.3 秒先快后慢地淡出，然后这几条自己关掉 |
| `herdr-app/mods/agent-switcher/` | ⌃Tab 弹窗：每个窗格一张卡片，agent 显示最近的 prompt 和回复，shell 显示所在目录 |
| `herdr-app/mods/my-pane/` | 窗格标题栏（Herdr 自带的拷贝）：分屏、全屏、关闭这几个按钮换成两个，鼠标移到标题栏上才出现：Fork，在跑 Claude 的窗格上（fork.js 在那台机器上从 Claude Code 自己的记录里找到它的会话；跑在计算节点上的 Claude 则看 hook 写的标签，副本经 ssh 开在那个节点上）；Move to new tab，在分屏里的窗格上。agent 的窗格显示它会话的名字（agent 设的标题，和 Agents 列表里一样）；别的机器上的终端，在目录前面标出那台机器 |
| `herdr-app/mods/my-menu/` | 右键菜单（Herdr 自带的拷贝）：分屏里的窗格多一项 Move to new tab；顶部栏里分屏的 tab，每个名字有一项 Move X to new tab。Agents 列表里 worker 那一行的菜单：Keep as tab 和 Peek，或者 Go to tab 和 Send back |
| `herdr-app/mods/my-peek/` | peek 一个 worker 时上面那条栏（Herdr 自带 peek 的拷贝）。它的 keep 和 Agents 列表的一样：变成 worker 自己那台机器上的 tab。Herdr 自带的会把它放进当前显示的 space，worker 在别的机器上时会失败 |
| `herdr-app/mods/my-toast/` | 右下角的通知（Herdr 自带的拷贝）：agent 做完或需要你时，提示里用 Agents 列表里的名字（你给 tab 起的名字，否则是会话的名字），而不是“Claude Code”。`projects.js` 同样是 my-projects 的 `model.js` 的拷贝 |
| `herdr-app/mods/my-chrome/` | 左栏最上面那一条（Herdr 自带的拷贝），去掉了 Herdr 的图标和名字：左边留给窗口的三个按钮，右边是搜索和收起左栏 |
| `herdr-app/mods/my-agents/` | Agents 列表，显示成 "agent · space"，后台会话也在里面。worker 那一行标出它在哪台机器上，鼠标移上去出现 keep 按钮。`projects.js` 和 my-tabs 里的是同一份拷贝 |
| `herdr-app/mods/agent-deck-*` | Overview 面板，来自 [zztalker/herdr-agent-deck](https://github.com/zztalker/herdr-agent-deck) |
| `herdr-app/settings.json`、`themes/warp-dracula.json` | 字体、主题、缩放、提示音。`option_as_alt: "on"` 让 Option 在任何输入法下都当 Alt 用：用中文输入法的中文模式时，Herdr 默认把 ⌥1 交给输入法，于是打出字来，而不是切换 project |
| `agent-plugin/` | agent 运行的东西，按 agent 分：`shared/` 是 Claude Code 和 Codex 都用的（agent-note hook、skills），`claude/` 放它的 mods，以及把 hook 和 mods 加进 `~/.claude/settings.json` 的脚本；`codex/` 放 codex 函数，以及添加并信任 hook 的脚本；`antigravity/` 放给 Antigravity CLI 加 hook 和 title 命令的脚本。下面几行是它的各部分 |
| `agent-plugin/shared/agent-note` | Claude Code hook：记下你最近一条 prompt 的开头和回复的结尾，给 ⌃Tab 卡片用；同时给后台会话打 `note.state` 标签（工作中/空闲），因为它们不向 Herdr 报告状态；Herdr 没在看它们的记录时用这个兜底。在服务器上它还写 `note.bg`：Claude 记下的这个回合怎么结束的，给 Mac 上的 tab 栏用。用 resume 接回的对话，卡片会马上从对话记录里补上。后台会话的记录写到每个显示它的终端上：`claude attach <id>`，或者标题是该会话名字的 `claude --resume` 窗口。（它带的 `$HC_TERMINAL_ID` 是后台服务的，所以不用。）它还给每个窗格标上对话在哪，给 Fork 用：`note.session`、`note.cwd`，Claude 跑在别的主机（比如计算节点）上时还有 `note.host`。两个回合之间的压缩也由它处理（见上）：PreCompact 时，等 Claude 报告压缩“工作中”后，它清掉窗格的状态（OSC 7501 `state=clear`）。`install.sh` 会把它加进 `~/.claude/settings.json`（`agent-plugin/claude/add-agent-note.py`）。Codex 也跑它（`agent-note codex`，由 `agent-plugin/codex/add-agent-note.py` 加进 `~/.codex/hooks.json`，并在 Codex 的 `config.toml` 里设为信任）：记下同样的内容，另加 `note.ask`，即 Codex 等你批准的那件事。只对自己跑会话的 Codex 有效（`codex --no-daemon`）：Codex 的共享后台进程用它自己的环境跑 hook，所以在那里会跳过。在 Herdr 的终端里，`codex` 命令会自动这样启动（见下一行）。Antigravity CLI 也跑它，而且是两处，都由 `agent-plugin/antigravity/add-agent-note.py` 加上：作为 hook（`agent-note antigravity`，在 `~/.gemini/config/hooks.json`）记同样的笔记；作为 title 命令（`agent-note agy-title`，在 `~/.gemini/antigravity-cli/settings.json`）打印对话名，当作终端标题。agy 接回（resume）一个对话时不触发任何 hook，所以 title 命令遇到这个终端里没见过的对话，也顺手记一下。你自己设的 title 命令会保留。 |
| `agent-plugin/codex/codex.sh`、`agent-plugin/codex/codex-hooks-trust` | hook 在 Codex 这边的配套。`codex.sh` 是一个 `codex` shell 函数，从 `~/.bashrc` 和 `~/.zshrc` 加载（那一行由 `install.sh` 加上）：在 Herdr 的终端里启动的 Codex 会带上 `--no-daemon`（`resume`、`fork` 加在子命令后面），hook 才知道它在哪个终端。其他子命令，以及自己直接启动 codex 程序的程序，都不受影响。`codex-hooks-trust` 问装好的 Codex（`codex app-server` 的 `hooks/list`）是否信任 agent-note 的 hook，不信任就把 Codex 自己算的哈希写进 `config.toml`，这样 relay 或 manager 自动启动的 Codex 不会停在 "Hooks need review"。`install.sh` 会跑它（Vista 上在你的计算节点上跑），`codex` 函数在 codex 程序变了之后也会跑一次。 |
| `agent-plugin/shared/skills/hc-workers/` | worker 用的 skill，Claude Code 和 Codex 都能用。`SKILL.md` 是 manager 的部分：怎么用 `hc run` 开 worker（打上 manager 地址的标签，好列出自己的 worker）、会收到什么（汇报和 hc 的通知）、怎么指挥。`worker.md` 是 manager 贴进每个 worker 任务里的规则。`vista.md` 讲 Slurm 集群：agent 只在计算节点上跑，汇报经 login 节点发出。`install.sh` 照 `npx skills` 的方式装：文件放在 `~/.agents/skills/hc-workers/`（Codex 从这里读 skill），再在 `~/.claude/skills/` 里放一个指向它的链接给 Claude Code（用 `npx skills add` 加这个仓库也能找到它） |
| `agent-plugin/shared/skills/hc-find/` | 按名字找会话的 skill，Claude Code 和 Codex 都能用。`find.py` 一次调用拿到 hc 看得到的所有终端，按名字匹配（有人起过名的 tab、会话标题、hc 名、地址，或会话 id 的开头），再到会话所在的机器上运行自己，从 Claude Code 或 Codex 自己的记录里找到对话记录。`install.sh` 像装 hc-workers 一样装它 |
| `agent-plugin/claude/mods/short-names/` | Claude 命令的短名和新会话的名字，一个 Claude Code mod。`hooks/register.ts` 里是短名表，也给新会话起名：会话还没名字时，它的前几条消息会触发一个 `classic.UserPromptSubmit` hook，经 `$.model.complete` 问 Haiku，把名字作为这个 hook 的 `sessionTitle` 返回，Claude Code 像 `/rename` 那样用上它。短名表的用法：每个短名注册成一个命令，用 `$.command.run` 跑完整的那个；在输入框里，短名后面一出现空格就换成完整命令。`agent-plugin/claude/add-mods.py` 把这个 mod 的目录加进 `~/.claude/settings.json` 里的 `CLAUDE_CODE_PLUGIN_DIRS`，每个新会话都会读它。Claude Code 的 mod 接口标着 early access，Claude Code 更新后这个 mod 可能要跟着改 |
| `agent-plugin/claude/mods/accounts/` | `/auth` 和 artifact 链接上的账号标签，一个 Claude Code mod。`/auth` 用一个 `http.fetch` hook 把选定账号的 token 放到会话的模型请求上。`token`（Python，在 cswap 自己的 Python 里跑）从 cswap 为这个账号存的登录里读出 token，快过期时通过 cswap 的刷新流程刷新，所以这份登录始终只有 cswap 一个保管者；整台机器本身就在这个账号上时，请求照用它自己的登录。Artifact 工具上的 `tool.call` hook 从会话的 `.claude.json` 读出它登录的账号，在 `~/.config/claude-accounts/accounts.json` 里查到别名，把带 `#acct=<别名>` 的链接交给模型，调用下面也显示一行这个链接。`signin`（Python）把这台机器登录到 cswap 里还没有可用登录的每个账号。`tests/` 在一台假机器上测这些（`claude plugin test agent-plugin/claude/mods/accounts`、`python3 agent-plugin/claude/mods/accounts/tests/signin_test.py`、`python3 agent-plugin/claude/mods/accounts/tests/token_test.py`） |
| `raycast/` | 任何 app 里按 ⌘G 的 Raycast 脚本；`postkey.c` 让 VS Code 里的 ⌘G 照常是"查找下一个" |
| `install.sh`、`save.sh`、`paths.sh` | 安装、存回仓库，以及同步哪些文件的清单 |
| `update-check.py` | `herdr-update-check`：Herdr 更新前后的检查（见上） |
| `docs/` | 可点击模型（GitHub Pages 发布）和截图。`index.html` 是设计画布的文件换成示例名字后的版本；`support.js` 用 [Preact](https://preactjs.com) 让它跑起来 |

不同步的：Herdr 自己写的状态（`shared.json`、`view.json`、`data/` 等）和 hc 的机器配置（新电脑上用 `hc machine add` 加）。

## 致谢

project 图标来自 [Lucide](https://lucide.dev)（ISC 许可，见 `herdr-app/mods/my-projects/icons/LICENSE-lucide.txt`）。Overview 面板是 zztalker 的 [herdr-agent-deck](https://github.com/zztalker/herdr-agent-deck)。模型页用了 [Preact](https://preactjs.com)（MIT，见 `docs/LICENSE-preact.txt`）。
