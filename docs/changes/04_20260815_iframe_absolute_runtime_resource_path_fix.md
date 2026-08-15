# 04 — 2026-08-15 iframe 运行脚本绝对资源路径修复

## 1. 现场现象

真实嘉立创 EDA 中安装 `EDA Extension Doctor v0.2.1` 后，`/iframe/index.html` 能正常打开，但状态长期保持：

```text
等待 doctor.js 加载……
如果此文字长期不变，说明 doctor.js 没有实际执行。
```

这说明问题发生在 IndexedDB 探测之前：HTML 已加载，但 `doctor.js` 没有进入执行阶段。

## 2. 已排除项

- EEXT 内存在 `iframe/index.html`；
- EEXT 内存在 `iframe/doctor.js`；
- `doctor.js` 通过 `node --check`；
- v0.2.1 的初始化超时、blocked、fatal diagnostics 契约均通过。

因此继续调整 IndexedDB 超时没有意义，应该优先修复 iframe 关联资源加载路径。

## 3. 官方依据

嘉立创 EDA 官方 `SYS_IFrame` 文档说明：

- `openIFrame('/iframe/index.html')` 的 URI 从扩展包根目录开始；
- iframe 所需文件应保存在扩展包中；
- 扩展资源由安全资源访问规则读取。

官方扩展 `easyeda/eext-qrcode-generator` 的真实 iframe 页面也统一使用扩展包根路径，例如：

```html
<link rel="stylesheet" href="/iframe/css/style.css" />
<script src="/iframe/js/script.js"></script>
<script src="/iframe/js/qrcode.min.js"></script>
```

因此 Doctor 原来的：

```html
<script src="./doctor.js"></script>
```

与官方实际扩展的资源引用方式不一致。

## 4. v0.2.2 修复

### 4.1 资源路径

改为：

```html
<script src="/iframe/doctor.js"></script>
```

不再依赖 iframe 实际 URL 的普通目录相对路径解析。

### 4.2 HTML bootstrap 诊断

在外部脚本前新增极小内联 bootstrap，用于区分：

1. HTML 只显示但 JavaScript 完全未执行；
2. HTML 内联 JavaScript 已执行，外部 `doctor.js` 资源加载失败；
3. `doctor.js` 资源已加载，但执行发生错误；
4. `doctor.js` 正常进入初始化。

状态不再只有一个模糊的“等待加载”。

### 4.3 script load/error 诊断

`/iframe/doctor.js` 增加显式 `onload` / `onerror` 状态输出。

如果外部脚本请求失败，界面会直接提示：

```text
doctor.js 资源加载失败。
路径：/iframe/doctor.js
```

如果资源被加载但脚本没有进入 Doctor 自身初始化状态，则提示：

```text
doctor.js 资源已加载，但没有进入预期初始化阶段。
```

### 4.4 版本

版本从 `0.2.1` 升为 `0.2.2`，避免同版本安装造成资源缓存判断歧义。

## 5. 自动门禁

新增契约：

- iframe 必须使用 `src="/iframe/doctor.js"`；
- 禁止重新使用 `src="./doctor.js"`；
- HTML 必须具有 page/bootstrap/resource/execution 四阶段诊断；
- EEXT 解包后再次检查 `iframe/index.html` 中保存的仍是绝对包路径。

## 6. 真机 Gate

安装 v0.2.2 后只观察状态，不先执行删除：

### A. 长期保持

```text
HTML 页面已加载，等待启动脚本……
```

说明 iframe HTML 中的内联 JavaScript 本身没有执行。

### B. 显示

```text
HTML 启动脚本已执行。
正在加载 /iframe/doctor.js ……
```

随后出现“资源加载失败”，说明问题是扩展包关联资源加载。

### C. 显示

```text
doctor.js 资源已加载，但没有进入预期初始化阶段。
```

说明资源可读，但脚本执行阶段异常。

### D. 显示

```text
doctor.js 已加载。
```

说明资源路径问题已解决，后续才进入 IndexedDB 上下文探测。

在真机 Gate 成功前，PR 保持 Draft，不 merge / tag / release。
