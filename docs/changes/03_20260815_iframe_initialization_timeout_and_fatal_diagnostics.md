# 03_20260815 iframe 初始化超时与致命错误可观测性修复

## 1. 现场现象

真实嘉立创 EDA / EasyEDA Pro 中安装 `v0.2.0` 后，Doctor iframe 能打开，但状态区长期停留在“正在初始化……”。

已确认安装包实际包含：

- `dist/index.js`
- `iframe/index.html`
- `iframe/doctor.js`

且包内资源与源码一致，`doctor.js` 语法检查通过，既有 8 项静态安全契约全部通过。

## 2. 根因范围

`v0.2.0` 的运行时初始化存在三个不可接受的无限等待点：

1. 顶层 `discover()` 调用没有统一 `catch`；
2. `indexedDB.databases()` 没有超时；
3. `indexedDB.open()` 没有超时，也没有处理 `blocked`。

因此“脚本未执行 / 未捕获异常 / Promise 永不结束”都会表现成同一个永久“正在初始化……”，无法继续定位。

## 3. v0.2.1 修复

### 3.1 启动状态可判别

静态 HTML 默认状态改为：

`等待 doctor.js 加载……如果此文字长期不变，说明 doctor.js 没有实际执行。`

`doctor.js` 一开始即写入：

`doctor.js 已加载。正在安装运行时异常保护……`

因此可以明确区分资源没有执行与后续存储探测失败。

### 3.2 全局异常收口

增加：

- `window.error`
- `window.unhandledrejection`
- `initialize().catch(...)`

所有未捕获错误必须写回状态区，同时说明当前会话不会继续执行写操作。

### 3.3 IndexedDB 有界等待

固定超时上界：

- `indexedDB.databases()`：4000 ms
- `indexedDB.open()`：4000 ms
- 普通 IDBRequest：4000 ms
- IDBTransaction：5000 ms

任何超时均视为无法安全访问并 fail-closed。

### 3.4 blocked 处理

`indexedDB.open()` 新增 `request.onblocked`，出现 blocked 时立即以明确错误结束该候选数据库探测，不再永久等待。

### 3.5 阶段化状态

状态区会显示当前阶段，例如：

- `initialize`
- `discover:start`
- `discover:iframe:databases`
- `discover:parent:databases`
- `discover:<context>:open`
- `list:extensions`

下一次真实 EDA Gate 即使失败，也能直接判断停在哪个上下文和哪个 IndexedDB 操作。

## 4. 安全边界保持不变

- 扩展主线程仍不直接访问 IndexedDB；
- destructive 操作仍要求唯一找到包含 Doctor 自身 UUID 的扩展数据库；
- Doctor 自身仍禁止删除；
- 写事务仍仅包含 `extensionsIndex / extensionsObjectStorage / extensionsUserConfig`；
- `standaloneScript` 不进入写事务；
- 删除后仍必须验证 index/config/object records 全部清零。

## 5. 版本

版本从 `0.2.0` 升级为 `0.2.1`。

## 6. 真机 Gate

安装 `v0.2.1` 后先只观察状态区，不执行删除：

1. 若长期保持“等待 doctor.js 加载……”，判定 `doctor.js` 未执行；
2. 若显示“doctor.js 已加载”后报错，记录具体阶段和错误；
3. 若显示某个 `databases()` / `open()` 超时，可直接确定 iframe 环境的阻塞点；
4. 只有显示“存储已绑定”并列出真实扩展后，才进入精确卸载 Gate。
