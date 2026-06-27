import type { ComposerInput } from "../server/domain.js";

export type ComposerContextItem =
	| {
			id: string;
			type: "file";
			name: string;
			path: string;
	  }
	| {
			id: string;
			type: "uploaded_text";
			name: string;
			mimeType: string | null;
			text: string;
	  }
	| {
			id: string;
			type: "uploaded_image";
			name: string;
			mimeType: string;
			dataUrl: string;
	  };

export function newComposerContextId() {
	return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function contextDisplayName(item: ComposerContextItem) {
	if (item.type === "file") {
		return item.path;
	}
	return item.name;
}

function contextText(items: ComposerContextItem[]) {
	const fileItems = items.filter((item) => item.type === "file");
	const uploadedTextItems = items.filter(
		(item) => item.type === "uploaded_text",
	);
	const sections: string[] = [];

	if (fileItems.length > 0) {
		sections.push(
			[
				"Referenced files:",
				...fileItems.map((item, index) => `${index + 1}. ${item.path}`),
			].join("\n"),
		);
	}

	for (const item of uploadedTextItems) {
		const mime = item.mimeType ? `; type=${item.mimeType}` : "";
		sections.push(
			[`Uploaded file: ${item.name}${mime}`, "```", item.text, "```"].join(
				"\n",
			),
		);
	}

	return sections.join("\n\n");
}

export function buildUserInput(
	prompt: string,
	contextItems: ComposerContextItem[],
): ComposerInput {
	const items: ComposerInput = [
		{
			type: "text",
			text: prompt,
			text_elements: [],
		},
	];
	const textContext = contextText(contextItems);
	if (textContext.trim()) {
		items.push({
			type: "text",
			text: textContext,
			text_elements: [],
		});
	}
	for (const item of contextItems) {
		if (item.type === "uploaded_image") {
			items.push({
				type: "image",
				url: item.dataUrl,
				detail: "auto",
			});
		}
	}
	return items;
}

export function promptHasVisibleInput(
	prompt: string,
	contextItems: ComposerContextItem[],
) {
	return prompt.trim().length > 0 || contextItems.length > 0;
}
