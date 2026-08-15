const TOOL_NAME = 'EDA Extension Doctor';
const TOOL_VERSION = '0.2.3';
const IFRAME_ID = 'eda-extension-doctor-main';

/**
 * 扩展主线程受到嘉立创 EDA 的浏览器 API 沙箱限制，不能直接访问 IndexedDB。
 * 因此主线程只承担官方扩展 API 的窗口管理职责；真正的浏览器存储探测与维护
 * 固定放在扩展包内的 iframe 页面执行。iframe 页面仍会自行验证 Doctor UUID、
 * Store schema 与目标 UUID，验证失败时 fail-closed。
 */
async function openDoctorWindow(): Promise<void> {
	try {
		const opened = await eda.sys_IFrame.openIFrame(
			'/iframe/index.html',
			920,
			680,
			IFRAME_ID,
			{
				title: TOOL_NAME,
				maximizeButton: true,
				minimizeButton: false,
				grayscaleMask: false,
			},
		);
		if (!opened) throw new Error('SYS_IFrame.openIFrame() 返回 false');
	}
	catch (error) {
		console.error(`[${TOOL_NAME}] open iframe failed`, error);
		eda.sys_Dialog.showInformationMessage(
			`无法打开维护窗口。\n\n${error instanceof Error ? error.message : String(error)}\n\n当前操作未修改任何扩展数据。`,
			TOOL_NAME,
			'确定',
		);
	}
}

export function activate(): void {
	console.info(`[${TOOL_NAME}] ${TOOL_VERSION} activated`);
}

export function deactivate(): void {
	console.info(`[${TOOL_NAME}] deactivated`);
}

export async function listInstalledExtensions(): Promise<void> { await openDoctorWindow(); }
export async function inspectExtension(): Promise<void> { await openDoctorWindow(); }
export async function removeExtension(): Promise<void> { await openDoctorWindow(); }
export async function showStorageDiagnostics(): Promise<void> { await openDoctorWindow(); }

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		[
			`${TOOL_NAME} ${TOOL_VERSION}`,
			'',
			'当前版本采用 iframe 双层架构，并增加同源 IndexedDB 上下文去重：',
			'- 扩展主线程只使用官方 SYS_IFrame API；',
			'- iframe 运行脚本使用扩展包根路径 /iframe/doctor.js；',
			'- iframe / parent / top 会先读取 origin；',
			'- 同一 origin 的不同 Window 视为同一个 IndexedDB 命名空间，只探测一次；',
			'- origin 不可读取时才回退到 IDBFactory 对象身份去重；',
			'- parent 上下文优先，因为编辑器 Console 的真实存储验证来自页面上下文；',
			'- databases() / IDB open() / request / transaction 全部有超时；',
			'- 只有包含 Doctor 自身 UUID 的唯一数据库才允许删除；',
			'- Doctor 自身不可删除；',
			'- standaloneScript 永不进入写事务；',
			'- 删除后必须再次验证残留为 0。',
		].join('\n'),
		TOOL_NAME,
		'关闭',
	);
}
