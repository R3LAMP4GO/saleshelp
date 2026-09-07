import playbookMarkdown from "../../../lotlift-sales-playbook.md?raw";

export type LotLiftPlaybookSection =
  | "North star"
  | "Ideal customer and fit"
  | "Discovery sequence"
  | "Qualification rules"
  | "Close rules"
  | "Objection response model"
  | "What not to say";

const sections = new Map<string, string>();
for (const part of playbookMarkdown.split(/^## /m).slice(1)) {
  const [heading, ...body] = part.split("\n");
  sections.set(heading.trim(), body.join("\n").trim());
}

/** Build-time LotLift policy; missing sections fail closed instead of inventing sales guidance. */
export function lotLiftPlaybookSection(section: LotLiftPlaybookSection): string {
  const content = sections.get(section);
  if (!content) throw new Error(`LotLift playbook is missing its ${section} section.`);
  return content;
}

export function lotLiftGuidance(...wanted: LotLiftPlaybookSection[]): string {
  return wanted.map((section) => `## ${section}\n${lotLiftPlaybookSection(section)}`).join("\n\n");
}
