export function getFirstLineTextPreview(value: string, maxLength = 180) {
	const firstLine =
		value
			.split(/\r?\n|\r/, 1)[0]
			?.trim()
			.replace(/\s+/g, " ") ?? "";
	if (firstLine.length <= maxLength) {
		return firstLine;
	}
	return `${firstLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
