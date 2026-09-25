import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { formatResults, projectName } from "./index";

test("projectName: git repo name, else cwd basename", () => {
	expect(projectName(import.meta.dir)).toBe(basename(import.meta.dir));
	const dir = mkdtempSync(join(tmpdir(), "phm-"));
	expect(projectName(dir)).toBe(basename(dir));
});

test("formatResults", () => {
	expect(formatResults([{ text: "a", type: "world", mentioned_at: "2026-09-24T18:50:45Z" }, { text: "b" }])).toBe(
		"- [world, 2026-09-24] a\n- [] b",
	);
});
