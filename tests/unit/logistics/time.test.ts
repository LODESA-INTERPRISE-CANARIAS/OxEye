import {describe, expect, it} from 'vitest';
import {
  addDays,
  instantsToSlot,
  isLocalDate,
  isLocalTime,
  isTimeZone,
  localToUtc,
  offsetMinutes,
  slotToInstants,
  utcToLocal,
} from '../../../shared/logistics/time';

describe('logistics time · Atlantic/Canary', () => {
  it('winter (WET, UTC+0) keeps the wall-clock hour', () => {
    expect(localToUtc('2026-12-02', '09:00')).toBe('2026-12-02T09:00:00.000Z');
    expect(utcToLocal('2026-12-02T09:00:00.000Z')).toEqual({
      date: '2026-12-02',
      time: '09:00',
    });
  });

  it('summer (WEST, UTC+1) subtracts one hour', () => {
    expect(localToUtc('2026-07-15', '10:30')).toBe('2026-07-15T09:30:00.000Z');
    expect(utcToLocal('2026-07-15T09:30:00.000Z')).toEqual({
      date: '2026-07-15',
      time: '10:30',
    });
    expect(
      offsetMinutes(Date.parse('2026-07-15T09:30:00Z'), 'Atlantic/Canary'),
    ).toBe(60);
  });

  it('spring-forward gap (2026-03-29 01:30 does not exist) resolves forward', () => {
    expect(localToUtc('2026-03-29', '01:30')).toBe('2026-03-29T01:30:00.000Z');
    expect(utcToLocal('2026-03-29T01:30:00.000Z').time).toBe('02:30');
  });

  it('fall-back overlap (2026-10-25 01:30 happens twice) picks summer time', () => {
    expect(localToUtc('2026-10-25', '01:30')).toBe('2026-10-25T00:30:00.000Z');
  });

  it('other zones work (Europe/Madrid winter is UTC+1)', () => {
    expect(localToUtc('2026-12-02', '09:00', 'Europe/Madrid')).toBe(
      '2026-12-02T08:00:00.000Z',
    );
  });

  it('slots: missing parts stay null and overnight slots end next day', () => {
    expect(slotToInstants(null, '09:00', '14:00')).toEqual({
      startsAt: null,
      endsAt: null,
    });
    expect(slotToInstants('2026-12-02', null, null)).toEqual({
      startsAt: null,
      endsAt: null,
    });
    expect(slotToInstants('2026-12-02', '09:00', '14:00')).toEqual({
      startsAt: '2026-12-02T09:00:00.000Z',
      endsAt: '2026-12-02T14:00:00.000Z',
    });
    expect(slotToInstants('2026-12-02', '22:00', '02:00').endsAt).toBe(
      '2026-12-03T02:00:00.000Z',
    );
  });

  it('round-trips a slot for editing', () => {
    const s = slotToInstants('2026-07-15', '18:00', '23:30');
    expect(instantsToSlot(s.startsAt, s.endsAt)).toEqual({
      date: '2026-07-15',
      startTime: '18:00',
      endTime: '23:30',
    });
    expect(instantsToSlot(null, null)).toEqual({
      date: null,
      startTime: null,
      endTime: null,
    });
  });

  it('validates inputs', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-1-2')).toBe(false);
    expect(isLocalTime('24:00')).toBe(false);
    expect(isLocalTime('07:05')).toBe(true);
    expect(isTimeZone('Atlantic/Canary')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(() => localToUtc('2026-13-01', '09:00')).toThrow(RangeError);
  });
});
