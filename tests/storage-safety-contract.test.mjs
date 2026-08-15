import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const iframe = readFileSync(new URL('../iframe/doctor.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../extension.json', import.meta.url), 'utf8'));
const edaIgnore = readFileSync(new URL('../.edaignore', import.meta.url), 'utf8');

test('扩展主线程不得再直接访问 IndexedDB', () => {
	assert.equal(entry.includes('indexedDB'), false);
	assert.ok(entry.includes('eda.sys_IFrame.openIFrame'));
	assert.ok(entry.includes("'/iframe/index.html'"));
});

test('iframe 必须探测 iframe/parent/top 浏览器上下文', () => {
	assert.ok(iframe.includes("{ label: 'iframe'"));
	assert.ok(iframe.includes("{ label: 'parent'"));
	assert.ok(iframe.includes("{ label: 'top'"));
	assert.ok(iframe.includes('context.indexedDB'));
});

test('活动数据库必须通过 Doctor 自身 UUID 唯一绑定', () => {
	assert.ok(iframe.includes('STORE_INDEX, DOCTOR_UUID'));
	assert.ok(iframe.includes('matches.length !== 1'));
	assert.ok(iframe.includes('无法唯一绑定扩展数据库'));
});

test('删除事务不得包含 standaloneScript Store', () => {
	assert.ok(iframe.includes("[STORE_INDEX, STORE_OBJECTS, STORE_CONFIG], 'readwrite'"));
	assert.equal(iframe.includes("[STORE_INDEX, STORE_OBJECTS, STORE_CONFIG, STORE_STANDALONE]"), false);
	assert.ok(iframe.includes('standaloneScript：不会操作'));
});

test('Doctor 自身必须禁止删除并要求精确确认文本', () => {
	assert.ok(iframe.includes("uuid === DOCTOR_UUID"));
	assert.ok(iframe.includes('SELF_REMOVAL_FORBIDDEN'));
	assert.ok(iframe.includes('`DELETE ${uuid}`'));
	assert.ok(iframe.includes('DELETE_CONFIRMATION_MISMATCH'));
});

test('删除后必须验证 index/config/object records 全部清零', () => {
	assert.ok(iframe.includes('DELETE_VERIFY_FAILED'));
	assert.ok(iframe.includes('verify.index || verify.config || verify.objects.length'));
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
