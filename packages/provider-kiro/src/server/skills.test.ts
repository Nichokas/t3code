import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverKiroSkills, rewriteKiroSkillMention } from "./skills.ts";

it.layer(NodeServices.layer)("discoverKiroSkills", (it) => {
  it.effect("lists workspace, home and cloud skills, nearest first, with frontmatter", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-kiro-ws-" });
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-kiro-home-" });
      const workspaceSkills = path.join(workspace, ".kiro", "skills");
      const homeSkills = path.join(home, ".kiro", "skills");
      const cloudSkills = path.join(
        home,
        ".kiro",
        "cloud-cache",
        "resolved",
        "config",
        "user",
        "skills",
      );
      const writeSkill = (root: string, name: string, contents: string) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(path.join(root, name), { recursive: true });
          yield* fileSystem.writeFileString(path.join(root, name, "SKILL.md"), contents);
        });
      yield* writeSkill(
        workspaceSkills,
        "review",
        "---\nname: Code Review\ndescription: Review the diff\n---\nBody",
      );
      yield* writeSkill(homeSkills, "review", "---\nname: review\ndescription: Home review\n---\n");
      yield* writeSkill(homeSkills, "deploy", "---\nname: deploy\ndescription: Ship it\n---\n");
      yield* writeSkill(homeSkills, "broken", "---\ndescription: [unterminated\n---\n");
      yield* writeSkill(
        cloudSkills,
        "deploy",
        "---\nname: deploy\ndescription: Cloud deploy\n---\n",
      );
      yield* writeSkill(
        cloudSkills,
        "poteto-mode",
        "---\nname: poteto-mode\ndescription: Cloud\n---\n",
      );
      yield* fileSystem.makeDirectory(path.join(homeSkills, "no-skill-file"));
      yield* fileSystem.writeFileString(path.join(homeSkills, "notes.md"), "notes");

      const skills = yield* discoverKiroSkills({ cwd: workspace, environment: { HOME: home } });

      assert.deepEqual(skills, [
        {
          name: "broken",
          path: path.join(homeSkills, "broken", "SKILL.md"),
          scope: "user",
          enabled: true,
        },
        {
          name: "deploy",
          path: path.join(homeSkills, "deploy", "SKILL.md"),
          scope: "user",
          enabled: true,
          description: "Ship it",
        },
        {
          name: "poteto-mode",
          path: path.join(cloudSkills, "poteto-mode", "SKILL.md"),
          scope: "user",
          enabled: true,
          description: "Cloud",
        },
        {
          name: "review",
          path: path.join(workspaceSkills, "review", "SKILL.md"),
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
