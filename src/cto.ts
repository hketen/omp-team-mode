import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export const STATE_ENTRY = "omp-team-mode.state";
export const DEFAULT_FILE = "team-mode.json";
const USAGE = "Usage: /cto [on|off|default on|default off]";

export type Source = "session" | "default" | "off";

/** Profile-wide default; undefined when the file is missing or unreadable. */
export async function readDefault(agentDir: string): Promise<boolean | undefined> {
	try {
		const { enabled } = JSON.parse(await readFile(join(agentDir, DEFAULT_FILE), "utf8"));
		return typeof enabled === "boolean" ? enabled : undefined;
	} catch {
		return undefined;
	}
}

export async function writeDefault(agentDir: string, enabled: boolean): Promise<string> {
	const file = join(agentDir, DEFAULT_FILE);
	await mkdir(agentDir, { recursive: true });
	await writeFile(file, `${JSON.stringify({ enabled })}\n`);
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
	// Read only when a session opens, so `/cto default` never changes an already-open session.
	let def: boolean | undefined;

	const describe = () => {
		const { enabled, source } = effective(session, def);
		return `${enabled ? "on" : "off"} (source: ${source})`;
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
		if (ctx.agent.kind !== "main" || !effective(session, def).enabled) return;
		return { systemPrompt: [...event.systemPrompt, rules] };
	});

	pi.registerCommand("cto", {
		description: "CTO team mode: /cto [on|off|default on|default off]",
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);
			const [a, b] = words;
			if (words.length === 0) {
				ctx.ui.notify(`CTO mode: ${describe()}`, "info");
			} else if (words.length === 1 && (a === "on" || a === "off")) {
				session = a === "on";
				pi.appendEntry(STATE_ENTRY, { enabled: session });
				ctx.ui.notify(`CTO mode ${a} for this session`, "info");
			} else if (words.length === 2 && a === "default" && (b === "on" || b === "off")) {
				const file = await writeDefault(pi.pi.getAgentDir(), b === "on");
				ctx.ui.notify(`Default for new sessions: ${b} (${file}). This session is unchanged: ${describe()}`, "info");
			} else {
				ctx.ui.notify(USAGE, "warning");
			}
		},
	});
}
