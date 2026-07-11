import { describe, expect, it } from "vitest";
import { getMarkdownSegments } from "../src/client/markdownSegments.js";

describe("markdown segments", () => {
	function expectSourceTextPreserved(source: string) {
		expect(
			getMarkdownSegments(source)
				.map((segment) => segment.text)
				.join(""),
		).toBe(source);
	}

	it("keeps ordinary text in a single segment", () => {
		expect(getMarkdownSegments("Hello\nworld")).toEqual([
			{ kind: "text", key: "text:0", text: "Hello\nworld" },
		]);
	});

	it("keeps fenced code markers and language info in the displayed text", () => {
		expect(
			getMarkdownSegments(
				"Before\n```ts\nconst value = 'a very long line';\n```\nAfter",
			),
		).toEqual([
			{ kind: "text", key: "text:0", text: "Before\n" },
			{
				kind: "code",
				key: "code:7",
				text: "```ts\nconst value = 'a very long line';\n```\n",
				language: "ts",
			},
			{ kind: "text", key: "text:51", text: "After" },
		]);
	});

	it("supports tilde fences and longer matching closing fences", () => {
		expect(getMarkdownSegments("~~~ sh\necho hello\n~~~~\n")).toEqual([
			{
				kind: "code",
				key: "code:0",
				text: "~~~ sh\necho hello\n~~~~\n",
				language: "sh",
			},
		]);
	});

	it("handles CRLF text and multiple fenced regions", () => {
		const segments = getMarkdownSegments(
			"First\r\n```\r\none\r\n```\r\nMiddle\r\n~~~txt\r\ntwo\r\n~~~\r\nLast",
		);

		expect(segments.map((segment) => segment.kind)).toEqual([
			"text",
			"code",
			"text",
			"code",
			"text",
		]);
		expect(segments.filter((segment) => segment.kind === "code")).toEqual([
			expect.objectContaining({
				text: "```\r\none\r\n```\r\n",
				language: null,
			}),
			expect.objectContaining({
				text: "~~~txt\r\ntwo\r\n~~~\r\n",
				language: "txt",
			}),
		]);
	});

	it("treats an unfinished fence as code through the current end", () => {
		const initial = getMarkdownSegments("Answer\n```ts\nconst longValue = 1");
		const continued = getMarkdownSegments(
			"Answer\n```ts\nconst longValue = 123456789",
		);

		expect(initial[1]).toMatchObject({
			kind: "code",
			key: "code:7",
			text: "```ts\nconst longValue = 1",
		});
		expect(continued[1]).toMatchObject({
			kind: "code",
			key: "code:7",
			text: "```ts\nconst longValue = 123456789",
		});
	});

	it("keeps the code key stable when the closing fence arrives", () => {
		const unfinished = getMarkdownSegments("```\nconst value = 1;\n");
		const finished = getMarkdownSegments(
			"```\nconst value = 1;\n```\nFollowing text",
		);

		expect(unfinished[0]?.key).toBe("code:0");
		expect(finished[0]?.key).toBe("code:0");
		expect(finished[1]).toMatchObject({
			kind: "text",
			text: "Following text",
		});
	});

	it("preserves the exact source text across segment boundaries", () => {
		expectSourceTextPreserved("Before\n```ts\nconst value = 1;\n```\nAfter");
		expectSourceTextPreserved("```js\nconst unfinished = true");
		expectSourceTextPreserved(
			"First\r\n~~~txt\r\none\r\n~~~\r\nMiddle\r\n```\r\ntwo\r\n```\r\nLast",
		);
	});
});
