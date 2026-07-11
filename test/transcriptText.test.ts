import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranscriptText } from "../src/client/components/TranscriptText.js";

describe("transcript text", () => {
	it("wraps prose while keeping fenced code horizontally scrollable", () => {
		const markup = renderToStaticMarkup(
			createElement(TranscriptText, {
				text: "Intro\n```ts\nconst longValue = 123456789;\n```\nOutro",
				wrapContent: true,
			}),
		);

		expect(markup).toContain("whitespace-pre-wrap break-words");
		expect(markup).toContain("thread-code-scroll");
		expect(markup).toContain(
			"overflow-x-auto overflow-y-hidden whitespace-pre",
		);
		expect(markup).toContain('data-code-language="ts"');
		expect(markup).toContain("```ts");
		expect(markup).toContain("select-text");
	});

	it("renders unfinished fenced code in the same stable scroll region", () => {
		const markup = renderToStaticMarkup(
			createElement(TranscriptText, {
				text: "```js\nconst longValue = 123456789",
				wrapContent: true,
			}),
		);

		expect(markup).toContain("thread-code-scroll");
		expect(markup).toContain("```js");
		expect(markup).toContain("const longValue = 123456789");
		expect(markup).not.toContain("whitespace-pre-wrap break-words");
	});

	it("preserves the no-wrap preference for prose", () => {
		const markup = renderToStaticMarkup(
			createElement(TranscriptText, {
				text: "A long plain-text line",
				wrapContent: false,
			}),
		);

		expect(markup).toContain("overflow-x-auto whitespace-pre");
	});
});
