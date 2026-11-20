import { encodeTimestamp, type TimestampFormat } from "./critique";

/**
 * Offset of the host time zone at `date`, in minutes east of UTC. It stays in
 * JS: the core has no clock nor time zone database.
 */
export function getLocalOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset();
}

/** `date` in the host's local offset, rendered in `format`. */
export function encodeDate(date: Date, format: TimestampFormat): string {
  return encodeTimestamp({
    unixSeconds: Math.floor(date.getTime() / 1000),
    offsetMinutes: getLocalOffsetMinutes(date),
  }, format);
}
