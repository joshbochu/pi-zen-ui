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

export const PI_ZEN_UI_SETTINGS_VERSION = 1;
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

export interface PiZenUISettings {
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

export const DEFAULT_PI_ZEN_UI_SETTINGS: Readonly<PiZenUISettings> =
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

export const MINIMAL_PI_ZEN_UI_SETTINGS: Readonly<PiZenUISettings> =
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

interface PiZenUISettingsFile {
	version: typeof PI_ZEN_UI_SETTINGS_VERSION;
	settings: PiZenUISettings;
}

function defaults(): PiZenUISettings {
	return { ...DEFAULT_PI_ZEN_UI_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep known, valid fields from a partial value and default everything else. */
export function normalizePiZenUISettings(
	value: unknown,
): PiZenUISettings {
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
	current: Readonly<PiZenUISettings> = DEFAULT_PI_ZEN_UI_SETTINGS,
): PiZenUISettings {
	const visibility =
		preset === "minimal"
			? MINIMAL_PI_ZEN_UI_SETTINGS
			: DEFAULT_PI_ZEN_UI_SETTINGS;
	const next = { ...current };
	for (const key of VISIBILITY_SETTING_KEYS) next[key] = visibility[key];
	return next;
}

export function withVisibilitySetting(
	settings: PiZenUISettings,
	key: VisibilitySettingKey,
	value: boolean,
): PiZenUISettings {
	return { ...settings, [key]: value };
}

export function withAccentPreset(
	settings: PiZenUISettings,
	accentPreset: AccentPreset,
): PiZenUISettings {
	return { ...settings, accentPreset };
}

export function withCustomAccent(
	settings: PiZenUISettings,
	value: string,
): PiZenUISettings | undefined {
	const customAccent = normalizeHexColor(value);
	return customAccent
		? { ...settings, accentPreset: "custom", customAccent }
		: undefined;
}

/**
 * Malformed, unreadable, unsupported, or missing files safely use defaults.
 */
export function loadPiZenUISettings(
	path: string,
): PiZenUISettings {
	try {
		if (!existsSync(path)) return defaults();
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.version !== PI_ZEN_UI_SETTINGS_VERSION
		) {
			return defaults();
		}
		return normalizePiZenUISettings(parsed.settings);
	} catch {
		return defaults();
	}
}

/** Write in the destination directory, fsync, then atomically rename into place. */
export function savePiZenUISettings(
	path: string,
	settings: PiZenUISettings,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
		.toString(16)
		.slice(2)}`;
	const file: PiZenUISettingsFile = {
		version: PI_ZEN_UI_SETTINGS_VERSION,
		settings: normalizePiZenUISettings(settings),
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
