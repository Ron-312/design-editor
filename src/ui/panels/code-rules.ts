import type { BoardIndex } from "../../shared/protocol";
import type {
  AuthoredDeclaration,
  EdId,
  ProjectPath,
  StyleSource,
} from "../../shared/types";
import type { StyleTarget } from "./fields";

/** One inline style or `<helmet><style>` rule as the board source writes it. */
export interface CodeBlock {
  readonly target: StyleTarget;
  readonly text: string;
  readonly file: ProjectPath;
  readonly line: number;
  readonly declarations: readonly AuthoredDeclaration[];
  /** The state or pseudo-element the probe matched past, such as "on :hover" or "::before". */
  readonly label: string | null;
  readonly media: string | null;
}

const STATE = /:(?:hover|focus-visible|focus|active)(?![\w-])/g;
const PSEUDO_ELEMENT = /::?(?:before|after|placeholder)(?![\w-])/g;

function matchLabelOf(selector: string): string | null {
  const states = (selector.match(STATE) ?? []).map((state) => `on ${state}`);
  const pseudoElements = (selector.match(PSEUDO_ELEMENT) ?? []).map((pseudo) =>
    pseudo.startsWith("::") ? pseudo : `:${pseudo}`,
  );
  const parts = [...states, ...pseudoElements];
  return parts.length > 0 ? parts.join(" ") : null;
}

function blockOf(
  index: BoardIndex,
  source: StyleSource,
  label: string | null,
  media: string | null,
): CodeBlock {
  return {
    target: source.target,
    text: index.text.slice(source.range.start, source.range.end),
    file: source.file,
    line: source.line,
    declarations: source.declarations,
    label,
    media,
  };
}

/** The element's inline style, then each rule the probe matched (`matched` runs parallel to `index.rules`), in source order. */
export function codeBlocksOf(
  index: BoardIndex,
  edId: EdId,
  matched: readonly boolean[],
): CodeBlock[] {
  const inline = index.styles[edId]?.find(
    (source) => source.target === "inline",
  );
  const rules = index.rules
    .filter((_, i) => matched[i])
    .map((rule) =>
      blockOf(index, rule, matchLabelOf(rule.selector), rule.media),
    );
  return inline ? [blockOf(index, inline, null, null), ...rules] : rules;
}
