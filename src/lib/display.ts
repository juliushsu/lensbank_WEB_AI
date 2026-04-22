export function pickName(record: Record<string, unknown> | null | undefined): string {
  if (!record) {
    return '';
  }

  const candidates = ['name', 'name_zh', 'name_ja', 'full_name', 'display_name', 'title'];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  const id = record.id;
  return typeof id === 'string' ? id : '';
}

export function pickLocationName(record: Record<string, unknown> | null | undefined): string {
  if (!record) {
    return '';
  }

  const candidates = ['name_zh', 'name_ja', 'name', 'display_name', 'title'];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  const id = record.id;
  return typeof id === 'string' ? id : '';
}
