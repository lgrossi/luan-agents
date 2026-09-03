export {
	EDITOR_HIGHLIGHT_PROTOCOL,
	EDITOR_HIGHLIGHT_REGISTRY_KEY,
	type EditorHighlightContext,
	type EditorHighlightContribution,
	type EditorHighlightMatch,
	type EditorHighlightPresentation,
	type EditorHighlightRegistry,
	ensureEditorHighlightRegistry,
} from "./protocol/highlights.ts";
export { formatDuration, TuiState, type WorkingSnapshot } from "./runtime/state.ts";
