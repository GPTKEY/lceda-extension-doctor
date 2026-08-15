# EDA Extension Doctor

嘉立创 EDA / EasyEDA Pro 扩展诊断、残留检查与精确卸载维护工具。

当前开发分支：`agent/extension-doctor-m1`

当前扩展版本：`0.1.0`

扩展 UUID：`4350c76638924d56a704e7c1906ba0c1`

## 1. 为什么需要它

当某个扩展自身异常、普通扩展管理器无法卸载，或者安全模式/客户端重启后出现扩展版本与持久化记录不一致时，Extension Doctor 用于只读检查真实扩展存储，并在用户明确确认后精确删除指定扩展。

当前实现基于已在 EasyEDA Pro V3 真机确认的三个扩展 Store：

- `extensionsIndex`
- `extensionsObjectStorage`
- `extensionsUserConfig`

`standaloneScript` 属于独立脚本存储，本工具不会修改。

## 2. 安全边界

M1 固定以下规则：

1. 不写死 `User_xxx_v6` 数据库名；
2. 自动枚举 IndexedDB，并要求同时存在三个扩展 Store；
3. destructive 操作前必须通过 Doctor 自身 UUID 唯一锁定当前活动扩展数据库；
4. 扫描、检查、存储诊断默认只读；
5. 删除前先生成删除计划，再显示二次确认；
6. 禁止删除 Doctor 自身；
7. 删除事务只允许访问三个扩展 Store，不触碰 `standaloneScript`；
8. 删除后重新打开数据库验证 index/config/object 残留全部为 0；
9. schema 或身份无法唯一确认时 fail-closed；
10. 删除成功后要求完全退出并重启 EDA，不尝试热重载目标扩展。

## 3. 当前菜单

安装后顶部出现 `Extension Doctor`：

- `扫描已安装扩展...`
- `检查扩展...`
- `精确卸载扩展...`
- `存储诊断...`
- `关于...`

其中选择与确认 UI 使用 EasyEDA 自带 `SYS_Dialog`。

## 4. 本地构建

要求 Node.js `>=20.17.0`。

```powershell
npm install
npm run verify
```

单独生成安装包：

```powershell
npm run build
```

输出：

```text
build/dist/eda-extension-doctor_v0.1.0.eext
```

`.edaignore` 会排除源码、测试、CI、文档和构建脚本，避免把整个开发仓库塞进 EEXT。

## 5. 真机验收顺序

M1 第一次真机验证建议只按以下顺序进行：

1. 安装 Doctor；
2. 运行“存储诊断”，确认绑定到当前 `User_xxx_v6`；
3. 运行“扫描已安装扩展”，确认列表和扩展管理器大体一致；
4. 对目标扩展运行“检查扩展”，确认 UUID / index version / manifest version / object count；
5. 使用一个可重新安装的测试扩展验证“精确卸载”；
6. 完全退出并重启 EDA；
7. 确认目标扩展消失、其他扩展仍存在、独立脚本不受影响。

在上述真机 Gate 通过前，不将内部 IndexedDB schema 当作官方稳定 API，也不进入自动清理或批量删除。
