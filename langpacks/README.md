# OpenMail 语言包 / Language Packs

OpenMail 内置 **中文（简体）** 和 **English** 两种界面语言；本目录提供另外 **8 种语言包**（额外内容），安装后即可在 Webmail「设置 → 语言」中切换：

| 代码 | 语言 | 方向 |
| --- | --- | --- |
| `fr` | Français 法语 | LTR |
| `es` | Español 西班牙语 | LTR |
| `pt` | Português 葡萄牙语 | LTR |
| `ru` | Русский 俄语 | LTR |
| `ar` | العربية 阿拉伯语 | **RTL**（界面自动镜像） |
| `hi` | हिन्दी 印地语 | LTR |
| `bn` | বাংলা 孟加拉语 | LTR |
| `ur` | اردو 乌尔都语 | **RTL**（界面自动镜像） |

---

## 安装方式 / How to install

### 方式一：命令行脚本（推荐）

```bash
# 在 OpenMail 项目根目录执行
# 安装全部语言包:
node scripts/install-langpacks.mjs --all

# 安装指定语言（可多选）:
node scripts/install-langpacks.mjs fr ar ur

# 查看状态:
node scripts/install-langpacks.mjs --status
```

脚本把选中的 `*.json` 复制到 `public/locales/`，刷新浏览器即可生效，无需重启。

### 方式二：管理后台网页一键安装

以管理员登录 → **设置 → 语言**（或 **管理后台 → 系统设置** 区域）→ 在「可安装语言包」中点击 **安装**。
前提：部署时保留了仓库中的 `langpacks/` 目录（Docker 镜像与 install.sh 安装均已包含）。

### 方式三：手动复制

```bash
cp langpacks/fr.json public/locales/
# 需要哪几种就复制哪几个；文件名必须形如 <代码>.json
```

---

## 语言包结构 / Pack structure

```jsonc
{
  "__name": "Français",   // 语言显示名（原生写法）
  "__dir": "ltr",         // 排版方向: ltr | rtl
  "nav.mail": "Messagerie",
  "...": "约 230 条界面词条，key 与 public/locales/en.json 完全一致"
}
```

- 缺失的词条自动回退到英文（per-key fallback）。
- `__dir: "rtl"` 的语言（ar / ur）会把整站切换为从右向左布局。

### 制作/修改自己的语言包

1. 复制 `public/locales/en.json` 重命名为 `<代码>.json`（BCP-47 小写代码）；
2. 翻译所有值，保持 key 不变，填好 `__name` / `__dir`；
3. 放入 `langpacks/` 并在 `langpacks/manifest.json` 的 `packs` 数组登记；
4. 用上面任一方式安装。

欢迎提交 PR 补充更多语言！
