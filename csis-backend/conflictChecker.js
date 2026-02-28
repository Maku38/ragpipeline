// conflictChecker.js
// Pure hardcoded logic — zero AI involved.
// Runs BEFORE Gemini so the AI always gets a definitive VALID/CONFLICT verdict.

/**
 * Converts "HH:MM" time string to total minutes from midnight.
 * Used for overlap math.
 */
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Core overlap check: do two time ranges intersect?
 * Returns true if they overlap (conflict).
 * Touching edges (e.g. 09:00-10:00 and 10:00-11:00) are NOT a conflict.
 */
function timesOverlap(startA, endA, startB, endB) {
  const s1 = toMinutes(startA);
  const e1 = toMinutes(endA);
  const s2 = toMinutes(startB);
  const e2 = toMinutes(endB);
  if (s1 === null || e1 === null || s2 === null || e2 === null) return false;
  // Overlap if s1 < e2 AND s2 < e1 (strict inequality = touching is fine)
  return s1 < e2 && s2 < e1;
}

/**
 * Validates a single proposed booking against all existing DB bookings.
 *
 * @param {object} supabase  - Supabase client
 * @param {object} proposed  - { room_number, start_date, start_time, end_time }
 * @returns {object} { valid: bool, conflicts: [], reasons: [] }
 */
async function checkBookingConflict(supabase, proposed) {
  const { room_number, start_date, start_time, end_time } = proposed;
  const result = { valid: true, conflicts: [], reasons: [] };

  // ── 1. Basic sanity checks (hardcoded rules) ──────────────────────────────

  // Must have all fields
  if (!room_number || !start_date || !start_time || !end_time) {
    result.valid = false;
    result.reasons.push('Missing required fields: room, date, start time, or end time.');
    return result;
  }

  // start must be before end
  if (toMinutes(start_time) >= toMinutes(end_time)) {
    result.valid = false;
    result.reasons.push(`Invalid time range: ${start_time} is not before ${end_time}.`);
    return result;
  }

  // Must not book in the past
  const today = new Date().toISOString().split('T')[0];
  if (start_date < today) {
    result.valid = false;
    result.reasons.push(`Cannot book in the past. Requested date: ${start_date}, today is ${today}.`);
    return result;
  }

  // Business hours: 07:00 – 22:00
  const OPEN = toMinutes('07:00');
  const CLOSE = toMinutes('22:00');
  if (toMinutes(start_time) < OPEN || toMinutes(end_time) > CLOSE) {
    result.valid = false;
    result.reasons.push(`Bookings must be within operating hours (07:00 – 22:00). Requested: ${start_time}–${end_time}.`);
    return result;
  }

  // Max single booking duration: 4 hours
  const durationMins = toMinutes(end_time) - toMinutes(start_time);
  if (durationMins > 240) {
    result.valid = false;
    result.reasons.push(`Maximum booking duration is 4 hours. Requested duration: ${durationMins / 60} hours.`);
    return result;
  }

  // ── 2. Live DB conflict check (hardcoded query + overlap math) ─────────────

  // Fetch all non-rejected bookings for this room on this date
  const { data: existing, error } = await supabase
    .from('bookings')
    .select('booking_id, room_number, start_date, start_time, end_time, status, owner_role')
    .eq('room_number', room_number)
    .eq('start_date', start_date)
    .neq('status', 'Rejected');

  if (error) {
    // DB error — fail safe (block the booking, don't silently allow it)
    result.valid = false;
    result.reasons.push(`Could not verify room availability due to a database error: ${error.message}`);
    return result;
  }

  // Check each existing booking for time overlap
  for (const bk of existing) {
    if (timesOverlap(start_time, end_time, bk.start_time, bk.end_time)) {
      result.valid = false;
      result.conflicts.push({
        booking_id: bk.booking_id,
        room_number: bk.room_number,
        date: bk.start_date,
        time: `${bk.start_time}–${bk.end_time}`,
        status: bk.status,
        held_by: bk.owner_role,
      });
      result.reasons.push(
        `Room ${room_number} is already ${bk.status.toLowerCase()} from ${bk.start_time}–${bk.end_time} on ${start_date} (Booking ID: ${bk.booking_id}).`
      );
    }
  }

  return result;
}

/**
 * Tries to extract booking details from the AI's parsed output.
 * Returns an array of proposed bookings (may be empty if AI didn't parse any).
 */
function extractProposedBookings(parsedData) {
  if (!parsedData || parsedData.intent !== 'BOOK') return [];
  return (parsedData.bookings || []).filter(
    b => b.room_number && b.start_date && b.start_time && b.end_time
  );
}

module.exports = { checkBookingConflict, extractProposedBookings, timesOverlap, toMinutes };
