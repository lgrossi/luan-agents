type StringSchema = { type: "string"; description: string };
type ObjectSchema = {
	type: "object";
	properties: Record<string, StringSchema>;
	required?: string[];
};

function stringSchema(description: string): StringSchema {
	return { type: "string", description };
}

function objectSchema(properties: Record<string, StringSchema>, required: string[] = []): ObjectSchema {
	return { type: "object", properties, ...(required.length ? { required } : {}) };
}

export const ORCHESTRATE_TOOL = {
	name: "orchestrate",
	label: "Spawn orchestrate",
	description: "Plan and run a Spawn pipeline under budget. Returns origin/run IDs, status, and next trace command.",
	parameters: objectSchema(
		{
			request: stringSchema("User goal or task to orchestrate."),
			mode: stringSchema("auto, side-spawn, handoff, or orchestrate."),
			budget: stringSchema("cheap, balanced, fast, or premium. Default balanced."),
		},
		["request"],
	),
};

export const LANE_STATUS_TOOL = {
	name: "lane_status",
	label: "Spawn lane status",
	description: "Show run status by run ID or origin ID, including budget, lane backend, and jump metadata.",
	parameters: objectSchema({
		runId: stringSchema("Specific run ID."),
		origin: stringSchema("Origin request ID."),
	}),
};

export const LANE_RESULT_TOOL = {
	name: "lane_result",
	label: "Spawn lane result",
	description: "Read a run result. Metadata is default; summaries/full transcripts require explicit verbosity.",
	parameters: objectSchema(
		{
			runId: stringSchema("Run ID to inspect."),
			verbosity: stringSchema("metadata, summary, or full."),
		},
		["runId"],
	),
};

export const SPAWN_ORCHESTRATOR_TOOLS = [ORCHESTRATE_TOOL, LANE_STATUS_TOOL, LANE_RESULT_TOOL] as const;
