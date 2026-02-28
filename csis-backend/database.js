// csis-backend/database.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function getSystemContext() {
  // Fetch live rooms and bookings from Supabase with robust error handling
  let rooms = [];
  let bookings = [];

  try {
    const { data: roomsData, error: roomsError } = await supabase.from('rooms').select('*');
    if (roomsError) {
      console.error('❌ Error fetching rooms from Supabase:', roomsError);
    } else if (Array.isArray(roomsData)) {
      rooms = roomsData;
    } else {
      console.warn('⚠️ Unexpected rooms response from Supabase, expected array:', roomsData);
    }
  } catch (e) {
    console.error('❌ Exception while fetching rooms:', e);
  }

  try {
    const { data: bookingsData, error: bookingsError } = await supabase.from('bookings').select('*');
    if (bookingsError) {
      console.error('❌ Error fetching bookings from Supabase:', bookingsError);
    } else if (Array.isArray(bookingsData)) {
      bookings = bookingsData;
    } else {
      console.warn('⚠️ Unexpected bookings response from Supabase, expected array:', bookingsData);
    }
  } catch (e) {
    console.error('❌ Exception while fetching bookings:', e);
  }

  // Safely format rooms and bookings into text
  const roomsStr = (rooms || []).map(r => {
    const roomId = r.room_id ?? r.id ?? r.room_number ?? 'UNKNOWN_ROOM_ID';
    const name = r.name ?? '';
    const type = r.type ?? '';
    const capacity = r.capacity ?? '';
    const features = Array.isArray(r.features) ? r.features.join(', ') : (r.features ? String(r.features) : '');
    return `- ${roomId} ${name ? `(${name})` : ''}: ${type}${capacity ? `, Seats: ${capacity}` : ''}${features ? `, Features: ${features}` : ''}`;
  }).join('\n');

  const bookingsStr = (bookings || []).map(b => {
    const room = b.room_number ?? b.room_id ?? b.room ?? 'UNKNOWN_ROOM';
    const date = b.start_date ?? b.date ?? 'UNKNOWN_DATE';
    const start = b.start_time ?? b.start ?? '??:??';
    const end = b.end_time ?? b.end ?? '??:??';
    const status = b.status ?? 'UNKNOWN_STATUS';
    return `- ${room} is booked on ${date} from ${start} to ${end} (Status: ${status})`;
  }).join('\n');
  
  return `AVAILABLE RESOURCES:\n${roomsStr || '(none)'}\n\nCURRENT SCHEDULE:\n${bookingsStr || '(none)'}`;
}

module.exports = { supabase, getSystemContext };