export interface CssPropertySuggestion {
  label: string
  value: string
}

export function suggestCssProperties(
  properties: readonly string[],
  input: string,
): CssPropertySuggestion[] {
  const query = input.trim().toLowerCase()
  if (query.startsWith('--')) return []
  return [...new Set(properties.map(property => property.toLowerCase()))]
    .sort()
    .filter(property => property.startsWith(query) && property !== query)
    .map(property => ({ label: property, value: property }))
}
