# 06_20260815 孤儿扩展残留扫描与清理

## 1. 现场证据

EDA Extension Doctor 0.2.3 已在真实嘉立创 EDA 环境成功绑定：

- 上下文：`parent`
- Origin：`https://pro.lceda.cn`
- 数据库：`User_9382d507a8f34e3fb7942a42d9fa7b8d_v6`
- version：6
- Store：`extensionsIndex`、`extensionsObjectStorage`、`extensionsUserConfig`、`standaloneScript`
- 当前 `extensionsIndex` 可见扩展：8 个

此前待清理的 EDA Sync Tool UUID `30e5c9f977a24ad483d93ea1805c37f9` 已不在当前 `extensionsIndex` 列表中。

这只能证明索引记录不存在，不能证明 `extensionsObjectStorage` / `extensionsUserConfig` 已无残留。

## 2. 新增能力

版本升级为 `0.3.0`，新增“扫描孤儿残留”。

孤儿定义：

1. UUID 不存在于 `extensionsIndex`；
2. 但 `extensionsObjectStorage` 中仍存在 `UUID` / `UUID|...` 记录，或 `extensionsUserConfig` 中仍存在 UUID 记录。

扫描只读，不修改任何 Store。

## 3. 残留身份恢复

如果孤儿对象仍保留 `UUID|extension.json`，Doctor 会尝试读取 Manifest，展示：

- `displayName`
- `name`
- `version`
- UUID
- 对象记录数量
- 用户配置记录数量

Manifest 无法读取时仍保留 UUID 级诊断，不猜测扩展身份。

## 4. 清理安全边界

孤儿残留清理必须满足：

- UUID 合法；
- 不是 Doctor 自身 UUID；
- 清理前 `extensionsIndex` 中仍不存在该 UUID；
- 至少还有 object/config 残留；
- 用户输入完整确认文本：`CLEAN ORPHAN <uuid>`；
- 写事务只包含 `extensionsObjectStorage` 与 `extensionsUserConfig`；
- `standaloneScript` 永不进入事务；
- 清理前再次读取 `extensionsIndex`，若目标重新出现则 `ORPHAN_BECAME_INSTALLED` 并中止；
- 清理后再次验证 index=false、objects=0、config=0，否则报 `ORPHAN_CLEAN_VERIFY_FAILED`。

## 5. 正常扩展删除

正常安装扩展仍使用原来的精确卸载路径：

- 必须存在 `extensionsIndex`；
- 删除 index/object/config；
- Doctor 自身不可卸载；
- 删除后统一通过 residual state 验证三类扩展记录均归零。

## 6. 本轮真实 Gate

安装 0.3.0 后，第一步只点击“扫描孤儿残留”。

重点确认是否出现：

`30e5c9f977a24ad483d93ea1805c37f9`

如果出现，应先记录 Manifest 名称、版本、对象数和配置数，再决定是否执行“清理残留”。

如果不出现，则说明该 UUID 在 object/config 两个扩展 Store 中也已经没有可识别残留，此时不需要对当前 8 个正常扩展做任何删除操作。
