import { CSIS_ROOMS, CURRENT_BOOKINGS } from '../../csis-backend/database.js';

// This function acts as the "Retriever" in your RAG pipeline
export function getSystemContext() {
  const roomsStr = CSIS_ROOMS.map(r => 
    `- ${r.room_id} (${r.name}): ${r.type}, Seats: ${r.capacity}, Features: ${r.features.join(", ")}`
  ).join("\n");

  const bookingsStr = CURRENT_BOOKINGS.map(b => 
    `- ${b.room_id} is booked on ${b.date} from ${b.start_time} to ${b.end_time}`
  ).join("\n");

  return `
AVAILABLE RESOURCES (KNOWLEDGE BASE):
${roomsStr}

CURRENT SCHEDULE/UNAVAILABLE SLOTS:
${bookingsStr}
  `;
}