/** FR-9: детерминированная эвристика «нужен ли diff» — по ключевым словам вопроса. */
const DIFF_HINT_PATTERN
  = /\bdiff\b|изменени|ветк|\b(?:branch|commit|git|pr)\b|\bmerge\b|коммит/i

/** Совпадение хотя бы одного ключа → дополнительно вызвать git_diff(maxLines = 200). */
export function wantsDiff(question: string): boolean {
  return DIFF_HINT_PATTERN.test(question)
}
