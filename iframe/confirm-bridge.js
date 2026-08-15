(() => {
	'use strict';

	const UUID_PATTERN = '[0-9a-fA-F]{32}';
	const DELETE_RE = new RegExp(`^DELETE ${UUID_PATTERN}$`);
	const ORPHAN_RE = new RegExp(`^CLEAN ORPHAN ${UUID_PATTERN}$`);
	const nativePrompt = typeof window.prompt === 'function' ? window.prompt.bind(window) : null;
	const nativeAlert = typeof window.alert === 'function' ? window.alert.bind(window) : null;

	/**
	 * EasyEDA / JLCEDA 的 iframe 中原生 prompt 输入框兼容性不稳定。
	 * Doctor 的删除函数仍保留“精确确认文本”这一安全门，但把交互层改为
	 * 一个兼容性更好的 confirm 对话框：只有 Doctor 自己生成的 DELETE/CLEAN ORPHAN
	 * 确认消息会被接管，其余 prompt 调用仍回退到浏览器原实现。
	 */
	function extractExpectedToken(message) {
		const lines = String(message ?? '')
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean);

		for (let index = lines.length - 1; index >= 0; index -= 1) {
			const line = lines[index];
			if (DELETE_RE.test(line) || ORPHAN_RE.test(line)) return line;
		}
		return null;
	}

	function doctorPrompt(message, defaultValue) {
		const expected = extractExpectedToken(message);
		if (!expected) {
			if (!nativePrompt) throw new Error('NATIVE_PROMPT_UNAVAILABLE');
			return nativePrompt(message, defaultValue);
		}

		if (typeof window.confirm !== 'function') {
			throw new Error('DELETE_CONFIRM_DIALOG_UNAVAILABLE');
		}

		const confirmed = window.confirm(
			`${String(message)}\n\n点击“确定”表示你确认以上目标、UUID 和记录范围。\n取消不会执行任何写操作。`,
		);
		if (!confirmed) throw new Error('DELETE_CONFIRMATION_CANCELLED');

		// 返回 Doctor 原逻辑所要求的精确 token，随后仍会继续执行身份复核。
		return expected;
	}

	/**
	 * Doctor 删除的是 IndexedDB 持久化记录，而 EasyEDA/JLCEDA 当前会话已经在内存中
	 * 加载了扩展索引、菜单和运行实例。公开扩展 API 没有“热卸载任意扩展”的接口，
	 * 因此删除成功后当前会话仍可能显示目标扩展；完全退出并重新启动后才会消失。
	 * 这里仅修正成功提示，不尝试篡改编辑器内部内存状态。
	 */
	function doctorAlert(message) {
		if (!nativeAlert) throw new Error('NATIVE_ALERT_UNAVAILABLE');
		const text = String(message ?? '');
		const isDeleteSuccess = text.includes('精确删除完成，删除后验证已通过');
		const isOrphanSuccess = text.includes('孤儿扩展残留清理完成，删除后验证已通过');
		if (!isDeleteSuccess && !isOrphanSuccess) return nativeAlert(message);

		return nativeAlert(
			`${text}\n\n注意：持久化记录已经删除并验证通过，但 EDA 当前会话仍可能保留扩展列表、菜单或运行实例的内存缓存。\n这不表示删除失败。请完全退出嘉立创 EDA / EasyEDA Pro 后重新启动，目标扩展才会从编辑器界面中消失。`,
		);
	}

	Object.defineProperty(window, 'prompt', {
		value: doctorPrompt,
		writable: false,
		configurable: true,
	});

	Object.defineProperty(window, 'alert', {
		value: doctorAlert,
		writable: false,
		configurable: true,
	});

	Object.defineProperty(window, '__EDA_EXTENSION_DOCTOR_CONFIRM_BRIDGE__', {
		value: Object.freeze({ version: '1.1.0', mode: 'confirm-compat+restart-notice' }),
		writable: false,
		configurable: true,
	});
})();
