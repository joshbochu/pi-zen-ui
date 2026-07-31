import { blendHex } from "./format.ts";

export const ACCENT_PRESETS = ["oscura", "nord", "custom"] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export const ACCENT_PRESET_LABELS: Readonly<Record<AccentPreset, string>> =
	Object.freeze({
		oscura: "Oscura",
		nord: "Nord Frost",
		custom: "Custom",
	});

export const DEFAULT_CUSTOM_ACCENT = "#C4A7E7";
const OSCURA_CANVAS = "#030304";
const HEX = /^#?([0-9a-f]{6})$/i;

export interface AccentSettings {
	accentPreset: AccentPreset;
	customAccent: string;
}

export interface AccentPalette {
	bright: string;
	core: string;
	dim: string;
	highlightLow: string;
	highlightMed: string;
	highlightHigh: string;
}

const OSCURA_ACCENT: Readonly<AccentPalette> = Object.freeze({
	bright: "#C4A7E7",
	core: "#9B7ECE",
	dim: "#6E5A9A",
	highlightLow: "#12101C",
	highlightMed: "#242034",
	highlightHigh: "#343048",
});

const NORD_ACCENT: Readonly<AccentPalette> = Object.freeze({
	bright: "#88C0D0", // nord8
	core: "#81A1C1", // nord9
	dim: "#5E81AC", // nord10
	highlightLow: "#0E1214",
	highlightMed: "#1B2529",
	highlightHigh: "#27363B",
});

export function normalizeHexColor(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const match = HEX.exec(value.trim());
	return match?.[1] ? `#${match[1].toUpperCase()}` : undefined;
}

export function isAccentPreset(value: unknown): value is AccentPreset {
	return (
		typeof value === "string" &&
		(ACCENT_PRESETS as readonly string[]).includes(value)
	);
}

export function accentPresetFromLabel(label: string): AccentPreset | undefined {
	return ACCENT_PRESETS.find(
		(preset) => ACCENT_PRESET_LABELS[preset] === label,
	);
}

function normalizeBlend(background: string, foreground: string, alpha: number) {
	return normalizeHexColor(blendHex(background, foreground, alpha))!;
}

function customAccentPalette(accent: string): AccentPalette {
	return {
		bright: accent,
		core: normalizeBlend(OSCURA_CANVAS, accent, 0.78),
		dim: normalizeBlend(OSCURA_CANVAS, accent, 0.56),
		highlightLow: normalizeBlend(OSCURA_CANVAS, accent, 0.08),
		highlightMed: normalizeBlend(OSCURA_CANVAS, accent, 0.18),
		highlightHigh: normalizeBlend(OSCURA_CANVAS, accent, 0.27),
	};
}

export function resolveAccentPalette(settings: AccentSettings): AccentPalette {
	if (settings.accentPreset === "oscura") return { ...OSCURA_ACCENT };
	if (settings.accentPreset === "nord") return { ...NORD_ACCENT };
	return customAccentPalette(
		normalizeHexColor(settings.customAccent) ?? DEFAULT_CUSTOM_ACCENT,
	);
}

export function effectiveAccentHex(settings: AccentSettings): string {
	return resolveAccentPalette(settings).bright;
}

export interface ThemeTemplate {
	vars: Record<string, string | number>;
	colors: Record<string, string | number>;
}

export interface ThemeColorMaps {
	foregrounds: Record<string, string | number>;
	backgrounds: Record<string, string | number>;
}

const BACKGROUND_KEYS = new Set([
	"selectedBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

function resolveTemplateColor(
	value: string | number,
	vars: Record<string, string | number>,
): string | number {
	if (typeof value !== "string") return value;
	let current: string | number = value;
	const seen = new Set<string>();
	while (typeof current === "string" && Object.hasOwn(vars, current)) {
		if (seen.has(current)) throw new Error(`Theme variable cycle at ${current}`);
		seen.add(current);
		current = vars[current]!;
	}
	return current;
}

/** Build a complete Pi Theme while changing only Oscura's purple chrome family. */
export function buildAccentThemeColors(
	template: ThemeTemplate,
	palette: AccentPalette,
): ThemeColorMaps {
	const vars: Record<string, string | number> = {
		...template.vars,
		purpleBright: palette.bright,
		purple: palette.core,
		purpleDim: palette.dim,
		bgHighlightLow: palette.highlightLow,
		bgHighlightMed: palette.highlightMed,
		bgHighlightHigh: palette.highlightHigh,
	};
	const foregrounds: Record<string, string | number> = {};
	const backgrounds: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(template.colors)) {
		const resolved = resolveTemplateColor(value, vars);
		if (BACKGROUND_KEYS.has(key)) backgrounds[key] = resolved;
		else foregrounds[key] = resolved;
	}
	return { foregrounds, backgrounds };
}
