# 01_20260815 EDA Extension Doctor M1 执行计划

日期：2026-08-15

仓库：`GPTKEY/lceda-extension-doctor`

开发分支：`agent/extension-doctor-m1`

## 系统计划 #1：目标

建立一个独立于业务扩展的维护扩展，在普通卸载失效时提供：

1. 当前扩展 IndexedDB 自动发现；
2. 已安装扩展只读扫描；
3. 指定扩展一致性检查；
4. 删除计划预览；
5. 指定 UUID 精确卸载；
6. 删除后残留验证；
7. Doctor 自保护；
8. `standaloneScript` 隔离。

## 系统计划 #2：已确认真机证据

当前 EasyEDA Pro V3 真机中，用户扩展数据库名称形如：

```text
User_<user-id>_v6
```

已确认包含：

```text
extensionsIndex
extensionsObjectStorage
extensionsUserConfig
standaloneScript
```

目标扩展安装数据表现为：

```text
extensionsIndex[uuid]
extensionsObjectStorage[uuid]
extensionsObjectStorage[uuid|path]
extensionsUserConfig[uuid]
```

本工具只使用上述已观测结构，不推断其他未确认 Store。

## 系统计划 #3：M1 安全原则

- 数据库名不得写死；
- 只找到 Store schema 仍不足以允许删除；
- 必须再通过 Doctor 自身 UUID 唯一确认活动数据库；
- self record 不存在、出现多个活动候选或 schema 不完整时拒绝 destructive 操作；
- 所有 destructive 操作必须来自用户显式菜单；
- 删除前再次读取目标 index 做 identity recheck；
- 删除事务仅包含 `extensionsIndex / extensionsObjectStorage / extensionsUserConfig`；
- 禁止触碰 `standaloneScript`；
- 删除后重新打开 DB 并验证残留；
- 删除成功后要求重启 EDA。

## 系统计划 #4：M1 UI

采用 EasyEDA 原生 `SYS_Dialog`，避免第一版引入自定义 React UI：

```text
Extension Doctor
├─ 扫描已安装扩展...
├─ 检查扩展...
├─ 精确卸载扩展...
├─ 存储诊断...
└─ 关于...
```

删除工作流：

```text
扫描扩展
  -> 排除 Doctor 自身
  -> 选择目标
  -> 只读生成 RemovalPlan
  -> showConfirmationMessage
  -> identity recheck
  -> 单个 readwrite transaction
  -> 删除后 reopen + verify
  -> 提示完全重启
```

## 系统计划 #5：构建与包内容

使用 EasyEDA Pro SDK 相同的 esbuild IIFE 结构，`npm run build` 生成 `.eext`。

`.edaignore` 必须排除：

```text
.github
build
config
docs
node_modules
src
tests
package.json
package-lock.json
tsconfig.json
```

避免重现 EDA Sync Tool 旧包将整个开发仓库写入 `extensionsObjectStorage` 的问题。

## 系统计划 #6：验收 Gate

代码 Gate：

- Node contract tests PASS；
- TypeScript typecheck PASS；
- EEXT build PASS；
- 包内容不包含开发目录。

真机 Gate：

- Doctor 能识别当前用户扩展 DB；
- 列表能读取真实扩展索引；
- Inspect 能读取目标 manifest；
- 精确删除一个可恢复测试扩展；
- 重启后目标扩展消失；
- 其他扩展保持；
- 独立脚本保持。

## 系统计划 #7：M1 不做

- 不实现 Doctor 自删除；
- 不实现批量删除；
- 不实现孤儿记录自动清理；
- 不实现 schema 自动迁移；
- 不使用官方“删除全部扩展”的危险模式；
- 不声称内部 IndexedDB schema 是官方稳定接口；
- 不 merge / tag / release，除非后续明确授权。
