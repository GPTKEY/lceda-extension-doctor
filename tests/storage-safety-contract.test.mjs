import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storage = readFileSync(new URL('../src/storage.ts', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../extension.json', import.meta.url), 'utf8'));
const edaIgnore = readFileSync(new URL('../.edaignore', import.meta.url), 'utf8');

test('底层必须双重禁止 Doctor 自删除', () => {
	const guards = storage.match(/uuid === DOCTOR_UUID/g) ?? [];
	assert.ok(guards.length >= 2, 'plan/remove 两层都必须禁止 self removal');
	assert.ok(storage.includes('SELF_REMOVAL_FORBIDDEN'));
});

test('活动数据库必须通过 Doctor 自身 UUID 唯一绑定', () => {
	assert.ok(storage.includes('getExactRecord(database, STORE_INDEX, DOCTOR_UUID)'));
	assert.ok(storage.includes('activeCandidates.length !== 1'));
	assert.ok(storage.includes('STORAGE_IDENTITY_UNRESOLVED'));
});

test('删除事务不得包含 standaloneScript Store', () => {
	const writeTransaction = storage.match(/transaction\(\[STORE_INDEX, STORE_OBJECTS, STORE_CONFIG\], 'readwrite'\)/);
	assert.ok(writeTransaction, 'write transaction must be restricted to exactly three extension stores');
	assert.ok(storage.includes('standaloneScriptTouched: false'));
});

test('UI 卸载列表必须排除 Doctor 自身，并在确认后才调用删除', () => {
	assert.ok(entry.includes('.filter(extension => extension.uuid !== DOCTOR_UUID)'));
	const confirmationIndex = entry.indexOf('showConfirmationMessage');
	const deleteIndex = entry.indexOf('removeExtensionByUuid(uuid)');
	assert.ok(confirmationIndex >= 0 && deleteIndex > confirmationIndex);
});

test('EEXT 包必须排除开发仓库内容', () => {
	for (const required of ['/.github/', '/build/', '/config/', '/docs/', '/node_modules/', '/src/', '/tests/', '/package.json']) {
		assert.ok(edaIgnore.includes(required), `missing .edaignore rule: ${required}`);
	}
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
