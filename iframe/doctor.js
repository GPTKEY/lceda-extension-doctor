(() => {
	'use strict';

	const DOCTOR_UUID = '4350c76638924d56a704e7c1906ba0c1';
	const STORE_INDEX = 'extensionsIndex';
	const STORE_OBJECTS = 'extensionsObjectStorage';
	const STORE_CONFIG = 'extensionsUserConfig';
	const STORE_STANDALONE = 'standaloneScript';
	const REQUIRED_STORES = [STORE_INDEX, STORE_OBJECTS, STORE_CONFIG];
	const UUID_RE = /^[0-9a-f]{32}$/i;

	const TIMEOUT = Object.freeze({ databases: 4000, open: 4000, request: 4000, transaction: 5000 });
	const statusEl = document.getElementById('status');
	const contentEl = document.getElementById('content');
	let active = null;
	let phase = 'bootstrap';

	function setStatus(text, ok = null) {
		if (!statusEl) return;
		statusEl.textContent = text;
		statusEl.className = `status ${ok === true ? 'good' : ok === false ? 'bad' : ''}`;
	}
	function setPhase(nextPhase, detail = '') {
		phase = nextPhase;
		setStatus(`运行阶段：${nextPhase}${detail ? `\n${detail}` : ''}`);
	}
	function esc(value) {
		return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
	}
	function readableError(error) { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
	function makeTimeoutError(label, timeoutMs) { return new Error(`${label} 超时（>${timeoutMs} ms）`); }
	function normalizeUuid(value) {
		const text = String(value ?? '').trim();
		return UUID_RE.test(text) ? text.toLowerCase() : null;
	}
	function uuidFromObjectKey(value) {
		const text = String(value ?? '');
		const separator = text.indexOf('|');
		return normalizeUuid(separator >= 0 ? text.slice(0, separator) : text);
	}
	function withTimeout(promise, timeoutMs, label) {
		let timer;
		return Promise.race([
			Promise.resolve(promise),
			new Promise((_, reject) => { timer = window.setTimeout(() => reject(makeTimeoutError(label, timeoutMs)), timeoutMs); }),
		]).finally(() => { if (timer !== undefined) window.clearTimeout(timer); });
	}

	function requestToPromise(request, label = 'IndexedDB request', timeoutMs = TIMEOUT.request) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = window.setTimeout(() => { if (!settled) { settled = true; reject(makeTimeoutError(label, timeoutMs)); } }, timeoutMs);
			const finish = callback => () => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				callback();
			};
			request.onsuccess = finish(() => resolve(request.result));
			request.onerror = finish(() => reject(request.error || new Error(`${label} failed`)));
		});
	}
	function transactionToPromise(tx, label = 'IndexedDB transaction', timeoutMs = TIMEOUT.transaction) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = window.setTimeout(() => {
				if (settled) return;
				settled = true;
				try { tx.abort(); } catch {}
				reject(makeTimeoutError(label, timeoutMs));
			}, timeoutMs);
			const finish = callback => () => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				callback();
			};
			tx.oncomplete = finish(resolve);
			tx.onerror = finish(() => reject(tx.error || new Error(`${label} failed`)));
			tx.onabort = finish(() => reject(tx.error || new Error(`${label} aborted`)));
		});
	}

	/**
	 * IndexedDB 以 origin 为命名空间。同源 Window 即使暴露不同 IDBFactory JS 对象，
	 * 底层仍是同一存储，因此优先按 origin 去重；origin 不可读时才退回 factory 身份。
	 * parent 优先，因为真实编辑器页面上下文已经验证可访问用户扩展数据库。
	 */
	function contexts() {
		const candidates = [
			{ label: 'parent', get: () => window.parent },
			{ label: 'top', get: () => window.top },
			{ label: 'iframe', get: () => window },
		];
		const result = [];
		const seenFactories = new Set();
		const seenOrigins = new Map();

		for (const candidate of candidates) {
			try {
				const context = candidate.get();
				const factory = context && context.indexedDB;
				if (!factory) {
					result.push({ label: candidate.label, error: 'indexedDB 不存在' });
					continue;
				}

				let origin = null;
				try {
					const value = context.location && context.location.origin;
					if (typeof value === 'string' && value && value !== 'null') origin = value;
				}
				catch {}

				if (origin && seenOrigins.has(origin)) {
					result.push({ label: candidate.label, duplicate: true, duplicateReason: `与 ${seenOrigins.get(origin)} 同源`, origin });
					continue;
				}
				if (!origin && seenFactories.has(factory)) {
					result.push({ label: candidate.label, duplicate: true, duplicateReason: 'IndexedDBFactory 对象相同', origin: null });
					continue;
				}

				if (origin) seenOrigins.set(origin, candidate.label);
				seenFactories.add(factory);
				result.push({ label: candidate.label, factory, origin });
			}
			catch (error) {
				result.push({ label: candidate.label, error: readableError(error) });
			}
		}
		return result;
	}

	async function listDatabases(factory, label) {
		if (!factory || typeof factory.databases !== 'function') throw new Error(`${label}: indexedDB.databases() 不可用`);
		return withTimeout(factory.databases(), TIMEOUT.databases, `${label}: indexedDB.databases()`);
	}
	function openDb(factory, name, label = name) {
		return new Promise((resolve, reject) => {
			let settled = false;
			let request;
			const timer = window.setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(makeTimeoutError(`${label}: indexedDB.open(${name})`, TIMEOUT.open));
			}, TIMEOUT.open);
			const fail = error => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				reject(error);
			};
			try { request = factory.open(name); } catch (error) { fail(error); return; }
			request.onsuccess = () => {
				if (settled) { try { request.result.close(); } catch {} return; }
				settled = true;
				window.clearTimeout(timer);
				resolve(request.result);
			};
			request.onerror = () => fail(request.error || new Error(`${label}: indexedDB.open() failed`));
			request.onblocked = () => fail(new Error(`${label}: indexedDB.open() blocked`));
		});
	}
	async function getRecord(db, storeName, key) {
		const tx = db.transaction(storeName, 'readonly');
		const done = transactionToPromise(tx, `读取 ${storeName}`);
		const result = await requestToPromise(tx.objectStore(storeName).get(key), `读取 ${storeName}[${String(key)}]`);
		await done;
		return result;
	}
	async function getAllRecords(db, storeName) {
		const tx = db.transaction(storeName, 'readonly');
		const done = transactionToPromise(tx, `枚举 ${storeName}`);
		const records = await requestToPromise(tx.objectStore(storeName).getAll(), `枚举 ${storeName}`);
		await done;
		return records;
	}
	async function getAllKeys(db, storeName) {
		const tx = db.transaction(storeName, 'readonly');
		const done = transactionToPromise(tx, `枚举 ${storeName} keys`);
		const keys = await requestToPromise(tx.objectStore(storeName).getAllKeys(), `枚举 ${storeName} keys`);
		await done;
		return keys;
	}
	async function collectObjectKeys(db, uuid) {
		const normalized = normalizeUuid(uuid);
		if (!normalized) throw new Error('INVALID_UUID');
		return (await getAllKeys(db, STORE_OBJECTS)).filter(key => uuidFromObjectKey(key) === normalized);
	}
	async function collectConfigKeys(db, uuid) {
		const normalized = normalizeUuid(uuid);
		if (!normalized) throw new Error('INVALID_UUID');
		return (await getAllKeys(db, STORE_CONFIG)).filter(key => normalizeUuid(key) === normalized);
	}
	function summary(raw, database) {
		const record = raw && typeof raw === 'object' ? raw : {};
		const config = record.config && typeof record.config === 'object' ? record.config : {};
		return {
			database,
			uuid: String(record.uuid || config.uuid || ''),
			name: String(config.name || record.name || ''),
			displayName: String(config.displayName || record.displayName || ''),
			version: String(config.version || record.version || ''),
			enabled: typeof record.isEnable === 'boolean' ? record.isEnable : null,
			allowExternalInteractions: typeof record.isAllowExternalInteractions === 'boolean' ? record.isAllowExternalInteractions : null,
			fileSize: typeof record.fileSize === 'number' ? record.fileSize : null,
		};
	}
	async function readManifestFromRecord(record) {
		try {
			const source = record && record.source;
			if (source && typeof source.text === 'function') {
				return JSON.parse(await withTimeout(source.text(), TIMEOUT.request, '读取 extension.json Blob'));
			}
		}
		catch {}
		return null;
	}
	async function inspectDatabaseCandidate(probe, descriptor, diagnostics) {
		if (!descriptor.name) return null;
		let db;
		try {
			db = await openDb(probe.factory, descriptor.name, `${probe.label}/${descriptor.name}`);
			const stores = Array.from(db.objectStoreNames);
			if (!REQUIRED_STORES.every(name => stores.includes(name))) return null;
			const self = await getRecord(db, STORE_INDEX, DOCTOR_UUID);
			if (!self) return null;
			return { label: probe.label, factory: probe.factory, origin: probe.origin || null, name: descriptor.name, version: descriptor.version, stores };
		}
		catch (error) {
			diagnostics.push(`${probe.label}/${descriptor.name}: ${readableError(error)}`);
			return null;
		}
		finally { try { db && db.close(); } catch {} }
	}

	async function discover() {
		active = null;
		if (contentEl) contentEl.innerHTML = '';
		setPhase('discover:start', '正在枚举 iframe / parent / top 存储上下文……');
		const probes = contexts();
		const diagnostics = [];
		const matches = [];
		if (probes.length === 0) { setStatus('没有可探测的浏览器上下文，已停止所有写操作。', false); return null; }

		for (const probe of probes) {
			if (probe.duplicate) {
				diagnostics.push(`${probe.label}: ${probe.duplicateReason || '重复存储上下文'}${probe.origin ? ` (${probe.origin})` : ''}，跳过重复探测`);
				continue;
			}
			if (probe.error) { diagnostics.push(`${probe.label}: ${probe.error}`); continue; }
			diagnostics.push(`${probe.label}: origin=${probe.origin || '不可读取/opaque'}`);
			setPhase(`discover:${probe.label}:databases`, `正在调用 ${probe.label}.indexedDB.databases()，超时 ${TIMEOUT.databases} ms`);
			let descriptors;
			try {
				descriptors = await listDatabases(probe.factory, probe.label);
				diagnostics.push(`${probe.label}: 可见数据库 ${descriptors.length} 个`);
			}
			catch (error) { diagnostics.push(`${probe.label}: databases() 失败：${readableError(error)}`); continue; }

			const candidates = descriptors.filter(descriptor => descriptor && descriptor.name).slice(0, 64);
			setPhase(`discover:${probe.label}:open`, `正在检查 ${candidates.length} 个数据库候选；每个 open 最长 ${TIMEOUT.open} ms`);
			const inspected = await Promise.all(candidates.map(descriptor => inspectDatabaseCandidate(probe, descriptor, diagnostics)));
			for (const match of inspected) if (match) matches.push(match);
		}

		if (matches.length !== 1) {
			setStatus(`无法唯一绑定扩展数据库，已停止所有写操作。\n运行阶段：${phase}\n匹配数量：${matches.length}\n\n${diagnostics.join('\n') || '没有可访问的 IndexedDB 上下文。'}`, false);
			return null;
		}
		active = matches[0];
		setStatus(`存储已绑定。\n上下文：${active.label}\nOrigin：${active.origin || '不可读取/opaque'}\n数据库：${active.name}\n版本：${active.version ?? '未知'}\nStore：${active.stores.join(', ')}`, true);
		return active;
	}
	async function withDb(callback) {
		if (!active) await discover();
		if (!active) throw new Error('STORAGE_NOT_BOUND');
		const db = await openDb(active.factory, active.name, `${active.label}/${active.name}`);
		try { return await callback(db); } finally { db.close(); }
	}
	async function listExtensions() {
		return withDb(async db => (await getAllRecords(db, STORE_INDEX)).map(raw => summary(raw, db.name)).filter(item => normalizeUuid(item.uuid)));
	}
	async function inspect(uuid) {
		return withDb(async db => {
			const indexRecord = await getRecord(db, STORE_INDEX, uuid);
			if (!indexRecord) throw new Error('EXTENSION_NOT_FOUND');
			const target = summary(indexRecord, db.name);
			if (normalizeUuid(target.uuid) !== normalizeUuid(uuid)) throw new Error('EXTENSION_IDENTITY_MISMATCH');
			const objectKeys = await collectObjectKeys(db, uuid);
			const configKeys = await collectConfigKeys(db, uuid);
			const manifestRecord = await getRecord(db, STORE_OBJECTS, `${uuid}|extension.json`);
			const manifest = await readManifestFromRecord(manifestRecord);
			return {
				target,
				objectCount: objectKeys.length,
				userConfig: configKeys.length > 0,
				manifestName: manifest && manifest.name || null,
				manifestVersion: manifest && manifest.version || null,
			};
		});
	}

	/**
	 * 扫描“索引已经消失、但文件或用户配置仍然存在”的孤儿扩展。
	 * standaloneScript 从不参与 UUID 汇总，也不会进入任何清理事务。
	 */
	async function scanOrphans() {
		return withDb(async db => {
			const indexRecords = await getAllRecords(db, STORE_INDEX);
			const indexed = new Set(indexRecords.map(raw => normalizeUuid(summary(raw, db.name).uuid)).filter(Boolean));
			const objectKeys = await getAllKeys(db, STORE_OBJECTS);
			const configKeys = await getAllKeys(db, STORE_CONFIG);
			const map = new Map();

			function ensure(uuid) {
				if (!map.has(uuid)) map.set(uuid, { uuid, objectKeys: [], configKeys: [] });
				return map.get(uuid);
			}
			for (const key of objectKeys) {
				const uuid = uuidFromObjectKey(key);
				if (uuid) ensure(uuid).objectKeys.push(key);
			}
			for (const key of configKeys) {
				const uuid = normalizeUuid(key);
				if (uuid) ensure(uuid).configKeys.push(key);
			}

			const orphans = [];
			for (const item of map.values()) {
				if (indexed.has(item.uuid)) continue;
				const manifestKey = item.objectKeys.find(key => String(key).toLowerCase() === `${item.uuid}|extension.json`);
				let manifest = null;
				if (manifestKey !== undefined) manifest = await readManifestFromRecord(await getRecord(db, STORE_OBJECTS, manifestKey));
				orphans.push({
					uuid: item.uuid,
					name: manifest && String(manifest.name || '') || '',
					displayName: manifest && String(manifest.displayName || '') || '',
					version: manifest && String(manifest.version || '') || '',
					objectCount: item.objectKeys.length,
					configCount: item.configKeys.length,
				});
			}
			return orphans.sort((a, b) => (a.displayName || a.name || a.uuid).localeCompare(b.displayName || b.name || b.uuid));
		});
	}

	async function residualState(uuid) {
		const normalized = normalizeUuid(uuid);
		if (!normalized) throw new Error('INVALID_UUID');
		return withDb(async db => {
			const indexRecords = await getAllRecords(db, STORE_INDEX);
			const indexed = indexRecords.some(raw => normalizeUuid(summary(raw, db.name).uuid) === normalized);
			return {
				indexed,
				objectKeys: await collectObjectKeys(db, normalized),
				configKeys: await collectConfigKeys(db, normalized),
			};
		});
	}

	async function cleanOrphan(uuid) {
		const normalized = normalizeUuid(uuid);
		if (!normalized) throw new Error('INVALID_UUID');
		if (normalized === DOCTOR_UUID) throw new Error('SELF_REMOVAL_FORBIDDEN');

		const before = await residualState(normalized);
		if (before.indexed) throw new Error('ORPHAN_BECAME_INSTALLED');
		if (before.objectKeys.length === 0 && before.configKeys.length === 0) throw new Error('ORPHAN_ALREADY_CLEAN');

		const expected = `CLEAN ORPHAN ${normalized}`;
		const typed = window.prompt(
			`即将清理孤儿扩展残留。\nUUID：${normalized}\n对象记录：${before.objectKeys.length}\n用户配置记录：${before.configKeys.length}\nextensionsIndex：不存在\nstandaloneScript：不会操作\n\n如果目标在写入前重新出现在 extensionsIndex，操作会自动中止。\n\n请输入以下确认文本：\n${expected}`,
			'',
		);
		if (typed !== expected) throw new Error('ORPHAN_CLEAN_CONFIRMATION_MISMATCH');

		await withDb(async db => {
			const indexRecords = await getAllRecords(db, STORE_INDEX);
			if (indexRecords.some(raw => normalizeUuid(summary(raw, db.name).uuid) === normalized)) {
				throw new Error('ORPHAN_BECAME_INSTALLED');
			}
			const objectKeys = await collectObjectKeys(db, normalized);
			const configKeys = await collectConfigKeys(db, normalized);
			const tx = db.transaction([STORE_OBJECTS, STORE_CONFIG], 'readwrite');
			const done = transactionToPromise(tx, `清理孤儿扩展 ${normalized}`, TIMEOUT.transaction);
			const objectStore = tx.objectStore(STORE_OBJECTS);
			for (const key of objectKeys) objectStore.delete(key);
			const configStore = tx.objectStore(STORE_CONFIG);
			for (const key of configKeys) configStore.delete(key);
			await done;
		});

		const verify = await residualState(normalized);
		if (verify.indexed || verify.objectKeys.length || verify.configKeys.length) {
			throw new Error(`ORPHAN_CLEAN_VERIFY_FAILED index=${verify.indexed} objects=${verify.objectKeys.length} config=${verify.configKeys.length}`);
		}
		window.alert('孤儿扩展残留清理完成，删除后验证已通过。\n\n请完全退出并重新启动嘉立创 EDA / EasyEDA Pro。');
		await renderOrphans();
	}

	async function remove(uuid) {
		if (normalizeUuid(uuid) === DOCTOR_UUID) throw new Error('SELF_REMOVAL_FORBIDDEN');
		const plan = await inspect(uuid);
		const expected = `DELETE ${uuid}`;
		const typed = window.prompt(`即将精确删除：${plan.target.displayName || plan.target.name}\n版本：${plan.target.version || '未知'}\nUUID：${uuid}\n对象记录：${plan.objectCount}\n用户配置：${plan.userConfig ? 1 : 0}\nstandaloneScript：不会操作\n\n请输入以下确认文本：\n${expected}`, '');
		if (typed !== expected) throw new Error('DELETE_CONFIRMATION_MISMATCH');
		await withDb(async db => {
			const current = await getRecord(db, STORE_INDEX, uuid);
			const identity = summary(current, db.name);
			if (!current || normalizeUuid(identity.uuid) !== normalizeUuid(uuid) || identity.name !== plan.target.name) throw new Error('EXTENSION_CHANGED_BEFORE_DELETE');
			const objectKeys = await collectObjectKeys(db, uuid);
			const configKeys = await collectConfigKeys(db, uuid);
			const tx = db.transaction([STORE_INDEX, STORE_OBJECTS, STORE_CONFIG], 'readwrite');
			const done = transactionToPromise(tx, `删除扩展 ${uuid}`, TIMEOUT.transaction);
			tx.objectStore(STORE_INDEX).delete(uuid);
			const configStore = tx.objectStore(STORE_CONFIG);
			for (const key of configKeys) configStore.delete(key);
			const objectStore = tx.objectStore(STORE_OBJECTS);
			for (const key of objectKeys) objectStore.delete(key);
			await done;
		});
		const verify = await residualState(uuid);
		if (verify.indexed || verify.configKeys.length || verify.objectKeys.length) throw new Error(`DELETE_VERIFY_FAILED index=${verify.indexed} config=${verify.configKeys.length} objects=${verify.objectKeys.length}`);
		window.alert('精确删除完成，删除后验证已通过。\n\n请完全退出并重新启动嘉立创 EDA / EasyEDA Pro。');
		await renderList();
	}

	function renderRows(items) {
		return items.map(item => {
			const self = normalizeUuid(item.uuid) === DOCTOR_UUID;
			const removeButton = self
				? '<button disabled>Doctor 自身不可卸载</button>'
				: `<button class="danger" data-action="remove" data-uuid="${esc(item.uuid)}">精确卸载</button>`;
			return `<tr><td>${esc(item.displayName || item.name || item.uuid)}${self ? ' <b>[Doctor 自身]</b>' : ''}</td><td>${esc(item.version || '未知')}</td><td><code>${esc(item.uuid)}</code></td><td>${item.enabled === false ? '禁用' : item.enabled === true ? '启用' : '未知'}</td><td><button data-action="inspect" data-uuid="${esc(item.uuid)}">检查</button> ${removeButton}</td></tr>`;
		}).join('');
	}
	function bindInstalledActions() {
		contentEl.querySelectorAll('button[data-action]').forEach(button => {
			button.addEventListener('click', async () => {
				const uuid = button.dataset.uuid;
				try {
					if (button.dataset.action === 'inspect') {
						const result = await inspect(uuid);
						window.alert([`名称：${result.target.displayName || result.target.name}`, `UUID：${result.target.uuid}`, `索引版本：${result.target.version || '未知'}`, `Manifest：${result.manifestName || '无法读取'} ${result.manifestVersion || ''}`, `对象记录：${result.objectCount}`, `用户配置：${result.userConfig ? '存在' : '不存在'}`].join('\n'));
					}
					else if (button.dataset.action === 'remove') await remove(uuid);
				}
				catch (error) { window.alert(`操作失败：\n${readableError(error)}\n\n没有继续执行后续写操作。`); }
			});
		});
	}
	async function renderList() {
		try {
			setPhase('list:extensions', '正在读取 extensionsIndex……');
			const items = await listExtensions();
			contentEl.innerHTML = `<table><thead><tr><th>扩展</th><th>版本</th><th>UUID</th><th>状态</th><th>操作</th></tr></thead><tbody>${renderRows(items)}</tbody></table>`;
			if (active) setStatus(`存储已绑定。\n上下文：${active.label}\nOrigin：${active.origin || '不可读取/opaque'}\n数据库：${active.name}\n已读取扩展：${items.length} 个`, true);
			bindInstalledActions();
		}
		catch (error) { setStatus(`读取扩展列表失败。\n运行阶段：${phase}\n${readableError(error)}\n\n没有执行任何写操作。`, false); }
	}
	async function renderOrphans() {
		try {
			setPhase('scan:orphans', '正在比对 extensionsIndex / extensionsObjectStorage / extensionsUserConfig……');
			const items = await scanOrphans();
			if (items.length === 0) {
				contentEl.innerHTML = '<p><b>未发现孤儿扩展残留。</b></p><p class="small">即：没有发现“extensionsIndex 已缺失，但对象文件或用户配置仍存在”的 UUID。</p>';
				setStatus('孤儿残留扫描完成：0 个。\n没有执行任何写操作。', true);
				return;
			}
			const rows = items.map(item => `<tr><td>${esc(item.displayName || item.name || '无法从 Manifest 识别')}</td><td>${esc(item.version || '未知')}</td><td><code>${esc(item.uuid)}</code></td><td>${item.objectCount}</td><td>${item.configCount}</td><td><button class="danger" data-action="clean-orphan" data-uuid="${esc(item.uuid)}">清理残留</button></td></tr>`).join('');
			contentEl.innerHTML = `<p><b>发现 ${items.length} 个孤儿扩展 UUID。</b></p><table><thead><tr><th>Manifest</th><th>版本</th><th>UUID</th><th>对象记录</th><th>配置记录</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
			setStatus(`孤儿残留扫描完成：${items.length} 个。\n这些 UUID 不存在于 extensionsIndex；当前仅展示，尚未执行写操作。`, false);
			contentEl.querySelectorAll('button[data-action="clean-orphan"]').forEach(button => {
				button.addEventListener('click', async () => {
					try { await cleanOrphan(button.dataset.uuid); }
					catch (error) { window.alert(`残留清理失败：\n${readableError(error)}\n\n没有继续执行后续写操作。`); }
				});
			});
		}
		catch (error) { setStatus(`孤儿残留扫描失败。\n运行阶段：${phase}\n${readableError(error)}\n\n没有执行任何写操作。`, false); }
	}
	async function diagnostics() {
		try {
			if (!active) await discover();
			if (!active) return;
			const items = await listExtensions();
			const orphans = await scanOrphans();
			contentEl.innerHTML = `<pre>${esc(JSON.stringify({ context: active.label, origin: active.origin || null, database: active.name, version: active.version, stores: active.stores, extensionCount: items.length, orphanCount: orphans.length, orphanUuids: orphans.map(item => item.uuid), selfUuid: DOCTOR_UUID, standaloneScriptPresent: active.stores.includes(STORE_STANDALONE), timeoutsMs: TIMEOUT }, null, 2))}</pre>`;
		} catch (error) { setStatus(`诊断失败。\n运行阶段：${phase}\n${readableError(error)}`, false); }
	}
	function reportFatal(prefix, error) {
		const detail = readableError(error);
		console.error(`[EDA Extension Doctor] ${prefix}`, error);
		setStatus(`${prefix}\n运行阶段：${phase}\n${detail}\n\n为防止误删，当前会话不会继续执行写操作。`, false);
	}

	setStatus('doctor.js 已加载。\n正在安装运行时异常保护……');
	window.addEventListener('error', event => reportFatal('页面脚本发生未捕获异常。', event.error || event.message));
	window.addEventListener('unhandledrejection', event => reportFatal('页面 Promise 发生未捕获拒绝。', event.reason));
	const scanButton = document.getElementById('scan');
	const orphanButton = document.getElementById('orphans');
	const diagnosticsButton = document.getElementById('diagnostics');
	const refreshButton = document.getElementById('refresh');
	if (!scanButton || !orphanButton || !diagnosticsButton || !refreshButton || !statusEl || !contentEl) { reportFatal('Doctor 页面结构不完整。', new Error('REQUIRED_DOM_ELEMENT_MISSING')); return; }
	scanButton.addEventListener('click', () => renderList().catch(error => reportFatal('扫描扩展失败。', error)));
	orphanButton.addEventListener('click', () => renderOrphans().catch(error => reportFatal('孤儿残留扫描失败。', error)));
	diagnosticsButton.addEventListener('click', () => diagnostics().catch(error => reportFatal('存储诊断失败。', error)));
	refreshButton.addEventListener('click', () => { (async () => { await discover(); if (active) await renderList(); })().catch(error => reportFatal('重新探测上下文失败。', error)); });
	async function initialize() {
		setPhase('initialize', 'doctor.js 已执行，开始首次存储探测……');
		await discover();
		if (active) await renderList();
	}
	initialize().catch(error => reportFatal('初始化失败。', error));
})();