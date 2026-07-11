export type MarkdownTextSegment = {
	kind: "text";
	key: string;
	text: string;
};

export type MarkdownCodeSegment = {
	kind: "code";
	key: string;
	text: string;
	language: string | null;
};

export type MarkdownSegment = MarkdownTextSegment | MarkdownCodeSegment;

type Fence = {
	character: "`" | "~";
	length: number;
	language: string | null;
};

function lineContent(text: string, start: number, end: number) {
	const withoutNewline = text.endsWith("\n", end)
		? text.slice(start, end - 1)
		: text.slice(start, end);
	return withoutNewline.endsWith("\r")
		? withoutNewline.slice(0, -1)
		: withoutNewline;
}

function openingFence(line: string): Fence | null {
	const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
	if (!match) {
		return null;
	}

	const marker = match[2];
	const info = match[3].trim();
	if (marker[0] === "`" && info.includes("`")) {
		return null;
	}

	return {
		character: marker[0] as Fence["character"],
		length: marker.length,
		language: info.split(/\s+/, 1)[0] || null,
	};
}

function isClosingFence(line: string, fence: Fence) {
	const match = /^( {0,3})(`+|~+)[ \t]*$/.exec(line);
	return Boolean(
		match && match[2][0] === fence.character && match[2].length >= fence.length,
	);
}

function nextLineEnd(text: string, start: number) {
	const newline = text.indexOf("\n", start);
	return newline === -1 ? text.length : newline + 1;
}

export function getMarkdownSegments(text: string): MarkdownSegment[] {
	const segments: MarkdownSegment[] = [];
	let plainTextStart = 0;
	let lineStart = 0;

	while (lineStart < text.length) {
		const lineEnd = nextLineEnd(text, lineStart);
		const fence = openingFence(lineContent(text, lineStart, lineEnd));
		if (!fence) {
			lineStart = lineEnd;
			continue;
		}

		if (plainTextStart < lineStart) {
			segments.push({
				kind: "text",
				key: `text:${plainTextStart}`,
				text: text.slice(plainTextStart, lineStart),
			});
		}

		const codeStart = lineStart;
		let codeEnd = text.length;
		let nextPlainTextStart = text.length;
		let closingLineStart = lineEnd;
		while (closingLineStart < text.length) {
			const closingLineEnd = nextLineEnd(text, closingLineStart);
			if (
				isClosingFence(
					lineContent(text, closingLineStart, closingLineEnd),
					fence,
				)
			) {
				codeEnd = closingLineEnd;
				nextPlainTextStart = closingLineEnd;
				break;
			}
			closingLineStart = closingLineEnd;
		}

		segments.push({
			kind: "code",
			key: `code:${lineStart}`,
			text: text.slice(codeStart, codeEnd),
			language: fence.language,
		});
		plainTextStart = nextPlainTextStart;
		lineStart = nextPlainTextStart;
	}

	if (plainTextStart < text.length) {
		segments.push({
			kind: "text",
			key: `text:${plainTextStart}`,
			text: text.slice(plainTextStart),
		});
	}

	return segments;
}
