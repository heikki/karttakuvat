import { describe, expect, test } from 'bun:test';

import {
  tzNameFromCoords,
  tzOffsetFromCoords,
  tzOffsetFromTzName
} from './timezone';

describe('tzNameFromCoords', () => {
  test('returns IANA name for a known coordinate', () => {
    // Helsinki, Finland
    expect(tzNameFromCoords(60.17, 24.94)).toBe('Europe/Helsinki');
  });

  test('uses geo-tz/all dataset (Iceland gets Atlantic/Reykjavik, not Africa/Abidjan)', () => {
    expect(tzNameFromCoords(64.13, -21.94)).toBe('Atlantic/Reykjavik');
  });
});

describe('tzOffsetFromTzName', () => {
  test('returns DST-aware offset for Europe/Helsinki in summer', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', '2024:07:01 12:00:00')).toBe(
      '+03:00'
    );
  });

  test('returns DST-aware offset for Europe/Helsinki in winter', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', '2024:01:15 12:00:00')).toBe(
      '+02:00'
    );
  });

  test('returns +00:00 for UTC', () => {
    expect(tzOffsetFromTzName('UTC', '2024:06:01 12:00:00')).toBe('+00:00');
  });

  test('returns negative offset for western timezones', () => {
    // New York, summer (EDT)
    expect(tzOffsetFromTzName('America/New_York', '2024:07:01 12:00:00')).toBe(
      '-04:00'
    );
  });

  test('handles timezones with non-zero minutes', () => {
    // India is UTC+05:30 year-round
    expect(tzOffsetFromTzName('Asia/Kolkata', '2024:06:01 12:00:00')).toBe(
      '+05:30'
    );
  });

  test('returns null for malformed date string', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', 'not a date')).toBeNull();
  });

  test('returns null for empty date string', () => {
    expect(tzOffsetFromTzName('Europe/Helsinki', '')).toBeNull();
  });

  test('returns null for invalid timezone name', () => {
    expect(
      tzOffsetFromTzName('Not/A/Real/Zone', '2024:06:01 12:00:00')
    ).toBeNull();
  });
});

describe('tzOffsetFromCoords', () => {
  test('composes name lookup with offset resolution', () => {
    // Helsinki in winter
    expect(tzOffsetFromCoords(60.17, 24.94, '2024:01:15 12:00:00')).toBe(
      '+02:00'
    );
    // Helsinki in summer (DST)
    expect(tzOffsetFromCoords(60.17, 24.94, '2024:07:01 12:00:00')).toBe(
      '+03:00'
    );
  });

  test('returns null for empty date string', () => {
    expect(tzOffsetFromCoords(60.17, 24.94, '')).toBeNull();
  });
});
