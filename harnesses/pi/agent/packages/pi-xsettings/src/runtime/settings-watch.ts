import { type FSWatcher, realpathSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

/** Watch directories so atomic replacement and managed symlink targets stay visible. */
export function watchSettings(
	paths: readonly string[],
	refresh: () => Promise<void>,
	report: (error: Error) => void,
): () => void {
	const directories = new Map<string, Set<string>>();
	for (const path of paths) {
		let target = path;
		try {
			target = realpathSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		for (const candidate of [path, target]) {
			const directory = dirname(candidate);
			const names = directories.get(directory) ?? new Set<string>();
			names.add(basename(candidate));
			directories.set(directory, names);
		}
	}
	let queued: NodeJS.Immediate | undefined;
	const watchers: FSWatcher[] = [];
	try {
		for (const [directory, names] of directories) {
			const watcher = watch(directory, { persistent: false }, (_event, filename) => {
				if (filename !== null && !names.has(filename.toString())) return;
				if (queued) return;
				queued = setImmediate(() => {
					queued = undefined;
					void refresh().catch((error: Error) => report(error));
				});
			});
			watcher.on("error", report);
			watchers.push(watcher);
		}
	} catch (error) {
		for (const watcher of watchers) watcher.close();
		throw error;
	}
	return () => {
		if (queued) clearImmediate(queued);
		for (const watcher of watchers) watcher.close();
	};
}
