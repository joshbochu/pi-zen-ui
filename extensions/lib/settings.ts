import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	DEFAULT_CUSTOM_ACCENT,
	isAccentPreset,
	normalizeHexColor,
	type AccentPreset,
} from "./palette.ts";

export const PI_GROK_BUILD_UI_SETTINGS_VERSION = 1;
export type { AccentPreset } from "./palette.ts";

export const VISIBILITY_SETTING_KEYS = [
	"showSessionTitle",
	"useCwdAsSessionTitle",
	"showModelCaption",
	"showGitBranch",
	"showCurrentDirectory",
	"showContextUsage",
	"showTurnStatus",
] as const;

export type VisibilitySettingKey = (typeof VISIBILITY_SETTING_KEYS)[number];

export interface PiGrokBuildUISettings {
	accentPreset: AccentPreset;
	customAccent: string;
	showSessionTitle: boolean;
	useCwdAsSessionTitle: boolean;
	showModelCaption: boolean;
	showGitBranch: boolean;
	showCurrentDirectory: boolean;
	showContextUsage: boolean;
	showTurnStatus: boolean;
}

export type VisibilityPreset = "default" | "minimal";

export const DEFAULT_PI_GROK_BUILD_UI_SETTINGS: Readonly<PiGrokBuildUISettings> =
	Object.freeze({
		accentPreset: "oscura",
		customAccent: DEFAULT_CUSTOM_ACCENT,
		showSessionTitle: true,
		useCwdAsSessionTitle: true,
		showModelCaption: true,
		showGitBranch: true,
		showCurrentDirectory: true,
		showContextUsage: true,
		showTurnStatus: true,
	});

export const MINIMAL_PI_GROK_BUILD_UI_SETTINGS: Readonly<PiGrokBuildUISettings> =
	Object.freeze({
		accentPreset: "oscura",
		customAccent: DEFAULT_CUSTOM_ACCENT,
		showSessionTitle: false,
		useCwdAsSessionTitle: false,
		showModelCaption: false,
		showGitBranch: false,
		showCurrentDirectory: false,
		showContextUsage: false,
		showTurnStatus: false,
	});

interface PiGrokBuildUISettingsFile {
	version: typeof PI_GROK_BUILD_UI_SETTINGS_VERSION;
	settings: PiGrokBuildUISettings;
}

function defaults(): PiGrokBuildUISettings {
	return { ...DEFAULT_PI_GROK_BUILD_UI_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep known, valid fields from a partial value and default everything else. */
export function normalizePiGrokBuildUISettings(
	value: unknown,
): PiGrokBuildUISettings {
	const normalized = defaults();
	if (!isRecord(value)) return normalized;
	if (isAccentPreset(value.accentPreset)) {
		normalized.accentPreset = value.accentPreset;
	}
	const customAccent = normalizeHexColor(value.customAccent);
	if (customAccent) normalized.customAccent = customAccent;
	for (const key of VISIBILITY_SETTING_KEYS) {
		if (typeof value[key] === "boolean") normalized[key] = value[key];
	}
	return normalized;
}

/** Apply a visibility preset without discarding the selected accent. */
export function applyVisibilityPreset(
	preset: VisibilityPreset,
	current: Readonly<PiGrokBuildUISettings> = DEFAULT_PI_GROK_BUILD_UI_SETTINGS,
): PiGrokBuildUISettings {
	const visibility =
		preset === "minimal"
			? MINIMAL_PI_GROK_BUILD_UI_SETTINGS
			: DEFAULT_PI_GROK_BUILD_UI_SETTINGS;
	const next = { ...current };
	for (const key of VISIBILITY_SETTING_KEYS) next[key] = visibility[key];
	return next;
}

export function withVisibilitySetting(
	settings: PiGrokBuildUISettings,
	key: VisibilitySettingKey,
	value: boolean,
): PiGrokBuildUISettings {
	return { ...settings, [key]: value };
}

export function withAccentPreset(
	settings: PiGrokBuildUISettings,
	accentPreset: AccentPreset,
): PiGrokBuildUISettings {
	return { ...settings, accentPreset };
}

export function withCustomAccent(
	settings: PiGrokBuildUISettings,
	value: string,
): PiGrokBuildUISettings | undefined {
	const customAccent = normalizeHexColor(value);
	return customAccent
		? { ...settings, accentPreset: "custom", customAccent }
		: undefined;
}

/**
 * Malformed, unreadable, unsupported, or missing files safely use defaults.
 * A legacy path is consulted only while the primary file does not exist.
 */
export function loadPiGrokBuildUISettings(
	path: string,
	legacyPath?: string,
): PiGrokBuildUISettings {
	try {
		const sourcePath =
			existsSync(path) || !legacyPath || !existsSync(legacyPath)
				? path
				: legacyPath;
		if (!existsSync(sourcePath)) return defaults();
		const parsed: unknown = JSON.parse(readFileSync(sourcePath, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.version !== PI_GROK_BUILD_UI_SETTINGS_VERSION
		) {
			return defaults();
		}
		return normalizePiGrokBuildUISettings(parsed.settings);
	} catch {
		return defaults();
	}
}

/** Write in the destination directory, fsync, then atomically rename into place. */
export function savePiGrokBuildUISettings(
	path: string,
	settings: PiGrokBuildUISettings,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
		.toString(16)
		.slice(2)}`;
	const file: PiGrokBuildUISettingsFile = {
		version: PI_GROK_BUILD_UI_SETTINGS_VERSION,
		settings: normalizePiGrokBuildUISettings(settings),
	};
	let fd: number | undefined;
	try {
		fd = openSync(tempPath, "wx", 0o600);
		writeFileSync(fd, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(tempPath, path);
	} catch (error) {
		if (fd !== undefined) closeSync(fd);
		rmSync(tempPath, { force: true });
		throw error;
	}
}
