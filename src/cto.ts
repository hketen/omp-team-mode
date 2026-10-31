import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export const STATE_ENTRY = "omp-team-mode.state";
export const DEFAULT_FILE = "team-mode.json";
export const TEST_MODES = ["none", "fast", "full"] as const;
const USAGE = "Usage: /cto [on|off|test <none|fast|full>|default on|default off|default test <none|fast|full>]";

export type Source = "session" | "default" | "off";
export type TestMode = (typeof TEST_MODES)[number];
export type Defaults = { enabled?: boolean; test?: TestMode };

const isTestMode = (v: unknown): v is TestMode => TEST_MODES.includes(v as TestMode);

/** Profile-wide defaults; invalid fields are dropped, empty when the file is missing or unreadable. */
export async function readDefault(agentDir: string): Promise<Defaults> {
	try {
		const { enabled, test } = JSON.parse(await readFile(join(agentDir, DEFAULT_FILE), "utf8"));
		return { ...(typeof enabled === "boolean" && { enabled }), ...(isTestMode(test) && { test }) };
	} catch {
		return {};
	}
}

/** Merges `patch` into the profile defaults. */
export async function writeDefault(agentDir: string, patch: Defaults): Promise<string> {
	const file = join(agentDir, DEFAULT_FILE);
	await mkdir(agentDir, { recursive: true });
	await writeFile(file, `${JSON.stringify({ ...(await readDefault(agentDir)), ...patch })}\n`);
	return file;
}

/** Latest explicit `/cto on|off` on the current branch. */
export function sessionChoice(entries: readonly unknown[]): boolean | undefined {
	let choice: boolean | undefined;
	for (const e of entries) {
		const { type, customType, data } = e as { type?: string; customType?: string; data?: { enabled?: unknown } };
		if (type === "custom" && customType === STATE_ENTRY && typeof data?.enabled === "boolean") choice = data.enabled;
	}
	return choice;
}

export function effective(session: boolean | undefined, def: boolean | undefined): { enabled: boolean; source: Source } {
	if (session !== undefined) return { enabled: session, source: "session" };
	if (def !== undefined) return { enabled: def, source: "default" };
	return { enabled: false, source: "off" };
}

export default async function teamMode(pi: ExtensionAPI) {
	const rules = await readFile(join(import.meta.dir, "../prompts/cto.md"), "utf8");
	let session: boolean | undefined;
	// Read when a session opens, so `/cto default on|off` never changes an already-open session; `/cto default test` applies at once.
	let def: Defaults = {};
	// `/cto test <mode>`: overrides the default for the next prompt only.
	let next: TestMode | undefined;

	const testMode = () => next ?? def.test ?? "none";
	const describe = () => {
		const { enabled, source } = effective(session, def.enabled);
		return `${enabled ? "on" : "off"} (source: ${source}), test mode: ${testMode()}${next ? " (next prompt only)" : ""}`;
	};

	const open = async (_event: unknown, ctx: ExtensionContext) => {
		def = await readDefault(pi.pi.getAgentDir());
		session = sessionChoice(ctx.sessionManager.getBranch());
	};
	const navigate = async (_event: unknown, ctx: ExtensionContext) => {
		session = sessionChoice(ctx.sessionManager.getBranch());
	};
	pi.on("session_start", open);
	pi.on("session_switch", open);
	pi.on("session_branch", navigate);
	pi.on("session_tree", navigate);

	pi.on("before_agent_start", async (event, ctx) => {
		// Subagents (developer, reviewer, ...) rebind this factory; only the main session is the CTO.
		if (ctx.agent.kind !== "main") return;
		const test = testMode();
		next = undefined;
		if (!effective(session, def.enabled).enabled) return;
		return { systemPrompt: [...event.systemPrompt, rules, `Current test mode: \`${test}\`.`] };
	});

	pi.registerCommand("cto", {
		description: "CTO team mode: /cto [on|off|test <mode>|default on|default off|default test <mode>]",
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);
			const [a, b, c] = words;
			if (words.length === 0) {
				ctx.ui.notify(`CTO mode: ${describe()}`, "info");
			} else if (words.length === 1 && (a === "on" || a === "off")) {
				session = a === "on";
				pi.appendEntry(STATE_ENTRY, { enabled: session });
				ctx.ui.notify(`CTO mode ${a} for this session`, "info");
			} else if (words.length === 2 && a === "test" && isTestMode(b)) {
				next = b;
				ctx.ui.notify(`Test mode ${b} for the next prompt only`, "info");
			} else if (words.length === 2 && a === "default" && (b === "on" || b === "off")) {
				const file = await writeDefault(pi.pi.getAgentDir(), { enabled: b === "on" });
				ctx.ui.notify(`Default for new sessions: ${b} (${file}). This session is unchanged: ${describe()}`, "info");
			} else if (words.length === 3 && a === "default" && b === "test" && isTestMode(c)) {
				const file = await writeDefault(pi.pi.getAgentDir(), { test: c });
				def.test = c;
				ctx.ui.notify(`Default test mode: ${c} (${file})`, "info");
			} else {
				ctx.ui.notify(USAGE, "warning");
			}
		},
	});
}
