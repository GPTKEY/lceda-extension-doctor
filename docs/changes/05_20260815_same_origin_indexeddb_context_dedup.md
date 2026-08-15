# 05_20260815 同源 IndexedDB 上下文去重修复

## 1. 现场现象

真实 EasyEDA iframe 中 `doctor.js` 已成功加载执行，但存储探测报告：

- iframe：可见数据库 1 个；
- parent：可见数据库 1 个；
- top：与 parent 的 `IDBFactory` 对象相同；
- 最终匹配数量为 2，工具 fail-closed，不允许写操作。

这说明资源加载问题已经解决，剩余问题是上下文别名去重。

## 2. 根因

旧实现仅按 `IDBFactory` JavaScript 对象身份去重。浏览器中同一 origin 的不同 Window 可以暴露不同的 `IDBFactory` JS 包装对象，但它们仍共享同一个 origin-scoped IndexedDB 命名空间，因此 iframe 与 parent 会被错误计为两个独立匹配。

## 3. 修复

0.2.3：

1. 探测顺序调整为 parent -> top -> iframe；
2. 每个可访问 Window 优先读取 `location.origin`；
3. 非 opaque origin 按 origin 去重；
4. origin 无法读取或为 `null` 时，才回退到 `IDBFactory` 对象身份去重；
5. 诊断信息显示 origin 与重复原因；
6. 数据库仍必须满足 required stores + Doctor 自身 UUID；
7. 最终仍要求唯一有效数据库，否则继续 fail-closed。

## 4. 安全边界

本修复不降低删除门槛，不按数据库名称猜测，不允许多个不同 origin 自动合并，不修改 `standaloneScript`，Doctor 自身仍禁止删除，删除后仍需验证 index/config/object records 全部清零。
