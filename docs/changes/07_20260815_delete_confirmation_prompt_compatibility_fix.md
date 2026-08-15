# 07. 删除确认 prompt 兼容性修复

## 07.1 真实问题

在 EasyEDA / JLCEDA Pro 真机中，Doctor 已能稳定绑定扩展 IndexedDB，并能正确列出已安装扩展；但点击“精确卸载”后出现：

```text
Error: DELETE_CONFIRMATION_MISMATCH
```

该错误发生在任何 IndexedDB 写事务之前。`v0.3.0` 的删除与孤儿清理仍依赖 `window.prompt()` 让用户输入：

```text
DELETE <uuid>
```

或：

```text
CLEAN ORPHAN <uuid>
```

真实 EasyEDA iframe 中原生 prompt 输入行为不可靠，因此即使数据库与目标身份已经正确识别，也可能在确认阶段得到空值、取消值或异常值，导致无法继续删除。

## 07.2 修复原则

不降低原有删除安全边界，只替换不可靠的 UI 输入通道：

1. 新增 `/iframe/confirm-bridge.js`；
2. 必须先于 `/iframe/doctor.js` 加载；
3. 只接管消息末尾包含合法 `DELETE <32hex>` 或 `CLEAN ORPHAN <32hex>` 的 Doctor 确认；
4. 其他普通 `prompt()` 调用仍回退浏览器原实现；
5. Doctor 确认改用 `window.confirm()`，明确显示目标名称、UUID、对象记录与配置记录；
6. 用户取消时抛出 `DELETE_CONFIRMATION_CANCELLED`，不进入任何写事务；
7. 用户确认后，兼容层返回 Doctor 原逻辑要求的精确 token；
8. `doctor.js` 后续仍执行现有的 UUID、name、index 状态及残留范围复核；
9. 删除后的 index/config/object 零残留验证保持不变；
10. `standaloneScript` 仍不进入任何写事务。

因此本修复不是跳过确认校验，而是将“手工 prompt 输入”替换为 EasyEDA iframe 中更可用的明确确认交互，同时保留原有精确 token 和写入前身份验证。

## 07.3 版本

版本升级为：

```text
0.3.1
```

构建产物：

```text
build/dist/eda-extension-doctor_v0.3.1.eext
```

## 07.4 验证要求

CI 必须检查：

- `iframe/confirm-bridge.js` 被打入 EEXT；
- confirm bridge 在 `doctor.js` 之前加载；
- bridge 只识别合法 DELETE / CLEAN ORPHAN token；
- 使用 `window.confirm()`；
- 确认后返回精确 token；
- 取消时 fail-closed；
- `doctor.js` 原有身份复核与删除后验证仍保留。
