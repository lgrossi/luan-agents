import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as editor from "../tui/editor";
import { fetchMollieStatus, MOLLIE_POLL_INTERVAL, renderMollieQuotaLine, type MollieQuotaState } from "./quota";

const MIN_MOLLIE_WIDTH = 24;

type BottomLeftProvider = (width: number, theme: unknown) => string | undefined;
type EditorWithSlot = { setEditorBottomLeftProvider?: (provider: BottomLeftProvider | undefined) => void };
const setEditorBottomLeftProvider = (editor as EditorWithSlot).setEditorBottomLeftProvider;

export default function mollieExtension(pi: ExtensionAPI) {
	if (typeof setEditorBottomLeftProvider !== "function") return;

	let state: MollieQuotaState = undefined;
	let timer: ReturnType<typeof setInterval> | null = null;
	let disposed = false;

	const stopTimer = () => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	const startPolling = () => {
		stopTimer();
		const poll = () => {
			void fetchMollieStatus().then((data) => {
				if (disposed) return;
				state = data;
			});
		};
		poll();
		timer = setInterval(poll, MOLLIE_POLL_INTERVAL);
	};

	pi.on("session_start", async () => {
		disposed = false;
		state = undefined;
		setEditorBottomLeftProvider((width, theme) => {
			if (width < MIN_MOLLIE_WIDTH) return undefined;
			return renderMollieQuotaLine(state, theme as never, width);
		});
		startPolling();
	});

	pi.on("session_shutdown", async () => {
		disposed = true;
		stopTimer();
		setEditorBottomLeftProvider(undefined);
		state = undefined;
	});
}
