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

export const OSCURA_SETTINGS_VERSION = 1;
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

export interface OscuraSettings {
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

export type OscuraPreset = "default" | "minimal";

export const DEFAULT_OSCURA_SETTINGS: Readonly<OscuraSettings> = Object.freeze({
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

export const MINIMAL_OSCURA_SETTINGS: Readonly<OscuraSettings> = Object.freeze({
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

interface OscuraSettingsFile {
	version: typeof OSCURA_SETTINGS_VERSION;
	settings: OscuraSettings;
}

function defaults(): OscuraSettings {
	return { ...DEFAULT_OSCURA_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep known, valid fields from a partial value and default everything else. */
export function normalizeOscuraSettings(value: unknown): OscuraSettings {
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
export function applyOscuraPreset(
	preset: OscuraPreset,
	current: Readonly<OscuraSettings> = DEFAULT_OSCURA_SETTINGS,
): OscuraSettings {
	const visibility =
		preset === "minimal"
			? MINIMAL_OSCURA_SETTINGS
			: DEFAULT_OSCURA_SETTINGS;
	const next = { ...current };
	for (const key of VISIBILITY_SETTING_KEYS) next[key] = visibility[key];
	return next;
}

export function withOscuraSetting(
	settings: OscuraSettings,
	key: VisibilitySettingKey,
	value: boolean,
): OscuraSettings {
	return { ...settings, [key]: value };
}

export function withAccentPreset(
	settings: OscuraSettings,
	accentPreset: AccentPreset,
): OscuraSettings {
	return { ...settings, accentPreset };
}

export function withCustomAccent(
	settings: OscuraSettings,
	value: string,
): OscuraSettings | undefined {
	const customAccent = normalizeHexColor(value);
	return customAccent
		? { ...settings, accentPreset: "custom", customAccent }
		: undefined;
}

/** Malformed, unreadable, unsupported, or missing files safely use defaults. */
export function loadOscuraSettings(path: string): OscuraSettings {
	try {
		if (!existsSync(path)) return defaults();
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || parsed.version !== OSCURA_SETTINGS_VERSION) {
			return defaults();
		}
		return normalizeOscuraSettings(parsed.settings);
	} catch {
		return defaults();
	}
}

/** Write in the destination directory, fsync, then atomically rename into place. */
export function saveOscuraSettings(
	path: string,
	settings: OscuraSettings,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
		.toString(16)
		.slice(2)}`;
	const file: OscuraSettingsFile = {
		version: OSCURA_SETTINGS_VERSION,
		settings: normalizeOscuraSettings(settings),
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
