import { memo, useMemo } from "react";
import { cn } from "../designSystem.js";
import { getMarkdownSegments } from "../markdownSegments.js";

export const TranscriptText = memo(function TranscriptText({
	text,
	wrapContent,
	className,
}: {
	text: string;
	wrapContent: boolean;
	className?: string;
}) {
	const segments = useMemo(() => getMarkdownSegments(text), [text]);

	return (
		<div className={cn("min-w-0 max-w-full select-text", className)}>
			{segments.map((segment) =>
				segment.kind === "code" ? (
					<div
						key={segment.key}
						className="thread-code-scroll min-h-[1lh] min-w-0 max-w-full overflow-x-auto overflow-y-hidden whitespace-pre font-mono"
						data-code-language={segment.language ?? undefined}
					>
						{segment.text}
					</div>
				) : (
					<div
						key={segment.key}
						className={
							wrapContent
								? "whitespace-pre-wrap break-words"
								: "overflow-x-auto whitespace-pre"
						}
					>
						{segment.text}
					</div>
				),
			)}
		</div>
	);
});
