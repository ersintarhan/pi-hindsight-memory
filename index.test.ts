import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { formatResults, recallTags, scopeOf } from "./index";

test("scopeOf: git repo, worktree, stack root, plain dir", () => {
	const stack = mkdtempSync(join(tmpdir(), "phm-stack-"));
	const repo = join(stack, "svc");
	mkdirSync(repo);
	const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
	git("init", "-q");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i");
	git("worktree", "add", "-q", join(tmpdir(), `phm-wt-${Date.now()}`));
	const wt = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" })
		.split("\n")
		.filter((l) => l.startsWith("worktree "))[1]!
		.slice(9);
	const name = basename(stack);

	expect(scopeOf(stack, [stack])).toEqual({ project: name, stack: name });
	expect(scopeOf(join(repo), [stack])).toEqual({ project: "svc", stack: name });
	expect(scopeOf(wt, [stack])).toEqual({ project: "svc", stack: name }); // worktree outside the stack dir
	expect(scopeOf(repo)).toEqual({ project: "svc" });
	const plain = mkdtempSync(join(tmpdir(), "phm-"));
	expect(scopeOf(plain, [stack])).toEqual({ project: basename(plain) });
});

test("recallTags", () => {
	expect(recallTags({ project: "svc" })).toEqual(["project:svc"]);
	expect(recallTags({ project: "svc", stack: "torro" })).toEqual(["project:svc", "project:torro"]);
	expect(recallTags({ project: "torro", stack: "torro" })).toEqual(["project:torro", "stack:torro"]);
});

test("formatResults", () => {
	expect(formatResults([{ text: "a", type: "world", mentioned_at: "2026-09-24T18:50:45Z" }, { text: "b" }])).toBe(
		"- [world, 2026-09-24] a\n- [] b",
	);
});
