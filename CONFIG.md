# Configuration Checklist

## Backend Configuration

### 1. Environment Variables (`csis-backend/.env`)
```env
PORT=5000
GROQ_API_KEY=your_groq_api_key_here
SUPABASE_URL=https://hgxohdvihpwygchjakdr.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**⚠️ REQUIRED:** Get your Groq API key from https://console.groq.com

### 2. Dependencies
```bash
# Backend uses:
- express (HTTP server)
- cors (cross-origin requests)
- groq-sdk (AI API client)
- @supabase/supabase-js (database client)
- dotenv (environment variables)
```

### 3. Key Files
- `server.js` - Main Express server with all endpoints
- `database.js` - Supabase client & system context builder
- `conflictChecker.js` - Hardcoded booking conflict validation
- `package.json` - Dependencies (updated: Groq instead of Gemini)

---

## Frontend Configuration

### 1. Dependencies
```bash
# Frontend uses:
- react (UI framework)
- react-dom (React DOM renderer)
- react-calendar (date picker)
- react-webcam (camera access)
- face-api.js (face recognition)
- vite (build tool)
```

### 2. Key Files
- `App.jsx` - Main app component with chat & calendar
- `FaceLogin.jsx` - Face recognition login
- `useRealtimeBookings.js` - SSE hook for real-time data
- `booking-gemini.jsx` - Legacy booking component (can be removed)

### 3. Environment
```bash
# API endpoints (hardcoded in frontend):
- http://localhost:5000/api/rooms
- http://localhost:5000/api/bookings
- http://localhost:5000/api/bookings/stream (SSE)
- http://localhost:5000/api/chat
- http://localhost:5000/api/schedule
```

---

## Database Configuration (Supabase)

### Required Tables

#### `rooms` Table
```sql
CREATE TABLE rooms (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT,
  capacity INTEGER,
  features TEXT[] DEFAULT '{}'::TEXT[]
);
```

#### `bookings` Table
```sql
CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE,
  room_number TEXT NOT NULL,
  start_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT DEFAULT 'Pending',
  owner_role TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Port Configuration

| Service | Port | URL |
|---------|------|-----|
| Backend | 5000 | http://localhost:5000 |
| Frontend | 5173 | http://localhost:5173 |

**If you want to change ports:**
- Backend: Edit `PORT` in `csis-backend/.env`
- Frontend: Edit `vite.config.js` or use `npm run dev -- --port 3000`
- Frontend API calls: Update `http://localhost:5000` in code

---

## Feature Breakdown

### ✅ Implemented
- [x] Face recognition login (FaceLogin.jsx)
- [x] Real-time booking dashboard (SSE streaming)
- [x] AI chat assistant (Groq API)
- [x] Conflict detection (hardcoded logic)
- [x] Role-based access (student/teacher/admin)
- [x] Calendar view with bookings
- [x] Room availability display

### 🔄 Needs Configuration
- [ ] Groq API key in `.env`
- [ ] Supabase `rooms` table population
- [ ] Email notifications for pending requests
- [ ] HTTPS/SSL for production
- [ ] CORS domain whitelist

### 📋 Optional Enhancements
- [ ] Database: Add user authentication
- [ ] Backend: Add request logging/monitoring
- [ ] Frontend: Improve error handling UI
- [ ] Frontend: Add dark mode toggle
- [ ] Backend: Add email service integration
- [ ] Frontend: Add PDF export for bookings

---

## Quick Start Summary

```bash
# Terminal 1: Start Backend
cd csis-backend
npm install
npm start

# Terminal 2: Start Frontend
cd frontend
npm install
npm run dev

# Terminal 3: Access App
# Open http://localhost:5173 in browser
```

Expected startup logs:
```
Backend: ✅ Groq client initialized
Backend: 🚀 Server running on http://localhost:5000

Frontend: VITE ready
Frontend: ➜ Local: http://localhost:5173/
```

---

## Important Notes

1. **Face Recognition Models**: Downloaded from jsDelivr CDN (https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights)
2. **Reference Photos**: Must be in `public/faces/` (admin.jpeg, teacher.jpeg, student.jpeg)
3. **Groq API**: Free tier includes limited requests. Monitor usage at https://console.groq.com
4. **Supabase Realtime**: The SSE endpoint provides push updates without polling
5. **Conflict Check**: Hardcoded logic prevents overlapping bookings (no AI override)

