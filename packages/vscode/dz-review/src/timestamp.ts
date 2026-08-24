/**
 * Re-export rather than a copy: this file used to duplicate the whole
 * timestamp codec, and the duplicate silently kept the base-2048 Hangul layout
 * when the CLI moved to 8192 — a hover would have rendered a year-2876 date.
 * The extension already imports other modules from ../../../tools, so there is
 * no packaging reason to fork this one.
 */

export {
  decodeCompactTimestamp,
  decodeHangulTimestamp,
  encodeCompactTimestamp,
  encodeHangulTimestamp,
  encodeTimestamp,
  formatTimestampForDisplay,
  getLocalOffsetMinutes,
  parseReviewTimestamp,
  type ReviewTimestamp,
  type TimestampFormat,
} from "../../../tools/dz-review/timestamp";
