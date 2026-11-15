import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverKiroSkills, rewriteKiroSkillMention } from "./skills.ts";

it.layer(NodeServices.layer)("discoverKiroSkills", (it) => {
  it.effect("lists workspace skills over same-named home skills, with frontmatter", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-kiro-ws-" });
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-kiro-home-" });
      const writeSkill = (root: string, name: string, contents: string) =>
        Effect.gen(function* () {
          const directory = path.join(root, ".kiro", "skills", name);
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
        });
      yield* writeSkill(
        workspace,
        "review",
        "---\nname: Code Review\ndescription: Review the diff\n---\nBody",
      );
      yield* writeSkill(home, "review", "---\nname: review\ndescription: Home review\n---\n");
      yield* writeSkill(home, "deploy", "---\nname: deploy\ndescription: Ship it\n---\n");
      yield* writeSkill(home, "broken", "---\ndescription: [unterminated\n---\n");
      yield* fileSystem.makeDirectory(path.join(home, ".kiro", "skills", "no-skill-file"));
      yield* fileSystem.writeFileString(path.join(home, ".kiro", "skills", "notes.md"), "notes");

      const skills = yield* discoverKiroSkills({ cwd: workspace, environment: { HOME: home } });

      const homeSkill = (name: string) => path.join(home, ".kiro", "skills", name, "SKILL.md");
      assert.deepEqual(skills, [
        { name: "broken", path: homeSkill("broken"), scope: "user", enabled: true },
        {
          name: "deploy",
          path: homeSkill("deploy"),
          scope: "user",
          enabled: true,
          description: "Ship it",
        },
        {
          name: "review",
          path: path.join(workspace, ".kiro", "skills", "review", "SKILL.md"),
          scope: "project",
          enabled: true,
          displayName: "Code Review",
          description: "Review the diff",
        },
      ]);
    }),
  );

  it.effect("lists nothing when neither skills directory exists", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const empty = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-kiro-empty-" });
      assert.deepEqual(yield* discoverKiroSkills({ cwd: empty, environment: { HOME: empty } }), []);
    }),
  );
});

describe("rewriteKiroSkillMention", () => {
  const skills = [
    { name: "deploy", path: "/home/dev/.kiro/skills/deploy/SKILL.md", enabled: true },
    { name: "off", path: "/home/dev/.kiro/skills/off/SKILL.md", enabled: false },
  ];

  it.each([
    { text: "$deploy to staging", rewritten: "/deploy to staging" },
    { text: "$deploy", rewritten: "/deploy" },
    { text: "$unknown to staging", rewritten: "$unknown to staging" },
    { text: "$off now", rewritten: "$off now" },
    { text: "please $deploy", rewritten: "please $deploy" },
    { text: "$25 off", rewritten: "$25 off" },
  ])("reads $text", ({ text, rewritten }) => {
    assert.equal(rewriteKiroSkillMention(text, skills), rewritten);
  });
});
