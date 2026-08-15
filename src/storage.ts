export const DOCTOR_UUID = '4350c76638924d56a704e7c1906ba0c1';

const STORE_INDEX = 'extensionsIndex';
const STORE_OBJECTS = 'extensionsObjectStorage';
const STORE_CONFIG = 'extensionsUserConfig';
const STORE_STANDALONE_SCRIPT = 'standaloneScript';
const REQUIRED_STORES = [STORE_INDEX, STORE_OBJECTS, STORE_CONFIG] as const;

export interface ExtensionSummary {
	database: string;
	uuid: string;
	name: string;
	displayName: string;
	version: string;
	enabled: boolean | null;
	allowExternalInteractions: boolean | null;
	installationTime: unknown;
	fileSize: number | null;
}

export interface StorageDiagnostics {
	database: string;
	databaseVersion: number | undefined;
	stores: string[];
	extensionCount: number;
	selfRecordPresent: boolean;
	standaloneScriptPresent: boolean;
}

export interface ExtensionInspection {
	target: ExtensionSummary;
	objectRecordCount: number;
	manifestVersion: string | null;
	manifestName: string | null;
	userConfigPresent: boolean;
	versionMismatch: boolean;
}

export interface RemovalPlan extends ExtensionInspection {
	deleteIndexRecords: 1;
	deleteObjectRecords: number;
	deleteUserConfigRecords: 0 | 1;
	standaloneScriptWillBeTouched: false;
}

export interface RemovalResult {
	removed: true;
	target: ExtensionSummary;
	removedIndexRecords: 1;
	removedObjectRecords: number;
	removedUserConfigRecords: 0 | 1;
	standaloneScriptTouched: false;
	remainingObjectRecords: 0;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
		transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
	});
}

function openDatabase(name: string): Promise<IDBDatabase> {
	return requestToPromise(indexedDB.open(name));
}

function normalizeText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extensionSummaryFromIndex(database: string, rawValue: unknown): ExtensionSummary {
	const record = readObject(rawValue);
	const config = readObject(record.config);
	return {
		database,
		uuid: normalizeText(record.uuid) || normalizeText(config.uuid),
		name: normalizeText(config.name) || normalizeText(record.name),
		displayName: normalizeText(config.displayName) || normalizeText(record.displayName),
		version: normalizeText(config.version) || normalizeText(record.version),
		enabled: readBoolean(record.isEnable),
		allowExternalInteractions: readBoolean(record.isAllowExternalInteractions),
		installationTime: record.installationTime ?? null,
		fileSize: readNumber(record.fileSize),
	};
}

async function getExactRecord(database: IDBDatabase, storeName: string, key: IDBValidKey): Promise<unknown> {
	const transaction = database.transaction(storeName, 'readonly');
	return requestToPromise(transaction.objectStore(storeName).get(key));
}

async function getAllRecords(database: IDBDatabase, storeName: string): Promise<unknown[]> {
	const transaction = database.transaction(storeName, 'readonly');
	return requestToPromise(transaction.objectStore(storeName).getAll());
}

async function collectObjectKeys(database: IDBDatabase, uuid: string): Promise<IDBValidKey[]> {
	const transaction = database.transaction(STORE_OBJECTS, 'readonly');
	const store = transaction.objectStore(STORE_OBJECTS);
	const keys: IDBValidKey[] = [];

	await new Promise<void>((resolve, reject) => {
		const request = store.openKeyCursor();
		request.onsuccess = event => {
			const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
			if (!cursor) {
				resolve();
				return;
			}
			const key = String(cursor.key);
			if (key === uuid || key.startsWith(`${uuid}|`)) {
				keys.push(cursor.key);
			}
			cursor.continue();
		};
		request.onerror = () => reject(request.error ?? new Error('Cannot enumerate extension object keys'));
	});

	return keys;
}

async function parseManifestRecord(record: unknown): Promise<{ name: string | null; version: string | null }> {
	const value = readObject(record);
	const source = value.source;
	if (!(source instanceof Blob)) {
		return { name: null, version: null };
	}

	try {
		const parsed = JSON.parse(await source.text()) as unknown;
		const manifest = readObject(parsed);
		return {
			name: normalizeText(manifest.name) || null,
			version: normalizeText(manifest.version) || null,
		};
	}
	catch {
		return { name: null, version: null };
	}
}

/**
 * 自动发现扩展数据库，但不会仅凭数据库名猜测当前用户数据库。
 * destructive 操作要求数据库内存在 Doctor 自身 UUID，以此绑定当前活动扩展存储。
 */
async function resolveActiveDatabase(): Promise<{ database: IDBDatabase; version: number | undefined }> {
	if (typeof indexedDB.databases !== 'function') {
		throw new Error('STORAGE_DISCOVERY_UNAVAILABLE: 当前运行时不支持 indexedDB.databases()');
	}

	const descriptors = await indexedDB.databases();
	const schemaCandidates: Array<{ name: string; version: number | undefined }> = [];

	for (const descriptor of descriptors) {
		if (!descriptor.name) continue;
		let database: IDBDatabase | undefined;
		try {
			database = await openDatabase(descriptor.name);
			const stores = Array.from(database.objectStoreNames);
			if (REQUIRED_STORES.every(storeName => stores.includes(storeName))) {
				schemaCandidates.push({ name: descriptor.name, version: descriptor.version });
			}
		}
		finally {
			database?.close();
		}
	}

	const activeCandidates: Array<{ name: string; version: number | undefined }> = [];
	for (const candidate of schemaCandidates) {
		const database = await openDatabase(candidate.name);
		try {
			const selfRecord = await getExactRecord(database, STORE_INDEX, DOCTOR_UUID);
			if (selfRecord) activeCandidates.push(candidate);
		}
		finally {
			database.close();
		}
	}

	if (activeCandidates.length !== 1) {
		throw new Error(`STORAGE_IDENTITY_UNRESOLVED: schema=${schemaCandidates.length}, self=${activeCandidates.length}`);
	}

	return {
		database: await openDatabase(activeCandidates[0].name),
		version: activeCandidates[0].version,
	};
}

export async function listInstalledExtensions(): Promise<ExtensionSummary[]> {
	const active = await resolveActiveDatabase();
	try {
		const records = await getAllRecords(active.database, STORE_INDEX);
		return records
			.map(record => extensionSummaryFromIndex(active.database.name, record))
			.filter(extension => extension.uuid.length > 0)
			.sort((left, right) => (left.displayName || left.name).localeCompare(right.displayName || right.name));
	}
	finally {
		active.database.close();
	}
}

export async function getStorageDiagnostics(): Promise<StorageDiagnostics> {
	const active = await resolveActiveDatabase();
	try {
		const extensions = await getAllRecords(active.database, STORE_INDEX);
		const selfRecord = await getExactRecord(active.database, STORE_INDEX, DOCTOR_UUID);
		const stores = Array.from(active.database.objectStoreNames);
		return {
			database: active.database.name,
			databaseVersion: active.version,
			stores,
			extensionCount: extensions.length,
			selfRecordPresent: Boolean(selfRecord),
			standaloneScriptPresent: stores.includes(STORE_STANDALONE_SCRIPT),
		};
	}
	finally {
		active.database.close();
	}
}

export async function inspectExtensionByUuid(uuid: string): Promise<ExtensionInspection> {
	const active = await resolveActiveDatabase();
	try {
		const indexRecord = await getExactRecord(active.database, STORE_INDEX, uuid);
		if (!indexRecord) throw new Error(`EXTENSION_NOT_FOUND: ${uuid}`);
		const target = extensionSummaryFromIndex(active.database.name, indexRecord);
		if (target.uuid !== uuid) throw new Error('EXTENSION_IDENTITY_MISMATCH');

		const objectKeys = await collectObjectKeys(active.database, uuid);
		const userConfig = await getExactRecord(active.database, STORE_CONFIG, uuid);
		const manifestRecord = await getExactRecord(active.database, STORE_OBJECTS, `${uuid}|extension.json`);
		const manifest = await parseManifestRecord(manifestRecord);

		return {
			target,
			objectRecordCount: objectKeys.length,
			manifestVersion: manifest.version,
			manifestName: manifest.name,
			userConfigPresent: Boolean(userConfig),
			versionMismatch: Boolean(manifest.version && target.version && manifest.version !== target.version),
		};
	}
	finally {
		active.database.close();
	}
}

export async function planExtensionRemoval(uuid: string): Promise<RemovalPlan> {
	if (uuid === DOCTOR_UUID) throw new Error('SELF_REMOVAL_FORBIDDEN');
	const inspection = await inspectExtensionByUuid(uuid);
	return {
		...inspection,
		deleteIndexRecords: 1,
		deleteObjectRecords: inspection.objectRecordCount,
		deleteUserConfigRecords: inspection.userConfigPresent ? 1 : 0,
		standaloneScriptWillBeTouched: false,
	};
}

export async function removeExtensionByUuid(uuid: string): Promise<RemovalResult> {
	if (uuid === DOCTOR_UUID) throw new Error('SELF_REMOVAL_FORBIDDEN');

	const plan = await planExtensionRemoval(uuid);
	const active = await resolveActiveDatabase();
	try {
		const currentIndexRecord = await getExactRecord(active.database, STORE_INDEX, uuid);
		if (!currentIndexRecord) throw new Error('EXTENSION_DISAPPEARED_BEFORE_DELETE');
		const currentIdentity = extensionSummaryFromIndex(active.database.name, currentIndexRecord);
		if (currentIdentity.uuid !== plan.target.uuid || currentIdentity.name !== plan.target.name) {
			throw new Error('EXTENSION_CHANGED_BEFORE_DELETE');
		}

		const objectKeys = await collectObjectKeys(active.database, uuid);
		const transaction = active.database.transaction([STORE_INDEX, STORE_OBJECTS, STORE_CONFIG], 'readwrite');
		const completed = transactionToPromise(transaction);
		transaction.objectStore(STORE_INDEX).delete(uuid);
		transaction.objectStore(STORE_CONFIG).delete(uuid);
		const objectStore = transaction.objectStore(STORE_OBJECTS);
		for (const key of objectKeys) objectStore.delete(key);
		await completed;
	}
	finally {
		active.database.close();
	}

	const verify = await resolveActiveDatabase();
	try {
		const indexRecord = await getExactRecord(verify.database, STORE_INDEX, uuid);
		const userConfig = await getExactRecord(verify.database, STORE_CONFIG, uuid);
		const remainingObjects = await collectObjectKeys(verify.database, uuid);
		if (indexRecord || userConfig || remainingObjects.length !== 0) {
			throw new Error(`DELETE_VERIFY_FAILED: index=${Boolean(indexRecord)}, config=${Boolean(userConfig)}, objects=${remainingObjects.length}`);
		}
	}
	finally {
		verify.database.close();
	}

	return {
		removed: true,
		target: plan.target,
		removedIndexRecords: 1,
		removedObjectRecords: plan.deleteObjectRecords,
		removedUserConfigRecords: plan.deleteUserConfigRecords,
		standaloneScriptTouched: false,
		remainingObjectRecords: 0,
	};
}
