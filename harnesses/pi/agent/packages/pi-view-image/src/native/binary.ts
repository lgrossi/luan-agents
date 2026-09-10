import { type EnsureNativeBinaryHooks, ensureNativeBinary, type NativeBinary } from "@luan-pi/pi-libtui";

const VIEW_IMAGE: NativeBinary = { crate: "view-image", binaryName: "view_image", env: "PI_VIEW_IMAGE_BIN" };

export function resolveViewImageBinary(hooks?: EnsureNativeBinaryHooks): Promise<string> {
	return ensureNativeBinary(VIEW_IMAGE, hooks);
}
