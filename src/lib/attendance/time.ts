import { errorFactory } from '../errors';

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeDateBoundary(dateFrom?: string, dateTo?: string): {
  fromIso?: string;
  toIso?: string;
} {
  const fromIso = dateFrom
    ? (isDateOnly(dateFrom) ? `${dateFrom}T00:00:00.000Z` : new Date(dateFrom).toISOString())
    : undefined;

  const toIso = dateTo
    ? (isDateOnly(dateTo) ? `${dateTo}T23:59:59.999Z` : new Date(dateTo).toISOString())
    : undefined;

  if (fromIso && Number.isNaN(new Date(fromIso).getTime())) {
    throw errorFactory.badRequest('INVALID_DATE_FROM', 'date_from is invalid');
  }

  if (toIso && Number.isNaN(new Date(toIso).getTime())) {
    throw errorFactory.badRequest('INVALID_DATE_TO', 'date_to is invalid');
  }

  return { fromIso, toIso };
}

export function getDayRangeUtc(dateValue: string): { dayStart: Date; dayEnd: Date } {
  if (!isDateOnly(dateValue)) {
    throw errorFactory.badRequest('INVALID_DATE', 'date must be YYYY-MM-DD');
  }

  const dayStart = new Date(`${dateValue}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateValue}T23:59:59.999Z`);
  return { dayStart, dayEnd };
}

export function toIsoOrThrow(value: string, code = 'INVALID_DATETIME'): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw errorFactory.badRequest(code, `${code} format is invalid`);
  }
  return d.toISOString();
}

export function monthRange(dateIso: string): { startIso: string; endIso: string } {
  const d = new Date(dateIso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function secondsDiff(laterIso: string, earlierIso: string): number {
  return Math.floor((new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / 1000);
}
