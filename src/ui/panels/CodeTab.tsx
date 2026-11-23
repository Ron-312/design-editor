import { useEffect, useState } from "react";
import type { BoardIndex } from "../../shared/protocol";
import type { AuthoredDeclaration, EdId } from "../../shared/types";
import { writeClipboardText } from "../clipboard";
import { useFrameGeneration } from "../frame-generation";
import type { EditorContext } from "../plugin-api";
import { codeBlocksOf, type CodeBlock } from "./code-rules";

interface CodeTabProps {
  readonly ctx: EditorContext;
  readonly index: BoardIndex;
  readonly edId: EdId;
}

function declarationsText(
  declarations: readonly AuthoredDeclaration[],
): string {
  return declarations
    .map(
      ({ prop, value, important }) =>
        `${prop}: ${value}${important ? " !important" : ""};`,
    )
    .join("\n");
}

function useMatchedRules(
  ctx: EditorContext,
  index: BoardIndex,
  edId: EdId,
): readonly boolean[] | null {
  const frame = useFrameGeneration();
  const [matched, setMatched] = useState<readonly boolean[] | null>(null);

  useEffect(() => {
    let current = true;
    ctx
      .read({
        kind: "matches",
        edId,
        selectors: index.rules.map((rule) => rule.selector),
      })
      .then((result) => {
        if (current) setMatched(result.matched);
      })
      // A reload rejects reads in flight; its frame's `ready` reads again.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [ctx, index, edId, frame]);

  return matched;
}

export function CodeTab({ ctx, index, edId }: CodeTabProps) {
  const matched = useMatchedRules(ctx, index, edId);
  const blocks = codeBlocksOf(index, edId, matched ?? []);

  function copy(text: string) {
    writeClipboardText(text).catch(() =>
      ctx.toast({ message: "The clipboard refused the copy", tone: "error" }),
    );
  }

  if (blocks.length === 0)
    return <p className="empty">No inline style and no matching rule</p>;
  return (
    <div className="code">
      {blocks.map((block) => (
        <CodeBlockView key={block.target} block={block} onCopy={copy} />
      ))}
    </div>
  );
}

function fileName(block: CodeBlock): string {
  return block.file.split("/").at(-1) ?? block.file;
}

function CodeBlockView({
  block,
  onCopy,
}: {
  readonly block: CodeBlock;
  readonly onCopy: (text: string) => void;
}) {
  const isInline = block.target === "inline";
  return (
    <section className="sec cb" data-code-block={block.target}>
      <div className="sh">
        <span className="mono">
          {fileName(block)}:{block.line}
        </span>
        {block.label && <span className="mono tag">{block.label}</span>}
        {block.media && <span className="mono tag">@media {block.media}</span>}
        {isInline ? (
          <button
            type="button"
            className="copy"
            onClick={() => onCopy(declarationsText(block.declarations))}
          >
            Copy declarations
          </button>
        ) : (
          <button
            type="button"
            className="copy"
            onClick={() => onCopy(block.text)}
          >
            Copy rule
          </button>
        )}
      </div>
      <pre className="mono src">{block.text}</pre>
    </section>
  );
}
