import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitMerge, RefreshCw } from 'lucide-react'
import {
  listPendingObjectSyncConflicts,
  resolveObjectSyncConflict,
} from '../../lib/cloudObjectSync'
import { subscribeTravelDataChanged } from '../../lib/dataEvents'
import {
  formatConflictValue,
  getObjectTypeLabel,
} from '../../lib/objectSyncMerge'
import type {
  ObjectSyncConflict,
  ObjectSyncConflictResolution,
} from '../../types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type ObjectSyncConflictPanelProps = {
  tripId?: string
}

type ConflictResolutionDraft = {
  deleteResolution?: 'delete' | 'keep'
  fieldResolutions: Record<string, ObjectSyncConflictResolution>
}

export function ObjectSyncConflictPanel({ tripId }: ObjectSyncConflictPanelProps) {
  const [conflicts, setConflicts] = useState<ObjectSyncConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolutionDraft>>({})
  const [applyTarget, setApplyTarget] = useState<ObjectSyncConflict | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const nextConflicts = await listPendingObjectSyncConflicts(tripId)
      setConflicts(nextConflicts)
      setResolutions((current) => {
        const next = { ...current }
        for (const conflict of nextConflicts) {
          if (!next[conflict.id]) {
            next[conflict.id] = buildDefaultResolution(conflict)
          }
        }
        return next
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取对象同步冲突失败。')
    } finally {
      setIsLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => subscribeTravelDataChanged(() => {
    void refresh()
  }), [refresh])

  const grouped = useMemo(() => {
    const groups = new Map<string, ObjectSyncConflict[]>()
    for (const conflict of conflicts) {
      const key = conflict.objectType
      groups.set(key, [...(groups.get(key) ?? []), conflict])
    }
    return [...groups.entries()]
  }, [conflicts])

  if (!isLoading && conflicts.length === 0 && !error && !message) {
    return null
  }

  async function handleApplyConfirmed() {
    if (!applyTarget) return
    setIsApplying(true)
    setError(null)
    try {
      await resolveObjectSyncConflict(applyTarget.id, resolutions[applyTarget.id] ?? buildDefaultResolution(applyTarget))
      setApplyTarget(null)
      setMessage('冲突已处理，已加入同步队列。')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '应用冲突解决方案失败。')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <section
      className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/80 p-3 text-amber-950 dark:text-amber-200"
      data-testid="object-sync-conflict-panel"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-amber-600 dark:bg-surface-container-highest/60">
          <GitMerge className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">处理对象同步冲突</p>
          <p className="mt-1 break-words text-xs leading-5 [overflow-wrap:anywhere]">
            {conflicts.length > 0
              ? `${conflicts.length} 个对象需要选择字段版本。确认前不会写入此设备，也不会推送账号数据。`
              : '正在检查对象同步冲突。'}
          </p>
        </div>
        <Button
          className="min-h-9 shrink-0 px-3 text-xs"
          icon={<RefreshCw className="size-4" />}
          onClick={() => void refresh()}
          variant="secondary"
        >
          刷新
        </Button>
      </div>

      {error ? (
        <div className="break-words rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 [overflow-wrap:anywhere]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="break-words rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 [overflow-wrap:anywhere]">
          {message}
        </div>
      ) : null}

      {grouped.map(([objectType, group]) => (
        <div className="space-y-2" key={objectType}>
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            {getObjectTypeLabel(objectType as ObjectSyncConflict['objectType'])}
          </p>
          {group.map((conflict) => {
            const draft = resolutions[conflict.id] ?? buildDefaultResolution(conflict)
            return (
              <article
                className="space-y-3 rounded-xl border border-amber-200/70 bg-white/80 p-3 dark:bg-surface-container-highest/60"
                data-testid="object-sync-conflict-card"
                key={conflict.id}
              >
                <div>
                  <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">
                    {conflict.objectLabel}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    {conflict.conflictType === 'field_conflict'
                      ? `${conflict.fields.length} 个字段需要选择`
                      : '删除和更新同时发生，需要选择保留或删除'}
                  </p>
                </div>

                {conflict.conflictType === 'field_conflict' ? (
                  <div className="space-y-3">
                    {conflict.fields.map((field) => (
                      <div className="rounded-xl bg-amber-50 px-3 py-2" key={field.fieldPath}>
                        <p className="text-xs font-semibold text-amber-900">{field.label}</p>
                        <div className="mt-2 grid gap-2">
                          <ConflictRadio
                            checked={(draft.fieldResolutions[field.fieldPath] ?? field.defaultResolution) === 'local'}
                            label="此设备版本"
                            name={`${conflict.id}-${field.fieldPath}`}
                            onChange={() => updateFieldResolution(conflict.id, field.fieldPath, 'local')}
                            value={field.localValue}
                          />
                          <ConflictRadio
                            checked={(draft.fieldResolutions[field.fieldPath] ?? field.defaultResolution) === 'remote'}
                            label="账号版本"
                            name={`${conflict.id}-${field.fieldPath}`}
                            onChange={() => updateFieldResolution(conflict.id, field.fieldPath, 'remote')}
                            value={field.remoteValue}
                          />
                          {field.allowNotesMerge ? (
                            <ConflictRadio
                              checked={(draft.fieldResolutions[field.fieldPath] ?? field.defaultResolution) === 'merge_notes'}
                              label="合并两边备注"
                              name={`${conflict.id}-${field.fieldPath}`}
                              onChange={() => updateFieldResolution(conflict.id, field.fieldPath, 'merge_notes')}
                              value={`${formatConflictValue(field.localValue)}\n${formatConflictValue(field.remoteValue)}`}
                            />
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2 rounded-xl bg-amber-50 px-3 py-2">
                    <ConflictChoice
                      checked={(draft.deleteResolution ?? 'keep') === 'keep'}
                      label="保留对象版本"
                      name={`${conflict.id}-delete-resolution`}
                      onChange={() => updateDeleteResolution(conflict.id, 'keep')}
                    />
                    <ConflictChoice
                      checked={(draft.deleteResolution ?? 'keep') === 'delete'}
                      label="删除对象"
                      name={`${conflict.id}-delete-resolution`}
                      onChange={() => updateDeleteResolution(conflict.id, 'delete')}
                    />
                  </div>
                )}

                <Button
                  className="w-full text-xs"
                  icon={<AlertTriangle className="size-4" />}
                  onClick={() => setApplyTarget(conflict)}
                  variant="secondary"
                >
                  应用解决方案
                </Button>
              </article>
            )
          })}
        </div>
      ))}

      <ConfirmDialog
        body="将按当前选择写入此设备，并把结果加入同步队列。确认前不会改动本地数据，也不会推送账号数据。"
        confirmLabel="确认应用"
        icon={<GitMerge className="size-5" />}
        loading={isApplying}
        onCancel={() => {
          if (!isApplying) setApplyTarget(null)
        }}
        onConfirm={() => void handleApplyConfirmed()}
        open={Boolean(applyTarget)}
        testId="object-sync-conflict-confirm-dialog"
        title="应用冲突解决方案？"
      />
    </section>
  )

  function updateFieldResolution(
    conflictId: string,
    fieldPath: string,
    resolution: ObjectSyncConflictResolution,
  ) {
    setResolutions((current) => ({
      ...current,
      [conflictId]: {
        ...(current[conflictId] ?? { fieldResolutions: {} }),
        fieldResolutions: {
          ...(current[conflictId]?.fieldResolutions ?? {}),
          [fieldPath]: resolution,
        },
      },
    }))
  }

  function updateDeleteResolution(conflictId: string, resolution: 'delete' | 'keep') {
    setResolutions((current) => ({
      ...current,
      [conflictId]: {
        ...(current[conflictId] ?? { fieldResolutions: {} }),
        deleteResolution: resolution,
      },
    }))
  }
}

function ConflictRadio({
  checked,
  label,
  name,
  onChange,
  value,
}: {
  checked: boolean
  label: string
  name: string
  onChange: () => void
  value: unknown
}) {
  return (
    <label className="flex min-w-0 items-start gap-2 rounded-lg bg-white/80 px-2 py-2 text-xs">
      <input checked={checked} className="mt-1" name={name} onChange={onChange} type="radio" />
      <span className="min-w-0">
        <span className="font-semibold">{label}</span>
        <span className="mt-1 block whitespace-pre-wrap break-words leading-5 text-on-surface-variant [overflow-wrap:anywhere]">
          {formatConflictValue(value)}
        </span>
      </span>
    </label>
  )
}

function ConflictChoice({
  checked,
  label,
  name,
  onChange,
}: {
  checked: boolean
  label: string
  name: string
  onChange: () => void
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg bg-white/80 px-2 py-2 text-xs font-semibold">
      <input checked={checked} name={name} onChange={onChange} type="radio" />
      <span>{label}</span>
    </label>
  )
}

function buildDefaultResolution(conflict: ObjectSyncConflict): ConflictResolutionDraft {
  if (conflict.conflictType !== 'field_conflict') {
    return { deleteResolution: 'keep', fieldResolutions: {} }
  }
  return {
    fieldResolutions: conflict.fields.reduce<Record<string, ObjectSyncConflictResolution>>((next, field) => {
      next[field.fieldPath] = field.defaultResolution
      return next
    }, {}),
  }
}
