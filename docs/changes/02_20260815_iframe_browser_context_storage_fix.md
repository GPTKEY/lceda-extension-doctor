# 02_20260815 iframe 浏览器上下文存储修复

日期：2026-08-15

## 系统记录 #1：真实 EDA 故障

M1 `0.1.0` 安装后，菜单调用均失败：

```text
Cannot read properties of undefined (reading 'databases')
```

真实结果证明：扩展主线程无法直接使用普通编辑器页面中的 `indexedDB`。

## 系统记录 #2：根因

嘉立创 EDA 官方开发文档明确说明：所有扩展运行在独立作用域链下，扩展主线程对 DOM、外部请求、本地文件系统等浏览器 API 的调用受到限制，应优先使用扩展 API 预定义接口。

`SYS_Storage` 的公开能力只覆盖当前扩展自身用户配置，没有枚举或卸载其他扩展的公开接口，因此不能用 `SYS_Storage` 替代目标能力。

M1 直接从 `src/storage.ts` 使用全局 `indexedDB` 的架构前提被真实 Gate 否定。

## 系统记录 #3：0.2.0 架构修复

调整为双层结构：

```text
Extension main runtime
  -> only official SYS_IFrame.openIFrame()
  -> /iframe/index.html
      -> browser context probe
      -> iframe / parent / top IndexedDB candidates
      -> schema + Doctor UUID identity gate
      -> scan / inspect / precise removal
```

主线程不再直接访问 `indexedDB`。

iframe 会探测：

- `window.indexedDB`
- `window.parent.indexedDB`（同源可访问时）
- `window.top.indexedDB`（同源可访问时）

候选 factory 去重后，只有数据库同时满足：

```text
extensionsIndex
extensionsObjectStorage
extensionsUserConfig
```

并且 `extensionsIndex` 中存在 Doctor 自身 UUID：

```text
4350c76638924d56a704e7c1906ba0c1
```

且最终唯一匹配数量严格等于 1，才允许进入维护操作。

## 系统记录 #4：删除安全边界

继续固定：

- Doctor 自身不可删除；
- `standaloneScript` 不进入写事务；
- 删除前生成 inspect / plan 信息；
- 必须手工输入 `DELETE <uuid>`；
- 删除前再次验证目标 identity；
- 只写 `extensionsIndex / extensionsObjectStorage / extensionsUserConfig`；
- 删除后重新读取并要求 index/config/object records 全部为 0；
- 任意 browser context / schema / identity 异常 fail-closed。

## 系统记录 #5：版本

扩展版本升级：

```text
0.1.0 -> 0.2.0
```

新运行时文件：

```text
iframe/index.html
iframe/doctor.js
```

CI 必须验证这两个文件真实进入 EEXT，同时继续禁止 `.github/docs/tests/src/config/build` 等开发内容进入安装包。

## 系统记录 #6：下一步真机 Gate

0.2.0 首次打开后优先观察顶部状态框：

1. 是否可以打开官方 iframe；
2. `iframe / parent / top` 哪个上下文能够看到 IndexedDB；
3. 是否找到包含 Doctor 自身 UUID 的唯一扩展数据库；
4. 能否只读列出真实扩展；
5. 只读 Gate 通过后再对可恢复测试扩展进行一次精确卸载。

在第 1～4 项完成前，不执行 destructive 真机测试。
