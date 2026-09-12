import { ensureNativeBinary, type NativeBinary } from "@luan.sh/pi-libtui";

const APPLY_PATCH: NativeBinary = { crate: "apply-patch", binaryName: "apply-patch", env: "PI_APPLY_PATCH_BIN" };

export function resolveApplyPatchBinary(): Promise<string> {
	return ensureNativeBinary(APPLY_PATCH);
}
