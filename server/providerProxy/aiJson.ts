export function extractJsonFromAiText(rawText: string): unknown | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null

  const direct = tryParseJson(trimmed)
  if (direct !== null) return direct

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1].trim())
    if (parsed !== null) return parsed
  }

  const firstObject = trimmed.indexOf('{')
  const lastObject = trimmed.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) {
    const parsed = tryParseJson(trimmed.slice(firstObject, lastObject + 1))
    if (parsed !== null) return parsed
  }

  return null
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
