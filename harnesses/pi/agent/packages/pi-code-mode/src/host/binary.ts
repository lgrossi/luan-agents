import { ensureNativeBinary, type NativeBinary } from "@luan-pi/pi-libtui";

export const CODE_MODE_HOST_ENV = "PI_CODE_MODE_HOST_BINARY";

const CODE_MODE_HOST: NativeBinary = { crate: "code-mode-host", binaryName: "code-mode-host", env: CODE_MODE_HOST_ENV };

export function resolveCodeModeHostBinary(): Promise<string> {
	return ensureNativeBinary(CODE_MODE_HOST);
}
