import type { PiZenUISettings } from "./settings.ts";
import { truncateToWidth, visibleWidth } from "./prompt.ts";

export interface FooterValues {
	branch?: string;
	cwd: string;
	context?: string;
}

export function resolveSessionTitle(
	settings: PiZenUISettings,
	explicitTitle: string | undefined,
	cwdName: string,
): string {
	if (!settings.showSessionTitle) return "";
	return explicitTitle ?? (settings.useCwdAsSessionTitle ? cwdName : "");
}

/** Compose branch/cwd on the left and context on the right without orphan separators. */
export function composeFooterRow(
	settings: PiZenUISettings,
	values: FooterValues,
	width: number,
	separator: string,
): string {
	if (width <= 0) return "";
	const left = [
		settings.showGitBranch ? values.branch : undefined,
		settings.showCurrentDirectory ? values.cwd : undefined,
	].filter((value): value is string => value !== undefined && value !== "");
	const context =
		settings.showContextUsage && values.context ? values.context : undefined;

	if (left.length === 0 && context === undefined) return "";
	if (context === undefined) {
		return truncateToWidth(left.join(separator), width, "…");
	}
	if (left.length === 0) {
		const shown = truncateToWidth(context, width, "…");
		return " ".repeat(Math.max(0, width - visibleWidth(shown))) + shown;
	}

	const rightWidth = visibleWidth(context);
	const separatorWidth = visibleWidth(separator);
	if (rightWidth >= width || rightWidth + separatorWidth >= width) {
		const shown = truncateToWidth(context, width, "…");
		return " ".repeat(Math.max(0, width - visibleWidth(shown))) + shown;
	}

	const leftText = truncateToWidth(
		left.join(separator),
		width - rightWidth - separatorWidth,
		"…",
	);
	if (leftText === "") {
		return " ".repeat(width - rightWidth) + context;
	}
	const gap = Math.max(
		0,
		width -
			visibleWidth(leftText) -
			separatorWidth -
			visibleWidth(context),
	);
	return leftText + " ".repeat(gap) + separator + context;
}
