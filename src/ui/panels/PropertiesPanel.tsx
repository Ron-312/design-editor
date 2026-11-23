/// <reference types="vite/client" />
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { BoardIndex } from "../../shared/protocol";
import type {
  EdId,
  ProjectPath,
  ReadOnlyReason,
  StyleSource,
  TemplateNode,
} from "../../shared/types";
import { findNode } from "../canvas/selection";
import type { EditorContext, PanelSection, Selection } from "../plugin-api";
import { CodeTab } from "./CodeTab";
import {
  Icon,
  PanelStateContext,
  labelOf,
  type IconName,
  type PanelState,
  type StyleTarget,
  type Token,
} from "./fields";

export type { Token } from "./fields";

export interface SectionModule {
  readonly sections: readonly PanelSection[];
}

export function loadPanelSections(
  modules: Record<string, SectionModule>,
): PanelSection[] {
  return Object.values(modules)
    .flatMap((module) => module.sections)
    .sort((a, b) => a.order - b.order);
}

export function defaultPanelSections(): PanelSection[] {
  return loadPanelSections(
    import.meta.glob<SectionModule>("./sections/*.section.tsx", {
      eager: true,
    }),
  );
}

const DEFAULT_SECTIONS = defaultPanelSections();

const READ_ONLY_NOTES: Readonly<Record<ReadOnlyReason, string>> = {
  hole: "Bound to a {{hole}}: read-only",
  "dc-import": "An imported component: edit it in its own file",
  "script-made": "Made by a script: read-only",
  "artboard-root": "The artboard root: read-only",
};

export interface PropertiesPanelProps {
  readonly ctx: EditorContext;
  readonly tokens: readonly Token[];
  readonly sections?: readonly PanelSection[];
}

type PanelTab = "design" | "code";

const TAB_NAMES: Readonly<Record<PanelTab, string>> = {
  design: "Design",
  code: "Code",
};

function selectionKeyOf(selection: Selection | null): string {
  return selection ? `${selection.board} ${selection.edIds.join(" ")}` : "";
}

export function PropertiesPanel({
  ctx,
  tokens,
  sections = DEFAULT_SECTIONS,
}: PropertiesPanelProps) {
  const index = useSyncExternalStore(ctx.onChange, ctx.index);
  const selectionKey = useSyncExternalStore(ctx.onChange, () =>
    selectionKeyOf(ctx.selection()),
  );
  const readOnly = useSyncExternalStore(ctx.onChange, ctx.readOnly);
  const [tab, setTab] = useState<PanelTab>("design");
  const selection = ctx.selection();
  const hasSelection =
    index !== null && selection !== null && selection.edIds.length > 0;

  return (
    <aside className="props" aria-label="Properties">
      <style>{PANEL_CSS}</style>
      {hasSelection ? (
        <SelectionProperties
          key={selectionKey}
          ctx={ctx}
          index={index}
          selection={selection}
          tokens={tokens}
          sections={sections}
          readOnly={readOnly}
          tab={tab}
          onTab={setTab}
        />
      ) : (
        <p className="empty">Select a layer to edit its styles</p>
      )}
    </aside>
  );
}

interface SelectionPropertiesProps {
  readonly ctx: EditorContext;
  readonly index: BoardIndex;
  readonly selection: Selection;
  readonly tokens: readonly Token[];
  readonly sections: readonly PanelSection[];
  readonly readOnly: boolean;
  readonly tab: PanelTab;
  readonly onTab: (tab: PanelTab) => void;
}

function readOnlyReasonOf(
  tree: TemplateNode,
  edIds: readonly EdId[],
): ReadOnlyReason | null {
  return (
    edIds
      .map((edId) => findNode(tree, edId)?.readOnly)
      .find((reason) => reason !== undefined) ?? null
  );
}

function SelectionProperties({
  ctx,
  index,
  selection,
  tokens,
  sections,
  readOnly,
  tab,
  onTab,
}: SelectionPropertiesProps) {
  const [target, setTarget] = useState<StyleTarget>("inline");
  const readOnlyReason = readOnlyReasonOf(index.tree, selection.edIds);
  const state = useMemo<PanelState>(
    () => ({
      ctx,
      edIds: selection.edIds,
      styles: index.styles,
      target,
      tokens,
      editable: !readOnly && readOnlyReason === null,
    }),
    [
      ctx,
      selection.edIds,
      index.styles,
      target,
      tokens,
      readOnly,
      readOnlyReason,
    ],
  );

  return (
    <PanelStateContext.Provider value={state}>
      <SelectionHeading tree={index.tree} edIds={selection.edIds} />
      <PanelTabs tab={tab} onTab={onTab} />
      <div role="tabpanel" aria-label={TAB_NAMES[tab]}>
        {tab === "design" ? (
          <DesignTab
            ctx={ctx}
            index={index}
            selection={selection}
            sections={sections}
            target={target}
            onPick={setTarget}
            readOnlyReason={readOnlyReason}
          />
        ) : (
          <CodeTab ctx={ctx} index={index} edId={selection.edIds[0]!} />
        )}
      </div>
    </PanelStateContext.Provider>
  );
}

function PanelTabs({
  tab,
  onTab,
}: {
  readonly tab: PanelTab;
  readonly onTab: (tab: PanelTab) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Properties view">
      {(Object.keys(TAB_NAMES) as PanelTab[]).map((name) => (
        <button
          type="button"
          role="tab"
          key={name}
          aria-selected={name === tab}
          onClick={() => onTab(name)}
        >
          {TAB_NAMES[name]}
        </button>
      ))}
    </div>
  );
}

interface DesignTabProps {
  readonly ctx: EditorContext;
  readonly index: BoardIndex;
  readonly selection: Selection;
  readonly sections: readonly PanelSection[];
  readonly target: StyleTarget;
  readonly onPick: (target: StyleTarget) => void;
  readonly readOnlyReason: ReadOnlyReason | null;
}

function DesignTab({
  ctx,
  index,
  selection,
  sections,
  target,
  onPick,
  readOnlyReason,
}: DesignTabProps) {
  const shown = sections.filter((section) => section.appliesTo(ctx, selection));

  return (
    <>
      <div className="target">
        <SelectorChip
          index={index}
          selection={selection}
          target={target}
          onPick={onPick}
        />
        <RepeatsNotice ctx={ctx} tree={index.tree} edIds={selection.edIds} />
        {readOnlyReason && (
          <p className="note">{READ_ONLY_NOTES[readOnlyReason]}</p>
        )}
      </div>
      {shown.map((section) => (
        <section className="sec" data-section={section.id} key={section.id}>
          <div className="sh">
            <h3>
              {section.title}
              {section.note && (
                <small>
                  <section.note ctx={ctx} selection={selection} />
                </small>
              )}
            </h3>
          </div>
          <section.component ctx={ctx} selection={selection} />
        </section>
      ))}
    </>
  );
}

const TEXT_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "a",
  "label",
  "li",
  "strong",
  "em",
  "small",
]);

function headingIcon(node: TemplateNode): IconName {
  if (node.tag === "img" || node.tag === "picture" || node.tag === "svg")
    return "image";
  return TEXT_TAGS.has(node.tag) ? "text" : "box";
}

function SelectionHeading({
  tree,
  edIds,
}: {
  readonly tree: TemplateNode;
  readonly edIds: readonly EdId[];
}) {
  const only = edIds.length === 1 ? findNode(tree, edIds[0]!) : null;
  return (
    <div className="ctx">
      <Icon name={only ? headingIcon(only) : "grid"} />
      <span className="nm">{only ? only.name : `${edIds.length} layers`}</span>
      {only && <span className="tg">{only.tag}</span>}
    </div>
  );
}

function fileName(file: ProjectPath): string {
  return file.split("/").at(-1) ?? file;
}

function whereOf(source: StyleSource): string {
  return `${fileName(source.file)}:${source.line}`;
}

/** The inline style of each element, plus every `<helmet><style>` rule all the selected elements share. */
function targetsOf(index: BoardIndex, edIds: readonly EdId[]): StyleSource[] {
  const [first, ...rest] = edIds.map((edId) => index.styles[edId] ?? []);
  const shared = (source: StyleSource) =>
    rest.every((sources) =>
      sources.some((other) => other.target === source.target),
    );
  return (first ?? []).filter(
    (source) => source.target !== "inline" && shared(source),
  );
}

function chipText(
  index: BoardIndex,
  selection: Selection,
  target: StyleTarget,
  rules: readonly StyleSource[],
): readonly [string, string] {
  const rule = rules.find((source) => source.target === target);
  if (rule) return [labelOf(rule), whereOf(rule)];
  if (selection.edIds.length > 1)
    return ["style", `${selection.edIds.length} layers`];
  const inline = index.styles[selection.edIds[0]!]?.find(
    (source) => source.target === "inline",
  );
  return ["style", inline ? whereOf(inline) : fileName(selection.board)];
}

interface SelectorChipProps {
  readonly index: BoardIndex;
  readonly selection: Selection;
  readonly target: StyleTarget;
  readonly onPick: (target: StyleTarget) => void;
}

function SelectorChip({ index, selection, target, onPick }: SelectorChipProps) {
  const [open, setOpen] = useState(false);
  const rules = targetsOf(index, selection.edIds);
  const [label, where] = chipText(index, selection, target, rules);
  const choices: readonly (readonly [StyleTarget, string, string])[] = [
    ["inline", ...chipText(index, selection, "inline", rules)],
    ...rules.map(
      (rule) => [rule.target, labelOf(rule), whereOf(rule)] as const,
    ),
  ];

  function pick(next: StyleTarget) {
    setOpen(false);
    onPick(next);
  }

  return (
    <div className="picker">
      <button
        type="button"
        className="chip"
        data-selector-chip=""
        title="Edits are written to this rule"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="code" />
        <span className="mono">
          {label} <span>·</span> {where}
        </span>
        <Icon name="chev-d" />
      </button>
      {open && (
        <div
          className="pop"
          role="listbox"
          aria-label="Write target"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        >
          {choices.map(([choice, choiceLabel, choiceWhere]) => (
            <button
              type="button"
              key={choice}
              role="option"
              aria-selected={choice === target}
              className="opt"
              onClick={() => pick(choice)}
            >
              <span className="mono">{choiceLabel}</span>
              <span className="mono dimmed">{choiceWhere}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function isInsideRepeat(
  tree: TemplateNode,
  edId: EdId,
  repeated = false,
): boolean {
  if (tree.edId === edId) return repeated;
  return tree.children.some((child) =>
    isInsideRepeat(child, edId, repeated || tree.kind === "sc-for"),
  );
}

interface RepeatsNoticeProps {
  readonly ctx: EditorContext;
  readonly tree: TemplateNode;
  readonly edIds: readonly EdId[];
}

/** An `<sc-for>` child shares one source element across its repeats, so an edit changes every copy. */
function RepeatsNotice({ ctx, tree, edIds }: RepeatsNoticeProps) {
  const repeated = edIds.find((edId) => isInsideRepeat(tree, edId)) ?? null;
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!repeated) return;
    let current = true;
    ctx
      .read({ kind: "rects", edId: repeated })
      .then((result) => {
        if (current) setCount(result.rects.length);
      })
      // A reload rejects reads in flight; the notice waits for the next selection or index.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [ctx, repeated]);

  if (!repeated || count === null) return null;
  return (
    <p className="shared">
      <Icon name="warn" />
      This edit affects {count} repeats
    </p>
  );
}

const PANEL_CSS = `
.props{background:var(--panel);color:var(--text);display:flex;flex-direction:column;min-height:0;overflow:auto;font-variant-numeric:tabular-nums}
.props button{font:inherit;color:inherit;background:none;border:0}
.props ul{list-style:none;margin:0;padding:0}
.props p{margin:0}
.props svg.i{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.props .mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:-.1px}
.props .dimmed{color:var(--text-3);margin-left:auto}
.props .empty{padding:16px 12px;color:var(--text-3)}
.props .ctx{height:40px;flex:none;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;border-bottom:1px solid var(--line);min-width:0}
.props .ctx svg.i{color:var(--accent-text)}
.props .ctx .nm{font-weight:600;font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.props .ctx .tg{color:var(--text-3);font:10px/16px "JetBrains Mono",ui-monospace,monospace}
.props .target{padding:12px;border-bottom:1px solid var(--line);display:grid;gap:8px}
.props .chip{width:100%;height:28px;display:flex;align-items:center;gap:8px;padding:0 8px;border-radius:var(--r-sm);background:var(--field);border:1px solid var(--line-strong)}
.props .chip svg.i{color:var(--accent-text)}
.props .chip svg.i:last-child{margin-left:auto;color:var(--text-3);width:12px;height:12px}
.props .chip .mono span{color:var(--text-3)}
.props .shared,.props .note,.props .fwarn{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--text-2)}
.props .shared svg.i,.props .fwarn svg.i{width:12px;height:12px;color:var(--warn)}
.props .fwarn{margin-top:4px;color:var(--warn)}
.props .tabs{height:32px;flex:none;display:flex;align-items:center;gap:4px;padding:0 8px;border-bottom:1px solid var(--line)}
.props .tabs [role="tab"]{height:24px;padding:0 8px;border-radius:var(--r-sm);color:var(--text-3);font-weight:600;font-size:12px}
.props .tabs [role="tab"][aria-selected="true"]{color:var(--text);background:var(--field)}
.props .code .sh{gap:6px;flex-wrap:wrap;height:auto;min-height:24px}
.props .code .tag{padding:0 6px;border-radius:10px;background:var(--accent-soft);color:var(--accent-text)}
.props .code .copy{margin-left:auto;height:24px;padding:0 6px;border-radius:var(--r-xs);color:var(--text-3);font-size:11px}
.props .code .copy:hover{background:var(--field-hover);color:var(--text)}
.props .code .src{margin:0;padding:8px;border-radius:var(--r-sm);background:var(--field);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
.props .sec{padding:8px 12px 12px;border-bottom:1px solid var(--line)}
.props .sh{height:24px;display:flex;align-items:center;margin-bottom:4px}
.props .sh h3{font-size:12px;font-weight:600;line-height:16px;margin:0}
.props .sh h3 small{font-weight:400;color:var(--text-3);margin-left:6px;font-size:11px}
.props .rows{display:grid;gap:8px}
.props .r{display:grid;gap:8px;align-items:center}
.props .r > *,.props .field{min-width:0}
.props .r2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.props .r3{grid-template-columns:repeat(3,minmax(0,1fr))}
.props .family{grid-template-columns:minmax(0,1fr) 96px}
.props .stroke{grid-template-columns:minmax(0,1fr) 80px}
.props .shadow{grid-template-columns:minmax(0,1fr) 28px;gap:4px}
.props .f{height:28px;border-radius:var(--r-sm);background:var(--field);display:flex;align-items:center;gap:6px;padding:0 8px;min-width:0;border:1px solid transparent}
.props .f:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.props .f.dis{background:transparent;border-color:var(--line)}
.props .f.dis .v{color:var(--text-3)}
.props .f .l{color:var(--text-3);font-size:11px;min-width:12px;flex:none;display:grid;place-items:center}
.props .f .v{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.props .f input.v{width:0;background:none;border:0;outline:none;color:inherit;font:inherit;padding:0;text-overflow:ellipsis}
.props .f input.v::placeholder{color:var(--text-3)}
.props .alpha{width:44px;flex:none;display:flex;border-left:1px solid var(--line);padding-left:6px}
.props .ib{width:24px;height:24px;flex:none;border-radius:var(--r-xs);display:grid;place-items:center;color:var(--text-3)}
.props .ib:hover:not(:disabled){background:var(--field-hover);color:var(--text)}
.props .sw{width:16px;height:16px;border-radius:4px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.props .tok{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px 0 4px;border-radius:10px;background:var(--token-bg);border:1px solid var(--token-line);color:var(--token);font:500 11px/16px "JetBrains Mono",monospace;white-space:nowrap}
.props .tok svg.i{width:12px;height:12px}
.props .picker{position:relative;display:flex}
.props .f{position:relative}
.props .f > .picker{position:absolute;right:1px;top:1px}
.props .f > .picker .ib{width:24px;height:24px;background:var(--field);opacity:0}
.props .f:hover > .picker .ib,.props .f:focus-within > .picker .ib,.props .f > .picker .ib[aria-expanded="true"]{opacity:1}
.props .pop{position:absolute;z-index:10;top:calc(100% + 4px);right:0;min-width:100%;width:max-content;max-width:260px;max-height:240px;overflow:auto;padding:4px;border-radius:var(--r-lg);background:var(--panel);box-shadow:var(--pop-shadow);display:grid}
.props .opt{height:28px;display:flex;align-items:center;gap:8px;padding:0 8px;border-radius:var(--r-sm);text-align:left}
.props .opt:hover,.props .opt[aria-selected="true"]{background:var(--accent-soft)}
.props .check{display:flex;align-items:center;gap:8px;height:20px;color:var(--text-2)}
.props .switch{width:28px;height:16px;border-radius:8px;background:var(--line-strong);position:relative;flex:none}
.props .switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--text);transition:transform .12s}
.props .switch[aria-checked="true"]{background:var(--accent)}
.props .switch[aria-checked="true"]::after{transform:translateX(12px);background:var(--accent-ink)}
`;
