import {
	DOCTOR_UUID,
	getStorageDiagnostics,
	inspectExtensionByUuid,
	listInstalledExtensions as scanInstalledExtensions,
	planExtensionRemoval,
	removeExtensionByUuid,
	type ExtensionSummary,
} from './storage';

const TOOL_NAME = 'EDA Extension Doctor';
const TOOL_VERSION = '0.1.0';

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function showError(action: string, error: unknown): void {
	console.error(`[${TOOL_NAME}] ${action}`, error);
	eda.sys_Dialog.showInformationMessage(
		`${action}失败。\n\n${formatError(error)}\n\n为防止误删，本工具已停止当前操作。`,
		TOOL_NAME,
		'确定',
	);
}

function extensionLabel(extension: ExtensionSummary): string {
	const name = extension.displayName || extension.name || extension.uuid;
	const version = extension.version ? ` v${extension.version}` : '';
	const disabled = extension.enabled === false ? ' [已禁用]' : '';
	return `${name}${version}${disabled} | ${extension.uuid}`;
}

function selectExtension(
	extensions: ExtensionSummary[],
	title: string,
	beforeContent: string,
	callback: (uuid: string) => void | Promise<void>,
): void {
	if (extensions.length === 0) {
		eda.sys_Dialog.showInformationMessage('没有可选择的扩展。', title, '确定');
		return;
	}

	const options = extensions.map(extension => ({
		value: extension.uuid,
		displayContent: extensionLabel(extension),
	}));

	eda.sys_Dialog.showSelectDialog(
		options,
		beforeContent,
		'选择后仍不会立即删除；卸载操作还有独立的删除计划与二次确认。',
		title,
		undefined,
		false,
		async value => {
			if (!value) return;
			await callback(value);
		},
	);
}

/** 扩展生命周期不主动修改任何存储；所有写操作只能从显式“精确卸载扩展”菜单进入。 */
export function activate(): void {
	console.info(`[${TOOL_NAME}] ${TOOL_VERSION} activated, uuid=${DOCTOR_UUID}`);
}

export function deactivate(): void {
	console.info(`[${TOOL_NAME}] deactivated`);
}

/** 扫描并展示当前活动用户扩展数据库中的扩展索引。该动作严格只读。 */
export async function listInstalledExtensions(): Promise<void> {
	try {
		const extensions = await scanInstalledExtensions();
		const lines = extensions.map((extension, index) =>
			`${index + 1}. ${extensionLabel(extension)}\n   外部交互=${extension.allowExternalInteractions ?? '未知'}  文件大小=${extension.fileSize ?? '未知'}`,
		);
		eda.sys_Dialog.showInformationMessage(
			`已识别 ${extensions.length} 个已安装扩展。\n\n${lines.join('\n\n') || '无扩展记录'}`,
			`${TOOL_NAME} - 已安装扩展`,
			'关闭',
		);
	}
	catch (error) {
		showError('扫描已安装扩展', error);
	}
}

/** 选择一个扩展并检查 index / manifest / object storage / user config 的一致性。 */
export async function inspectExtension(): Promise<void> {
	try {
		const extensions = await scanInstalledExtensions();
		selectExtension(extensions, `${TOOL_NAME} - 检查扩展`, '请选择需要只读检查的扩展：', async uuid => {
			try {
				const inspection = await inspectExtensionByUuid(uuid);
				const target = inspection.target;
				eda.sys_Dialog.showInformationMessage(
					[
						`名称：${target.displayName || target.name}`,
						`内部名称：${target.name || '未知'}`,
						`UUID：${target.uuid}`,
						`索引版本：${target.version || '未知'}`,
						`Manifest 版本：${inspection.manifestVersion || '无法读取'}`,
						`Manifest 名称：${inspection.manifestName || '无法读取'}`,
						`对象记录数：${inspection.objectRecordCount}`,
						`用户配置：${inspection.userConfigPresent ? '存在' : '不存在'}`,
						`版本不一致：${inspection.versionMismatch ? '是' : '否'}`,
					].join('\n'),
					`${TOOL_NAME} - 检查结果`,
					'关闭',
				);
			}
			catch (error) {
				showError('检查扩展', error);
			}
		});
	}
	catch (error) {
		showError('读取扩展列表', error);
	}
}

/**
 * 精确卸载流程：选择目标 -> 生成只读删除计划 -> 用户二次确认 -> 单事务删除 -> 重新打开数据库验证残留为 0。
 * Doctor 自身 UUID 永远不会出现在可卸载列表中，底层 storage 层也再次禁止 self removal。
 */
export async function removeExtension(): Promise<void> {
	try {
		const extensions = (await scanInstalledExtensions()).filter(extension => extension.uuid !== DOCTOR_UUID);
		selectExtension(extensions, `${TOOL_NAME} - 精确卸载`, '请选择需要强制卸载的目标扩展：', async uuid => {
			try {
				const plan = await planExtensionRemoval(uuid);
				const targetName = plan.target.displayName || plan.target.name || plan.target.uuid;
				const warning = [
					`即将精确卸载：${targetName}`,
					`版本：${plan.target.version || '未知'}`,
					`UUID：${plan.target.uuid}`,
					'',
					`extensionsIndex：${plan.deleteIndexRecords} 条`,
					`extensionsObjectStorage：${plan.deleteObjectRecords} 条`,
					`extensionsUserConfig：${plan.deleteUserConfigRecords} 条`,
					`standaloneScript：不会操作`,
					'',
					'删除完成后必须完全退出并重新启动 EDA。',
				].join('\n');

				eda.sys_Dialog.showConfirmationMessage(
					warning,
					`${TOOL_NAME} - 最终确认`,
					'确认精确卸载',
					'取消',
					async confirmed => {
						if (!confirmed) return;
						try {
							const result = await removeExtensionByUuid(uuid);
							eda.sys_Dialog.showInformationMessage(
								[
									`${result.target.displayName || result.target.name} 已从扩展持久化存储精确删除。`,
									'',
									`Index 删除：${result.removedIndexRecords}`,
									`对象记录删除：${result.removedObjectRecords}`,
									`用户配置删除：${result.removedUserConfigRecords}`,
									`剩余对象记录：${result.remainingObjectRecords}`,
									`独立脚本被修改：${result.standaloneScriptTouched ? '是' : '否'}`,
									'',
									'请现在完全退出嘉立创 EDA / EasyEDA Pro，然后重新启动。',
								].join('\n'),
								`${TOOL_NAME} - 删除完成`,
								'确定',
							);
						}
						catch (error) {
							showError('精确卸载扩展', error);
						}
					},
				);
			}
			catch (error) {
				showError('生成删除计划', error);
			}
		});
	}
	catch (error) {
		showError('读取可卸载扩展', error);
	}
}

/** 展示当前 Doctor 所绑定的真实 IndexedDB 与 Store 结构，不进行任何写操作。 */
export async function showStorageDiagnostics(): Promise<void> {
	try {
		const diagnostics = await getStorageDiagnostics();
		eda.sys_Dialog.showInformationMessage(
			[
				`数据库：${diagnostics.database}`,
				`数据库版本：${diagnostics.databaseVersion ?? '未知'}`,
				`Store：${diagnostics.stores.join(', ')}`,
				`扩展数量：${diagnostics.extensionCount}`,
				`Doctor 自身记录：${diagnostics.selfRecordPresent ? '存在' : '不存在'}`,
				`standaloneScript Store：${diagnostics.standaloneScriptPresent ? '存在（不会修改）' : '不存在'}`,
			].join('\n'),
			`${TOOL_NAME} - 存储诊断`,
			'关闭',
		);
	}
	catch (error) {
		showError('存储诊断', error);
	}
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		[
			`${TOOL_NAME} ${TOOL_VERSION}`,
			`UUID: ${DOCTOR_UUID}`,
			'',
			'用途：诊断嘉立创 EDA / EasyEDA Pro 扩展持久化存储，并在普通卸载失效时精确清理指定扩展。',
			'',
			'安全边界：',
			'- 不写死用户数据库名；',
			'- 必须通过 Doctor 自身 UUID 锁定活动数据库；',
			'- 默认扫描/检查均只读；',
			'- 禁止删除 Doctor 自身；',
			'- 不操作 standaloneScript；',
			'- 删除后必须验证目标残留为 0。',
		].join('\n'),
		TOOL_NAME,
		'关闭',
	);
}
