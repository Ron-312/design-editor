import type { EditRecord, ProjectPath } from '../shared/types'

export interface DiffPanelProps {
  readonly records: readonly EditRecord[]
  readonly onRevertFile: (file: ProjectPath) => void
}

export function fileName(path: ProjectPath): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** One line per record, the same splice the save toast echoes: `border-radius: 12px → 16px`. */
export function describeEdit(record: EditRecord): string {
  return `${record.prop ?? record.kind}: ${record.before ?? '—'} → ${record.after ?? '—'}`
}

/** Files in the order the session first edited them, each with its records in session order. */
function recordsByFile(records: readonly EditRecord[]): Map<ProjectPath, EditRecord[]> {
  const byFile = new Map<ProjectPath, EditRecord[]>()
  for (const record of records) {
    for (const file of record.files) byFile.set(file, [...(byFile.get(file) ?? []), record])
  }
  return byFile
}

export function DiffPanel({ records, onRevertFile }: DiffPanelProps) {
  const byFile = [...recordsByFile(records)]

  return (
    <section className="diff" aria-label="Changes">
      {byFile.length === 0 && <p className="empty">No edits this session</p>}
      {byFile.map(([file, fileRecords]) => (
        <div className="dfile" data-diff-file={file} key={file}>
          <div className="dhead">
            <span className="nm">{fileName(file)}</span>
            <button type="button" onClick={() => onRevertFile(file)}>
              Revert file
            </button>
          </div>
          <ul>
            {fileRecords.map((record, i) => (
              <li className="mono" key={i}>
                {describeEdit(record)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
