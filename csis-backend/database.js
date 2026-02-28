// csis-backend/database.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function getSystemContext() {
  // Fetch live rooms and bookings from Supabase
  const { data: rooms } = await supabase.from('rooms').select('*');
  const { data: bookings } = await supabase.from('bookings').select('*');

  const roomsStr = rooms.map(r => `- ${r.room_id} (${r.name}): ${r.type}, Seats: ${r.capacity}, Features: ${r.features.join(", ")}`).join("\n");
  const bookingsStr = bookings.map(b => `- ${b.room_number} is booked on ${b.start_date} from ${b.start_time} to ${b.end_time} (Status: ${b.status})`).join("\n");
  
  return `AVAILABLE RESOURCES:\n${roomsStr}\n\nCURRENT SCHEDULE:\n${bookingsStr}`;
}

module.exports = { supabase, getSystemContext };