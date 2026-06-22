/**
 * Copies text to the system clipboard.
 *
 * Tries the modern async Clipboard API first, then falls back to the older
 * `document.execCommand("copy")` approach (required for some mobile browsers
 * and non-HTTPS origins).  Returns `true` when the copy was successful.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	// Modern async Clipboard API works in secure contexts.
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Clipboard API may reject (e.g. missing permission or not called from
			// a user gesture on some browsers). Fall through to execCommand.
		}
	}

	// Fallback for older or restricted environments (e.g. mobile WebViews,
	// HTTP origins, or browsers without the async API).
	if (typeof document === "undefined" || !document.body) {
		return false;
	}

	let textarea: HTMLTextAreaElement | null = null;
	try {
		textarea = document.createElement("textarea");
		textarea.value = text;
		// Make the textarea invisible but keep it in the layout so execCommand
		// can select its contents.
		textarea.setAttribute("readonly", "");
		textarea.style.position = "fixed";
		textarea.style.left = "-9999px";
		textarea.style.top = "0";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		textarea?.remove();
	}
}
