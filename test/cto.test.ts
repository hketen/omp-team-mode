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

test("default file read/write", async () => {
	const root = await mkdtemp(join(tmpdir(), "omp-team-mode-"));
	try {
		const agentDir = join(root, "profiles", "x", "agent"); // does not exist yet
		expect(await readDefault(agentDir)).toBeUndefined();
		await writeDefault(agentDir, true);
		expect(await readDefault(agentDir)).toBe(true);
		await writeDefault(agentDir, false);
		expect(await readDefault(agentDir)).toBe(false);
		await Bun.write(join(agentDir, "team-mode.json"), "not json");
		expect(await readDefault(agentDir)).toBeUndefined();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
