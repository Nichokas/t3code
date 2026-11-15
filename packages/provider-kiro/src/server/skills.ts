import type { ServerProviderSkill } from "@t3tools/contracts";
import { leadingSkillMention } from "@t3tools/shared/composerInlineTokens";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MAX_SKILL_BYTES = ByteSize.bytes(1_000_000);

const decodeFrontmatter = Schema.decodeUnknownOption(
  fromYaml(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
    }),
  ),
);

const readKiroSkill = Effect.fn("readKiroSkill")(
  function* (directory: string, scope: "project" | "user") {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillPath = path.join(directory, "SKILL.md");
    const info = yield* fileSystem.stat(skillPath);
    if (info.type !== "File") return undefined;
    const contents =
      info.size <= MAX_SKILL_BYTES ? yield* fileSystem.readFileString(skillPath) : "";
    const frontmatter = Option.getOrUndefined(
      decodeFrontmatter(FRONTMATTER_PATTERN.exec(contents)?.[1] ?? ""),
    );
    const name = path.basename(directory);
    const displayName = frontmatter?.name?.trim();
    const description = frontmatter?.description?.trim();
    return {
      name,
      path: skillPath,
      scope,
      enabled: true,
      ...(displayName && displayName !== name ? { displayName } : {}),
      ...(description ? { description } : {}),
    } satisfies ServerProviderSkill;
  },
  Effect.orElseSucceed(() => undefined),
);

/** Kiro loads `.kiro/skills/<name>/SKILL.md` from the workspace and home; the workspace wins. */
export const discoverKiroSkills = Effect.fn("discoverKiroSkills")(function* (input: {
  readonly cwd?: string | undefined;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home =
    input.environment.HOME?.trim() ||
    input.environment.USERPROFILE?.trim() ||
    (yield* HostProcess.HomeDirectory);
  const roots = [
    ...(input.cwd
      ? [{ directory: path.join(input.cwd, ".kiro", "skills"), scope: "project" as const }]
      : []),
    { directory: path.join(home, ".kiro", "skills"), scope: "user" as const },
  ];
  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const root of roots) {
    const entries = yield* fileSystem
      .readDirectory(root.directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const entry of entries) {
      if (skillsByName.has(entry)) continue;
      const skill = yield* readKiroSkill(path.join(root.directory, entry), root.scope);
      if (skill) skillsByName.set(skill.name, skill);
    }
  }
  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});

/** Kiro runs a skill only as a leading `/name`, while T3's `$` picker inserts `$name`. */
export function rewriteKiroSkillMention(
  text: string,
  skills: ReadonlyArray<ServerProviderSkill>,
): string {
  const mention = leadingSkillMention(text);
  return mention !== undefined &&
    skills.some((skill) => skill.enabled && skill.name === mention.name)
    ? `/${mention.name}${mention.rest}`
    : text;
}
