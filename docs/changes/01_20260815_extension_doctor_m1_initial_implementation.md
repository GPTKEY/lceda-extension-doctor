# 01_20260815 EDA Extension Doctor M1 初始实现记录

日期：2026-08-15

分支：`agent/extension-doctor-m1`

版本：`0.1.0`

UUID：`4350c76638924d56a704e7c1906ba0c1`

## 系统记录 #1：工程建立

建立独立 EasyEDA Pro EEXT 工程，避免维护工具与待维修业务扩展耦合。

构建命令：

```text
npm install
npm run verify
```

安装包目标：

```text
build/dist/eda-extension-doctor_v0.1.0.eext
```

## 系统记录 #2：存储引擎

`src/storage.ts` 已实现：

- 自动枚举 IndexedDB；
- Store schema 筛选；
- Doctor 自身 UUID 唯一绑定活动数据库；
- 扩展列表读取；
- index / manifest / user config / object count 检查；
- RemovalPlan；
- self-removal 双层禁止；
- 三 Store 单事务精确删除；
- 删除后 reopen + verify。

写事务固定仅允许：

```text
extensionsIndex
extensionsObjectStorage
extensionsUserConfig
```

`standaloneScript` 不参与写事务。

## 系统记录 #3：交互入口

`src/index.ts` 导出：

```text
listInstalledExtensions
inspectExtension
removeExtension
showStorageDiagnostics
about
```

使用 EasyEDA `SYS_Dialog` 的信息、选择和确认窗口完成第一版 UI。

精确卸载固定经过：

```text
选择目标
-> 只读 RemovalPlan
-> 二次确认
-> 删除前 identity recheck
-> transaction delete
-> post-delete verify
-> 提示完全重启
```

## 系统记录 #4：EEXT 包收敛

`.edaignore` 已主动排除开发内容，避免业务扩展旧包中出现的 `.github/docs/tests/scripts` 等开发仓库文件进入 `extensionsObjectStorage`。

CI 会检查最终 EEXT 至少存在：

```text
extension.json
dist/index.js
```

并拒绝开发目录进入安装包。

## 系统记录 #5：自动契约

`tests/storage-safety-contract.test.mjs` 固定：

1. Doctor 自删除双层禁止；
2. 活动数据库必须由 self UUID 唯一绑定；
3. write transaction 不得包含 `standaloneScript`；
4. UI 卸载列表排除自身且确认后才删除；
5. EEXT 排除开发仓库内容；
6. Manifest `registerFn` 必须存在对应导出函数。

## 系统记录 #6：待真机 Gate

M1 代码完成不代表内部 IndexedDB schema 已成为正式兼容接口。

下一 Gate 必须在 EasyEDA Pro 真机验证：

- Doctor 可以在扩展上下文访问与 DevTools 相同的 IndexedDB；
- self UUID 能唯一锁定当前用户 DB；
- 扫描列表正确；
- 检查目标扩展正确；
- 对可恢复测试扩展执行一次精确卸载；
- 完整重启后仅目标扩展消失。

本阶段不 merge、不 tag、不 release。
