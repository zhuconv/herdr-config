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
| `herdr-app/keys.json` | 快捷键：⌘W 分层关闭、⌘⇧W/⌘⇧T 恢复、⌘HJKL 切窗格、⌘G 跳到响铃的 agent、⌃Tab 按最近的焦点切换窗格、⌘1–⌘9 按顶部栏的顺序选 tab、⌥1–⌥9 按左栏从上到下选 project |
| `herdr-app/layouts/my-main.json` | 布局 my-main：灰蓝色焦点框，左栏上面是 my-projects、下面是 my-agents，窗格标题栏用 my-pane，终端里的右键菜单用 my-menu |
| `herdr-app/mods/my-projects/` | 左上角 Projects：project 由若干个"机器 · 目录"组成，对话按所在目录归类（子目录跟父目录走），没归类的在 Unsorted。点 project 那一行是折叠/展开；⌥1–⌥9 把顶部 tab 栏切到这个 project（回到上次用的 tab），点它里面的对话也会切过去。拖动目录胶囊可以在组内排序，或拖进别的 project（拖回 Unsorted 也行），也可以右键它移动、新建 project；点开胶囊，路径右边的 + 在该目录新开 Claude；你所在的对话的胶囊有一圈框，焦点换到别的胶囊里的对话（或者在当前窗格里启动了 Claude）时，那个胶囊自动打开，手动点开的保持到下一次焦点换胶囊；project 那一行右边的 +（右键菜单里也有）是 New directory…：选一台机器、填路径（`~/` 开头或不带 `/` 的从那台机器的 home 算起；边输入边在下面列出那台机器上这一层的文件夹，Tab 补全最上面那个（↑↓ 可以换）并加上 `/`，回车就用输入框里的路径），在那台机器上建好这个目录（已经有就直接用），加进这个 project，并在里面开 Claude；右键 project 还能改名、换图标或删除（目录回到 Unsorted）；拖动 project 排序。vista 的 login 节点上跑不了 Claude，所以在 vista 上，+ 和 New directory… 开的是一个 terminal。⌥1–⌥9 选从上往下第几个 project（Unsorted 有内容时算最后一行）；按住 ⌥ 时每个 project 的图标换成它的编号。`optwatch.c` 是告诉左栏 ⌥ 有没有按住的小程序（mod 只有拿到键盘焦点才知道修饰键，而焦点通常在终端里），`install.sh` 把它编译到 `~/.local/bin/herdr-optwatch` |
| `herdr-app/mods/my-tabs/` | 标签栏：只显示当前 project 的 tab（所有 space、所有机器），一个"机器 · 目录"一组：组前一个色点（点它折叠），组下面一条同色细线；一个目录只有一个 tab（分屏的也算一个）时不算组，没有色点和细线；只有 shell、没有 agent 的 tab 不进任何组，单独排在它那个目录后面。tab 上只列 agent（`claude attach` 这类后台会话也算），旁边分屏的 shell 等 terminal 不列，也不决定 tab 归哪个目录；没有 agent 的 tab 显示它的第一个窗格。每个 tab 最左边是它的编号，⌘1–⌘8 选对应编号的 tab，⌘9 选最后一个；分屏的 tab 只占一个号，折叠的组照样占号，跳进去会自动展开。把 tab 拖到另一个 tab 中间合并成分屏（按住 ⌥ 是上下分），拖到边缘排序，不同机器的不能合并；分屏 tab 里的一个名字拖到栏里的空白处，或者往下拖出顶部栏，就拆回单独的 tab；右键 tab 也可以拆。还有 Overview 按钮、关闭可恢复（reopen.js）、⌘G（waiting.js）、⌃Tab 的顺序（recent.js：按你最近把光标放在哪个窗格，agent、后台会话、待过的 shell 都算，所以同一个 tab 里的两个分屏也能用 ⌃Tab 来回切）。`projects.js` 是 my-projects/model.js 的拷贝（mod 不能引用别的 mod 的文件） |
| `herdr-app/mods/agent-switcher/` | ⌃Tab 弹窗：每个窗格一张卡片（agent 显示最近的 prompt 和回复，shell 显示所在目录） |
| `herdr-app/mods/my-pane/` | 窗格标题栏（Herdr 自带 pane 的拷贝）：右上角原来的左右分屏、上下分屏、全屏、关闭四个按钮，换成一个 "Move to new tab"，只在分屏里的窗格上出现，点它把这个窗格拆成单独的 tab。分屏、全屏、关闭还能用快捷键和右键菜单 |
| `herdr-app/mods/my-menu/` | 右键菜单（Herdr 自带 menu 的拷贝）：终端里右键，分屏里的窗格多一项 "Move to new tab"；顶部栏右键分屏的 tab，每个名字有一项 "Move X to new tab" |
| `herdr-app/mods/my-agents/` | 左栏 Agents 列表，显示成 "agent · space"。后台会话（`claude attach` 那种，Herdr 自己的列表里没有）也列出来，工作中/空闲来自 agent-note 打的 `note.state` 标签。`projects.js` 是 my-projects/model.js 的拷贝 |
| `herdr-app/mods/agent-deck-*` | Overview 面板，来自 [zztalker/herdr-agent-deck](https://github.com/zztalker/herdr-agent-deck) |
| `herdr-app/settings.json`, `themes/warp-dracula.json` | 字体、主题、缩放、提示音 |
| `claude/agent-note` | Claude Code hook：记下最近一条 prompt 和回复的首尾句，给 ⌃Tab 卡片用；同时打 `note.state` 标签（提问后 working，回答完 idle），后台会话靠它在 Agents 列表、顶部栏和左栏显示状态。后台会话不在终端里跑，它按会话 ID 找到 `claude attach` 那个终端；`install.sh` 会把它加进 `~/.claude/settings.json` |
| `raycast/` | 任何 app 里按 ⌘G 的 Raycast 脚本；`postkey.c` 让 VS Code 里的 ⌘G 照常查找下一个 |

不同步的：Herdr 自己写的状态（`shared.json`、`view.json`、`data/` 等）、hc 的机器配置（比如 vista，要在新电脑上 `hc machine add`）。
