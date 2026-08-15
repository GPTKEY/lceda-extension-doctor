import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const iframe = readFileSync(new URL('../iframe/doctor.js', import.meta.url), 'utf8');
const confirmBridge = readFileSync(new URL('../iframe/confirm-bridge.js', import.meta.url), 'utf8');
const iframeHtml = readFileSync(new URL('../iframe/index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../extension.json', import.meta.url), 'utf8'));
const edaIgnore = readFileSync(new URL('../.edaignore', import.meta.url), 'utf8');

test('扩展主线程不得再直接调用 IndexedDB', () => {
	assert.equal(/\bindexedDB\s*\./.test(entry), false);
	assert.equal(/\bwindow\s*\.\s*indexedDB\b/.test(entry), false);
	assert.ok(entry.includes('eda.sys_IFrame.openIFrame'));
	assert.ok(entry.includes("'/iframe/index.html'"));
});

test('iframe 必须探测 iframe/parent/top 浏览器上下文', () => {
	assert.ok(iframe.includes("{ label: 'iframe'"));
	assert.ok(iframe.includes("{ label: 'parent'"));
	assert.ok(iframe.includes("{ label: 'top'"));
	assert.ok(iframe.includes('context.indexedDB'));
});

test('同源 Window 必须按 origin 去重，不能只比较 IDBFactory 对象', () => {
	assert.ok(iframe.includes('context.location && context.location.origin'));
	assert.ok(iframe.includes('seenOrigins.has(origin)'));
	assert.ok(iframe.includes('seenOrigins.set(origin'));
	assert.ok(iframe.includes('duplicateReason'));
	assert.ok(iframe.includes('与 ${seenOrigins.get(origin)} 同源'));
});

test('parent 上下文必须优先于 top/iframe', () => {
	const parentIndex = iframe.indexOf("{ label: 'parent'");
	const topIndex = iframe.indexOf("{ label: 'top'");
	const iframeIndex = iframe.indexOf("{ label: 'iframe'");
	assert.ok(parentIndex >= 0 && topIndex > parentIndex && iframeIndex > topIndex);
});

test('活动数据库必须通过 Doctor 自身 UUID 唯一绑定', () => {
	assert.ok(iframe.includes('STORE_INDEX, DOCTOR_UUID'));
	assert.ok(iframe.includes('matches.length !== 1'));
	assert.ok(iframe.includes('无法唯一绑定扩展数据库'));
});

test('普通删除事务不得包含 standaloneScript Store', () => {
	assert.ok(iframe.includes("[STORE_INDEX, STORE_OBJECTS, STORE_CONFIG], 'readwrite'"));
	assert.equal(iframe.includes("[STORE_INDEX, STORE_OBJECTS, STORE_CONFIG, STORE_STANDALONE]"), false);
	assert.ok(iframe.includes('standaloneScript：不会操作'));
});

test('Doctor 自身必须禁止删除并要求精确确认文本', () => {
	assert.ok(iframe.includes('normalizeUuid(uuid) === DOCTOR_UUID'));
	assert.ok(iframe.includes('SELF_REMOVAL_FORBIDDEN'));
	assert.ok(iframe.includes('`DELETE ${uuid}`'));
	assert.ok(iframe.includes('DELETE_CONFIRMATION_MISMATCH'));
	assert.ok(iframe.includes('Doctor 自身不可卸载'));
});

test('EasyEDA iframe 删除确认必须由兼容层接管原生 prompt', () => {
	const bridgePos = iframeHtml.indexOf('src="/iframe/confirm-bridge.js"');
	const doctorPos = iframeHtml.indexOf('src="/iframe/doctor.js"');
	assert.ok(bridgePos >= 0 && doctorPos > bridgePos, 'confirm bridge must load before doctor.js');
	assert.ok(confirmBridge.includes('Object.defineProperty(window, \'prompt\''));
	assert.ok(confirmBridge.includes('window.confirm('));
	assert.ok(confirmBridge.includes('DELETE_RE'));
	assert.ok(confirmBridge.includes('ORPHAN_RE'));
	assert.ok(confirmBridge.includes("throw new Error('DELETE_CONFIRMATION_CANCELLED')"));
	assert.ok(confirmBridge.includes('return expected'));
});

test('普通删除后必须验证 index/config/object records 全部清零', () => {
	assert.ok(iframe.includes('DELETE_VERIFY_FAILED'));
	assert.ok(iframe.includes('verify.indexed || verify.configKeys.length || verify.objectKeys.length'));
	assert.ok(iframe.includes('residualState(uuid)'));
});

test('孤儿扫描必须比对 index/object/config 三个扩展 Store', () => {
	assert.ok(iframe.includes('async function scanOrphans()'));
	assert.ok(iframe.includes('getAllRecords(db, STORE_INDEX)'));
	assert.ok(iframe.includes('getAllKeys(db, STORE_OBJECTS)'));
	assert.ok(iframe.includes('getAllKeys(db, STORE_CONFIG)'));
	assert.ok(iframe.includes('if (indexed.has(item.uuid)) continue'));
	assert.ok(iframeHtml.includes('id="orphans"'));
	assert.ok(iframeHtml.includes('扫描孤儿残留'));
});

test('孤儿清理只能处理 index 缺失的残留，并在写入前再次校验', () => {
	assert.ok(iframe.includes('async function cleanOrphan(uuid)'));
	assert.ok(iframe.includes('ORPHAN_BECAME_INSTALLED'));
	assert.ok(iframe.includes('if (before.indexed)'));
	assert.ok(iframe.includes("[STORE_OBJECTS, STORE_CONFIG], 'readwrite'"));
	assert.ok(iframe.includes('`CLEAN ORPHAN ${normalized}`'));
	assert.ok(iframe.includes('ORPHAN_CLEAN_CONFIRMATION_MISMATCH'));
	assert.ok(iframe.includes('ORPHAN_CLEAN_VERIFY_FAILED'));
});

test('孤儿清理不得写 standaloneScript，也不得删除 extensionsIndex', () => {
	const cleanStart = iframe.indexOf('async function cleanOrphan(uuid)');
	const cleanEnd = iframe.indexOf('\n\tasync function remove(uuid)', cleanStart);
	assert.ok(cleanStart >= 0 && cleanEnd > cleanStart);
	const cleanBody = iframe.slice(cleanStart, cleanEnd);
	assert.equal(cleanBody.includes('STORE_STANDALONE'), false);
	assert.equal(cleanBody.includes('objectStore(STORE_INDEX).delete'), false);
	assert.ok(cleanBody.includes('[STORE_OBJECTS, STORE_CONFIG]'));
});

test('databases/open/request/transaction 必须全部具有超时边界', () => {
	assert.ok(iframe.includes('databases: 4000'));
	assert.ok(iframe.includes('open: 4000'));
	assert.ok(iframe.includes('request: 4000'));
	assert.ok(iframe.includes('transaction: 5000'));
	assert.ok(iframe.includes('withTimeout('));
	assert.ok(iframe.includes('makeTimeoutError('));
});

test('indexedDB.open 必须显式处理 blocked', () => {
	assert.ok(iframe.includes('request.onblocked'));
	assert.ok(iframe.includes('indexedDB.open() blocked'));
});

test('初始化和全局未捕获异常必须进入状态区', () => {
	assert.ok(iframe.includes("window.addEventListener('error'"));
	assert.ok(iframe.includes("window.addEventListener('unhandledrejection'"));
	assert.ok(iframe.includes("initialize().catch(error => reportFatal('初始化失败。', error))"));
});

test('iframe 外部脚本必须使用扩展包根路径，禁止相对 ./doctor.js', () => {
	assert.ok(iframeHtml.includes('src="/iframe/doctor.js"'));
	assert.ok(iframeHtml.includes('src="/iframe/confirm-bridge.js"'));
	assert.equal(iframeHtml.includes('src="./doctor.js"'), false);
});

test('静态页面必须能区分 HTML、bootstrap、资源加载和 doctor.js 执行阶段', () => {
	assert.ok(iframeHtml.includes('HTML 页面已加载，等待启动脚本'));
	assert.ok(iframeHtml.includes('HTML 启动脚本已执行'));
	assert.ok(iframeHtml.includes('doctor.js 资源加载失败'));
	assert.ok(iframeHtml.includes('doctor.js 资源已加载，但没有进入预期初始化阶段'));
	assert.ok(iframe.includes('doctor.js 已加载'));
});

test('EEXT 包必须排除开发仓库内容但保留 iframe', () => {
	for (const required of ['/.github/', '/build/', '/config/', '/docs/', '/node_modules/', '/src/', '/tests/', '/package.json']) {
		assert.ok(edaIgnore.includes(required), `missing .edaignore rule: ${required}`);
	}
	assert.equal(edaIgnore.includes('/iframe/'), false, 'iframe runtime must not be excluded');
});

test('Manifest 菜单 registerFn 必须全部对应导出函数', () => {
	const functions = new Set();
	for (const menus of Object.values(manifest.headerMenus)) {
		for (const menu of menus) {
			for (const item of menu.menuItems) functions.add(item.registerFn);
		}
	}
	for (const functionName of functions) {
		assert.ok(entry.includes(`export ${functionName === 'about' ? 'function' : 'async function'} ${functionName}`), `missing export: ${functionName}`);
	}
});
