import type { ReactNode, RefObject } from "react";
import { memo, useId, useRef } from "react";
import { cn } from "../designSystem.js";
import {
	type FloatingScrollAnchor,
	MobileFloatingScroller,
} from "./MobileFloatingScroller.js";

type ScrollFadeTone = "app" | "panel" | "terminal";
type ScrollFadeSize = "regular" | "short" | "tall";

type ScrollFadeConfig =
	| false
	| {
			tone?: ScrollFadeTone;
			top?: boolean | ScrollFadeSize;
			bottom?: boolean | ScrollFadeSize;
	  };

type FloatingScrollerConfig =
	| false
	| {
			anchors?: FloatingScrollAnchor[];
			className?: string;
			contentRightInset?: string;
			size?: "default" | "compact";
			visibility?: "mobile" | "always";
	  };

export type ScrollAreaProps = {
	children: ReactNode;
	className?: string;
	edgeFades?: ScrollFadeConfig;
	floatingScroller?: FloatingScrollerConfig;
	id?: string;
	outerClassName?: string;
	scrollRef?: RefObject<HTMLDivElement | null>;
};

const defaultScrollClassName =
	"custom-scroll-host mobile-custom-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto";

function fadeSizeClass(size: ScrollFadeSize) {
	return size === "short"
		? "chrome-edge-fade-short"
		: size === "tall"
			? "chrome-edge-fade-tall"
			: null;
}

function fadeClassName({
	position,
	size,
	tone,
}: {
	position: "top" | "bottom";
	size: ScrollFadeSize;
	tone: ScrollFadeTone;
}) {
	return cn(
		"chrome-edge-fade",
		fadeSizeClass(size),
		tone === "app"
			? "chrome-edge-fade-app"
			: tone === "terminal"
				? "chrome-edge-fade-terminal"
				: "chrome-edge-fade-panel",
		position === "top" ? "chrome-edge-fade-top" : "chrome-edge-fade-bottom",
	);
}

function resolvedFade(value: boolean | ScrollFadeSize | undefined) {
	if (value === false) {
		return null;
	}
	return value === true || value === undefined ? "regular" : value;
}

export const ScrollArea = memo(function ScrollArea({
	children,
	className,
	edgeFades = false,
	floatingScroller = false,
	id,
	outerClassName,
	scrollRef,
}: ScrollAreaProps) {
	const generatedId = useId();
	const internalScrollRef = useRef<HTMLDivElement | null>(null);
	const activeScrollRef = scrollRef ?? internalScrollRef;
	const scrollElementId = id ?? generatedId;
	const fadeTone = edgeFades ? (edgeFades.tone ?? "panel") : "panel";
	const topFade = edgeFades ? resolvedFade(edgeFades.top) : null;
	const bottomFade = edgeFades ? resolvedFade(edgeFades.bottom) : null;

	return (
		<div className={cn("relative min-h-0", outerClassName)}>
			<div
				id={scrollElementId}
				ref={activeScrollRef}
				className={cn(defaultScrollClassName, className)}
			>
				{children}
			</div>
			{topFade ? (
				<div
					className={fadeClassName({
						position: "top",
						size: topFade,
						tone: fadeTone,
					})}
				/>
			) : null}
			{bottomFade ? (
				<div
					className={fadeClassName({
						position: "bottom",
						size: bottomFade,
						tone: fadeTone,
					})}
				/>
			) : null}
			{floatingScroller ? (
				<MobileFloatingScroller
					scrollRef={activeScrollRef}
					scrollElementId={scrollElementId}
					anchors={floatingScroller.anchors}
					className={floatingScroller.className}
					contentRightInset={floatingScroller.contentRightInset}
					size={floatingScroller.size}
					visibility={floatingScroller.visibility}
				/>
			) : null}
		</div>
	);
});
