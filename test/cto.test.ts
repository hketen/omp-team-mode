import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import teamMode, { effective, readDefault, STATE_ENTRY, STATUS_KEY, sessionChoice, writeDefault } from "../src/cto";

test("precedence: session > default > off", () => {
	for (const def of [undefined, true, false]) {
		expect(effective(true, def)).toEqual({ enabled: true, source: "session" });
		expect(effective(false, def)).toEqual({ enabled: false, source: "session" });
	}
	expect(effective(undefined, true)).toEqual({ enabled: true, source: "default" });
	expect(effective(undefined, false)).toEqual({ enabled: false, source: "default" });
	expect(effective(undefined, undefined)).toEqual({ enabled: false, source: "off" });
});

test("sessionChoice takes the latest own entry on the branch", () => {
	const own = (enabled: boolean) => ({ type: "custom", customType: STATE_ENTRY, data: { enabled } });
	expect(sessionChoice([])).toBeUndefined();
	expect(sessionChoice([{ type: "message" }, { type: "custom", customType: "other", data: { enabled: true } }])).toBeUndefined();
	expect(sessionChoice([own(true), { type: "message" }, own(false)])).toBe(false);
	expect(sessionChoice([own(false), own(true), { type: "custom", customType: "other", data: { enabled: false } }])).toBe(true);
});

test("default file read/write merges fields", async () => {
	const root = await mkdtemp(join(tmpdir(), "omp-team-mode-"));
	try {
		const agentDir = join(root, "profiles", "x", "agent"); // does not exist yet
		expect(await readDefault(agentDir)).toEqual({});
		await writeDefault(agentDir, { enabled: true });
		expect(await readDefault(agentDir)).toEqual({ enabled: true });
		await writeDefault(agentDir, { test: "full" });
		expect(await readDefault(agentDir)).toEqual({ enabled: true, test: "full" });
		await writeDefault(agentDir, { enabled: false });
		expect(await readDefault(agentDir)).toEqual({ enabled: false, test: "full" });
		await Bun.write(join(agentDir, "team-mode.json"), `{"enabled":1,"test":"slow"}`);
		expect(await readDefault(agentDir)).toEqual({});
		await Bun.write(join(agentDir, "team-mode.json"), "not json");
		expect(await readDefault(agentDir)).toEqual({});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fake pi: CTO rules and footer status only for the enabled main agent", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "omp-team-mode-"));
	try {
		const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
		let cto!: (args: string, ctx: unknown) => Promise<void>;
		const entries: unknown[] = [];
		const status: [string, string | undefined][] = [];
		const pi = {
			on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				handlers[event] = handler;
			},
			registerCommand: (_name: string, command: { handler: typeof cto }) => {
				cto = command.handler;
			},
			appendEntry: (customType: string, data: unknown) => {
				entries.push({ type: "custom", customType, data });
			},
			pi: { getAgentDir: () => agentDir },
		};
		const ctx = (kind: string, branch = () => entries) => ({
			agent: { kind },
			sessionManager: { getBranch: branch },
			ui: {
				notify: () => {},
				setStatus: (key: string, text: string | undefined) => {
					status.push([key, text]);
				},
			},
		});
		const main = ctx("main");
		const event = { systemPrompt: ["base"] };
		const rules = await Bun.file(join(import.meta.dir, "../prompts/cto.md")).text();
		await teamMode(pi as never);

		await handlers.session_start({}, ctx("sub"));
		expect(status).toEqual([]);
		await handlers.session_start({}, main);
		expect(status.at(-1)).toEqual([STATUS_KEY, undefined]);
		expect(await handlers.before_agent_start(event, main)).toBeUndefined();

		await cto("on", main);
		expect(status.at(-1)).toEqual([STATUS_KEY, "CTO"]);
		expect(await handlers.before_agent_start(event, main)).toEqual({
			systemPrompt: ["base", rules, "Current test mode: `none`."],
		});
		expect(await handlers.before_agent_start(event, ctx("sub"))).toBeUndefined();

		await cto("off", main);
		expect(status.at(-1)).toEqual([STATUS_KEY, undefined]);
		expect(await handlers.before_agent_start(event, main)).toBeUndefined();

		// Navigating back to the branch point before `/cto off` restores the status.
		await handlers.session_tree({}, ctx("main", () => entries.slice(0, 1)));
		expect(status.at(-1)).toEqual([STATUS_KEY, "CTO"]);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("agent frontmatter parses and names the team agents", async () => {
	for (const name of ["team-developer", "team-reviewer"]) {
		const text = await Bun.file(join(import.meta.dir, `../agents/${name}.md`)).text();
		// Frontmatter is the text between the first two `---` lines.
		expect(Bun.YAML.parse(text.split(/^---$/m)[1])).toMatchObject({ name });
	}
});

test("marker handshake: the CTO prompt and the agents share the same markers", async () => {
	const file = (path: string) => Bun.file(join(import.meta.dir, "..", path)).text();
	const rules = await file("prompts/cto.md");
	// The instruction phrase, not just the marker: a mention elsewhere (description, paragraph label) does not satisfy it.
	expect(rules).toContain("`Mode: plan` on a line of its own");
	expect(await file("agents/team-reviewer.md")).toContain("exactly `Mode: plan`");
	expect(rules).toContain("`Fast path` on a line of its own");
	expect(await file("agents/team-developer.md")).toContain("exactly `Fast path`");
});
