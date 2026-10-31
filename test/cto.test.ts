import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effective, readDefault, STATE_ENTRY, sessionChoice, writeDefault } from "../src/cto";

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
