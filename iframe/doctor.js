(() => {
	'use strict';

	const DOCTOR_UUID = '4350c76638924d56a704e7c1906ba0c1';
	const STORE_INDEX = 'extensionsIndex';
	const STORE_OBJECTS = 'extensionsObjectStorage';
	const STORE_CONFIG = 'extensionsUserConfig';
	const STORE_STANDALONE = 'standaloneScript';
	const REQUIRED_STORES = [STORE_INDEX, STORE_OBJECTS, STORE_CONFIG];

	const statusEl = document.getElementById('status');
	const contentEl = document.getElementById('content');
	let active = null;

	function setStatus(text, ok = null) {
		statusEl.textContent = text;
		statusEl.className = `status ${ok === true ? 'good' : ok === false ? 'bad' : ''}`;
	}

	function esc(value) {
		return String(value ?? '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;');
	}

	function requestToPromise(request) {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
		});
	}

	function transactionToPromise(tx) {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
			tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
		});
	}

	function readableError(error) {
		return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	}

	function contexts() {
		const candidates = [
			{ label: 'iframe', get: () => window },
			{ label: 'parent', get: () => window.parent },
			{ label: 'top', get: () => window.top },
		];
		const result = [];
		const seen = new Set();
		for (const candidate of candidates) {
			try {
				const context = candidate.get();
				const factory = context && context.indexedDB;
				if (!factory || seen.has(factory)) continue;
				seen.add(factory);
				result.push({ label: candidate.label, factory });
			}
			catch (error) {
				result.push({ label: candidate.label, error: readableError(error) });
			}
		}
		return result;
	}

	async function openDb(factory, name) {
		return requestToPromise(factory.open(name));
	}

	async function getRecord(db, storeName, key) {
		const tx = db.transaction(storeName, 'readonly');
		const result = await requestToPromise(tx.objectStore(storeName).get(key));
		await transactionToPromise(tx);
		return result;
	}

	async function collectObjectKeys(db, uuid) {
		const tx = db.transaction(STORE_OBJECTS, 'readonly');
		const store = tx.objectStore(STORE_OBJECTS);
		const keys = [];
		await new Promise((resolve, reject) => {
			const req = store.openKeyCursor();
			req.onsuccess = event => {
				const cursor = event.target.result;
				if (!cursor) return resolve();
				const key = String(cursor.key);
				if (key === uuid || key.startsWith(`${uuid}|`)) keys.push(cursor.key);
				cursor.continue();
			};
			req.onerror = () => reject(req.error);
		});
		await transactionToPromise(tx);
		return keys;
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

	async function discover() {
		active = null;
		contentEl.innerHTML = '';
		const probes = contexts();
		const diagnostics = [];
		const matches = [];

		for (const probe of probes) {
			if (probe.error) {
				diagnostics.push(`${probe.label}: ${probe.error}`);
				continue;
			}
			if (typeof probe.factory.databases !== 'function') {
				diagnostics.push(`${probe.label}: indexedDB 存在，但 databases() 不可用`);
				continue;
			}
			let descriptors;
			try {
				descriptors = await probe.factory.databases();
				diagnostics.push(`${probe.label}: 可见数据库 ${descriptors.length} 个`);
			}
			catch (error) {
				diagnostics.push(`${probe.label}: databases() 失败：${readableError(error)}`);
				continue;
			}

			for (const descriptor of descriptors) {
				if (!descriptor.name) continue;
				let db;
				try {
					db = await openDb(probe.factory, descriptor.name);
					const stores = Array.from(db.objectStoreNames);
					if (!REQUIRED_STORES.every(name => stores.includes(name))) continue;
					const self = await getRecord(db, STORE_INDEX, DOCTOR_UUID);
					if (self) {
						matches.push({
							label: probe.label,
							factory: probe.factory,
							name: descriptor.name,
							version: descriptor.version,
							stores,
						});
					}
				}
				catch (error) {
					diagnostics.push(`${probe.label}/${descriptor.name}: ${readableError(error)}`);
				}
				finally {
					try { db && db.close(); } catch {}
				}
			}
		}

		if (matches.length !== 1) {
			setStatus(
				`无法唯一绑定扩展数据库，已停止所有写操作。\n匹配数量：${matches.length}\n\n${diagnostics.join('\n') || '没有可访问的 IndexedDB 上下文。'}`,
				false,
			);
			return null;
		}

		active = matches[0];
		setStatus(
			`存储已绑定。\n上下文：${active.label}\n数据库：${active.name}\n版本：${active.version ?? '未知'}\nStore：${active.stores.join(', ')}`,
			true,
		);
		return active;
	}

	async function withDb(callback) {
		if (!active) await discover();
		if (!active) throw new Error('STORAGE_NOT_BOUND');
		const db = await openDb(active.factory, active.name);
		try { return await callback(db); }
		finally { db.close(); }
	}

	async function listExtensions() {
		return withDb(async db => {
			const tx = db.transaction(STORE_INDEX, 'readonly');
			const records = await requestToPromise(tx.objectStore(STORE_INDEX).getAll());
			await transactionToPromise(tx);
			return records.map(raw => summary(raw, db.name)).filter(item => item.uuid);
		});
	}

	async function inspect(uuid) {
		return withDb(async db => {
			const indexRecord = await getRecord(db, STORE_INDEX, uuid);
			if (!indexRecord) throw new Error('EXTENSION_NOT_FOUND');
			const target = summary(indexRecord, db.name);
			if (target.uuid !== uuid) throw new Error('EXTENSION_IDENTITY_MISMATCH');
			const objectKeys = await collectObjectKeys(db, uuid);
			const config = await getRecord(db, STORE_CONFIG, uuid);
			const manifestRecord = await getRecord(db, STORE_OBJECTS, `${uuid}|extension.json`);
			let manifest = null;
			try {
				const source = manifestRecord && manifestRecord.source;
				if (source && typeof source.text === 'function') manifest = JSON.parse(await source.text());
			}
			catch {}
			return {
				target,
				objectCount: objectKeys.length,
				userConfig: Boolean(config),
				manifestName: manifest && manifest.name || null,
				manifestVersion: manifest && manifest.version || null,
			};
		});
	}

	async function remove(uuid) {
		if (uuid === DOCTOR_UUID) throw new Error('SELF_REMOVAL_FORBIDDEN');
		const plan = await inspect(uuid);
		const expected = `DELETE ${uuid}`;
		const typed = window.prompt(
			`即将精确删除：${plan.target.displayName || plan.target.name}\n版本：${plan.target.version || '未知'}\nUUID：${uuid}\n对象记录：${plan.objectCount}\n用户配置：${plan.userConfig ? 1 : 0}\nstandaloneScript：不会操作\n\n请输入以下确认文本：\n${expected}`,
			'',
		);
		if (typed !== expected) throw new Error('DELETE_CONFIRMATION_MISMATCH');

		await withDb(async db => {
			const current = await getRecord(db, STORE_INDEX, uuid);
			const identity = summary(current, db.name);
			if (!current || identity.uuid !== uuid || identity.name !== plan.target.name) {
				throw new Error('EXTENSION_CHANGED_BEFORE_DELETE');
			}
			const keys = await collectObjectKeys(db, uuid);
			const tx = db.transaction([STORE_INDEX, STORE_OBJECTS, STORE_CONFIG], 'readwrite');
			const done = transactionToPromise(tx);
			tx.objectStore(STORE_INDEX).delete(uuid);
			tx.objectStore(STORE_CONFIG).delete(uuid);
			const objectStore = tx.objectStore(STORE_OBJECTS);
			for (const key of keys) objectStore.delete(key);
			await done;
		});

		const verify = await withDb(async db => ({
			index: await getRecord(db, STORE_INDEX, uuid),
			config: await getRecord(db, STORE_CONFIG, uuid),
			objects: await collectObjectKeys(db, uuid),
		}));
		if (verify.index || verify.config || verify.objects.length) {
			throw new Error(`DELETE_VERIFY_FAILED index=${Boolean(verify.index)} config=${Boolean(verify.config)} objects=${verify.objects.length}`);
		}
		window.alert('精确删除完成，删除后验证已通过。\n\n请完全退出并重新启动嘉立创 EDA / EasyEDA Pro。');
		await renderList();
	}

	function renderRows(items) {
		return items.map(item => {
			const self = item.uuid === DOCTOR_UUID;
			return `<tr>
				<td>${esc(item.displayName || item.name || item.uuid)}${self ? ' <b>[Doctor 自身]</b>' : ''}</td>
				<td>${esc(item.version || '未知')}</td>
				<td><code>${esc(item.uuid)}</code></td>
				<td>${item.enabled === false ? '禁用' : item.enabled === true ? '启用' : '未知'}</td>
				<td>
					<button data-action="inspect" data-uuid="${esc(item.uuid)}">检查</button>
					<button class="danger" data-action="remove" data-uuid="${esc(item.uuid)}" ${self ? 'disabled' : ''}>精确卸载</button>
				</td>
			</tr>`;
		}).join('');
	}

	async function renderList() {
		try {
			const items = await listExtensions();
			contentEl.innerHTML = `<table><thead><tr><th>扩展</th><th>版本</th><th>UUID</th><th>状态</th><th>操作</th></tr></thead><tbody>${renderRows(items)}</tbody></table>`;
			contentEl.querySelectorAll('button[data-action]').forEach(button => {
				button.addEventListener('click', async () => {
					const uuid = button.dataset.uuid;
					try {
						if (button.dataset.action === 'inspect') {
							const result = await inspect(uuid);
							window.alert([
								`名称：${result.target.displayName || result.target.name}`,
								`UUID：${result.target.uuid}`,
								`索引版本：${result.target.version || '未知'}`,
								`Manifest：${result.manifestName || '无法读取'} ${result.manifestVersion || ''}`,
								`对象记录：${result.objectCount}`,
								`用户配置：${result.userConfig ? '存在' : '不存在'}`,
							].join('\n'));
						}
						else await remove(uuid);
					}
					catch (error) {
						window.alert(`操作失败：\n${readableError(error)}\n\n没有继续执行后续写操作。`);
					}
				});
			});
		}
		catch (error) {
			setStatus(`读取扩展列表失败：${readableError(error)}`, false);
		}
	}

	async function diagnostics() {
		try {
			if (!active) await discover();
			if (!active) return;
			const items = await listExtensions();
			contentEl.innerHTML = `<pre>${esc(JSON.stringify({
				context: active.label,
				database: active.name,
				version: active.version,
				stores: active.stores,
				extensionCount: items.length,
				selfUuid: DOCTOR_UUID,
				standaloneScriptPresent: active.stores.includes(STORE_STANDALONE),
			}, null, 2))}</pre>`;
		}
		catch (error) {
			setStatus(`诊断失败：${readableError(error)}`, false);
		}
	}

	document.getElementById('scan').addEventListener('click', renderList);
	document.getElementById('diagnostics').addEventListener('click', diagnostics);
	document.getElementById('refresh').addEventListener('click', async () => {
		await discover();
		if (active) await renderList();
	});

	(async () => {
		await discover();
		if (active) await renderList();
	})();
})();
