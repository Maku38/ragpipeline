# CSIS ResourceBook Setup & Running Guide

## ✅ Current Setup Summary

All code has been unified and made compatible with the **Groq API** backend and **Real-time SSE streaming**.

### What Changed:
1. **Backend (`csis-backend/server.js`)**
   - Switched from Gemini API to **Groq API** (`groq-sdk`)
   - Added `/api/rooms` endpoint to fetch available rooms from Supabase
   - Added `/api/bookings/stream` endpoint for **Server-Sent Events (SSE)** real-time updates
   - Added `broadcastToClients()` function to push booking changes to all connected frontend clients
   - Integrated hardcoded conflict checking with AI flow

2. **Backend Dependencies (`csis-backend/package.json`)**
   - ✅ Removed: `@google/generative-ai` (Gemini)
   - ✅ Added: `groq-sdk` (Groq API)

3. **Backend Environment (`csis-backend/.env`)**
   - ✅ Changed: `GEMINI_API_KEY` → `GROQ_API_KEY`
   - ⚠️ TODO: Add your actual Groq API key (currently placeholder)

4. **Frontend (`frontend/src/App.jsx`)**
   - ✅ Fixed React hooks violation (moved all hooks to top, before conditional return)
   - ✅ Added room fetching from backend via `/api/rooms`
   - ✅ Properly integrated with `useRealtimeBookings` hook for SSE streaming

5. **Database (`csis-backend/database.js`)**
   - ✅ Made `getSystemContext()` robust against null values and missing fields
   - ✅ Better error handling for Supabase fetches

---

## 🚀 Running the Application

### Prerequisites:
- Node.js 16+ installed
- Groq API key (https://console.groq.com)
- Supabase account with `rooms` and `bookings` tables

### Step 1: Configure Groq API Key
Edit `csis-backend/.env`:
```env
GROQ_API_KEY=your_actual_groq_api_key_here
```

### Step 2: Start Backend Server
```bash
cd csis-backend
npm install  # if not already done
npm start    # or: node server.js
```

Expected output:
```
✅ Groq client initialized successfully
🚀 Server running on http://localhost:5000
📡 Backend ready to accept /api/chat requests
```

### Step 3: Start Frontend Dev Server (New Terminal)
```bash
cd frontend
npm install  # if not already done
npm run dev
```

Expected output:
```
VITE v7.3.1  ready in 156 ms
➜  Local:   http://localhost:5173/
```

### Step 4: Access the App
Open **http://localhost:5173** in your browser.

---

## 📡 API Endpoints (Backend)

### GET `/api/rooms`
**Description:** Fetch all available room names from Supabase.

**Response:**
```json
{
  "rooms": ["CSIS-101", "CSIS-204", "CSIS-301"]
}
```

### GET `/api/bookings`
**Description:** Fetch all bookings with full details.

**Response:**
```json
[
  {
    "booking_id": "BK-ABC12",
    "room_number": "CSIS-101",
    "start_date": "2026-03-05",
    "start_time": "09:00",
    "end_time": "11:00",
    "status": "Approved",
    "owner_role": "teacher"
  },
  ...
]
```

### GET `/api/schedule`
**Description:** Fetch bookings grouped by date for calendar view.

**Response:**
```json
{
  "2026-03-05": [
    { "room_number": "CSIS-101", "start_time": "09:00", "end_time": "11:00", "status": "Approved" }
  ],
  "2026-03-06": [...]
}
```

### GET `/api/bookings/stream` (SSE)
**Description:** Real-time event stream for booking changes.

**Event Types:**
- `connected` - Connection established
- `booking_change` - New, updated, or deleted booking
- Heartbeat every 25 seconds

**Frontend consumes via `useRealtimeBookings()` hook.**

### POST `/api/chat`
**Description:** AI booking assistant endpoint.

**Request:**
```json
{
  "message": "Book CSIS-101 tomorrow from 9am to 11am",
  "history": [{"role": "user", "content": "..."}, ...],
  "currentBookings": [...],
  "role": "student"
}
```

**Response:**
```json
{
  "intent": "BOOK",
  "bookings": [
    {
      "room_number": "CSIS-101",
      "start_date": "2026-03-05",
      "start_time": "09:00",
      "end_time": "11:00",
      "status": "Pending"
    }
  ],
  "cancellations": [],
  "assistant_message": "✅ I've requested CSIS-101 for tomorrow from 9:00 AM to 11:00 AM. Your booking is pending CSA approval."
}
```

---

## 🔄 Data Flow

```
┌─────────────┐
│   Browser   │
│ (React App) │
└──────┬──────┘
       │
       │ HTTP Requests
       │ + SSE Connection
       │
       ▼
┌──────────────────────┐
│  Backend (Express)   │
│ - /api/rooms         │
│ - /api/bookings      │
│ - /api/bookings/stream (SSE)
│ - /api/chat          │
└──────┬───────────────┘
       │
       │ Supabase Client
       │
       ▼
┌──────────────────────┐
│  Supabase Cloud DB   │
│ - rooms table        │
│ - bookings table     │
└──────────────────────┘

Booking Flow:
User Input → AI Extraction → Conflict Check → DB Insert → SSE Broadcast → Frontend Update
```

---

## 🛠️ Troubleshooting

### Backend won't start
```bash
# Check if port 5000 is in use
lsof -i :5000

# Check Groq API key
cat csis-backend/.env | grep GROQ_API_KEY
```

### Frontend shows "Failed to fetch rooms"
- Verify backend is running on `:5000`
- Check browser console (F12) for network errors
- Verify `/api/rooms` returns valid JSON

### SSE not connecting
- Check if backend has SSE endpoint running
- Verify no proxies/firewalls blocking EventSource
- Check browser console for errors

### Bookings not real-time updating
- Verify `/api/bookings/stream` is connected
- Check backend logs for SSE broadcast messages
- Try hard-refresh (Ctrl+F5) to reset connections

---

## 📋 Checklist Before Going Live

- [ ] Add real Groq API key to `.env`
- [ ] Verify Supabase `rooms` table has data
- [ ] Test face login with actual webcam
- [ ] Test booking creation via chat
- [ ] Test real-time updates (multiple browser tabs)
- [ ] Test cancellation flow
- [ ] Verify conflict detection blocks overlapping bookings
- [ ] Check email notification setup for student requests
- [ ] Deploy frontend build: `npm run build`
- [ ] Configure backend for production (HTTPS, proper CORS, etc.)

---

## 📞 Support

For issues, check:
1. Backend logs: `csis-backend/backend.log`
2. Frontend console: Browser DevTools (F12)
3. Network tab: HTTP requests and responses
4. SSE status: Check `useRealtimeBookings.js` debug logs

