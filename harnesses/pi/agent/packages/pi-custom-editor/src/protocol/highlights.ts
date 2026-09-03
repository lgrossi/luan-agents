import type { TuiForegroundColor, TuiIconName } from "pi-libtui";

export const EDITOR_HIGHLIGHT_PROTOCOL = "pi-custom-editor/highlights/v1" as const;
export const EDITOR_HIGHLIGHT_REGISTRY_KEY = Symbol.for(EDITOR_HIGHLIGHT_PROTOCOL);

export type EditorHighlightPresentation =
	| { readonly kind: "foreground"; readonly color: TuiForegroundColor }
	| {
			readonly kind: "pill";
			readonly label: string;
			readonly icon: TuiIconName | { readonly glyph: string } | false;
			readonly foreground?: TuiForegroundColor;
			readonly iconTone?: TuiForegroundColor;
			/** Keep editable tokens as text until the cursor is separated by this many whitespace cells. */
			readonly minimumCursorGap?: number;
	  };

export interface EditorHighlightMatch {
	/** UTF-16 offsets into `EditorHighlightContext.text`. */
	readonly start: number;
	readonly end: number;
	readonly presentation: EditorHighlightPresentation;
}

export interface EditorHighlightContext {
	readonly text: string;
	readonly line: number;
	readonly promptLine: number;
	readonly excludedRanges?: readonly { readonly start: number; readonly end: number }[];
}

export interface EditorHighlightContribution {
	readonly id: string;
	readonly priority?: number;
	matches(context: EditorHighlightContext): readonly EditorHighlightMatch[];
}

export interface EditorHighlightRegistry {
	readonly protocol: typeof EDITOR_HIGHLIGHT_PROTOCOL;
	readonly version: 1;
	register(contribution: EditorHighlightContribution): () => void;
}

interface RegistryState {
	contributions: EditorHighlightContribution[];
}

// type-boundary: Symbol.for capabilities can come from another extension realm; these validators narrow them.
type UntrustedHighlightValue = unknown;

const STATE_KEY = Symbol.for("pi-custom-editor/highlights-state/v1");
const localStates = new WeakMap<EditorHighlightRegistry, RegistryState>();

function isRecord(value: UntrustedHighlightValue): value is Record<PropertyKey, UntrustedHighlightValue> {
	return value !== null && typeof value === "object";
}

function isContribution(value: UntrustedHighlightValue): value is EditorHighlightContribution {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		(value.priority === undefined || (typeof value.priority === "number" && Number.isFinite(value.priority))) &&
		typeof value.matches === "function"
	);
}

function stateOf(value: UntrustedHighlightValue): RegistryState | undefined {
	if (!isRecord(value)) return undefined;
	try {
		const state = Reflect.get(value, STATE_KEY);
		if (!isRecord(state) || !Array.isArray(state.contributions) || !state.contributions.every(isContribution)) {
			return undefined;
		}
		return { contributions: state.contributions };
	} catch {
		return undefined;
	}
}

function isRegistry(value: UntrustedHighlightValue): value is EditorHighlightRegistry {
	return (
		isRecord(value) &&
		value.protocol === EDITOR_HIGHLIGHT_PROTOCOL &&
		value.version === 1 &&
		typeof value.register === "function" &&
		stateOf(value) !== undefined
	);
}

function stateFor(registry: EditorHighlightRegistry): RegistryState {
	const local = localStates.get(registry);
	if (local) return local;
	const shared = stateOf(registry);
	if (shared) {
		localStates.set(registry, shared);
		return shared;
	}
	const state: RegistryState = { contributions: [] };
	Object.defineProperty(registry, STATE_KEY, { value: state, enumerable: false });
	localStates.set(registry, state);
	return state;
}

/** Resolve the optional, process-wide editor highlight capability. */
export function ensureEditorHighlightRegistry(scope: typeof globalThis = globalThis): EditorHighlightRegistry {
	const slots = scope as Record<PropertyKey, UntrustedHighlightValue>;
	const existing = slots[EDITOR_HIGHLIGHT_REGISTRY_KEY];
	if (isRegistry(existing)) return existing;

	const registry: EditorHighlightRegistry = {
		protocol: EDITOR_HIGHLIGHT_PROTOCOL,
		version: 1,
		register(contribution) {
			if (!isContribution(contribution)) return () => {};
			const contributions = stateFor(registry).contributions;
			const previous = contributions.findIndex((candidate) => candidate.id === contribution.id);
			if (previous >= 0) contributions[previous] = contribution;
			else contributions.push(contribution);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				const index = contributions.indexOf(contribution);
				if (index >= 0) contributions.splice(index, 1);
			};
		},
	};
	stateFor(registry);
	slots[EDITOR_HIGHLIGHT_REGISTRY_KEY] = registry;
	return registry;
}

export function editorHighlightContributions(
	registry: EditorHighlightRegistry,
): readonly EditorHighlightContribution[] {
	return [...stateFor(registry).contributions].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
}
