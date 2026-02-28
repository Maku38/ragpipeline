require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase, getSystemContext } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// csis-backend/server.js

app.get('/api/schedule', async (req, res) => {
  // Fetch all approved and pending bookings
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('room_number, start_date, start_time, end_time, status')
    .neq('status', 'Rejected'); // Don't show rejected ones

  if (error) return res.status(500).json({ error: error.message });

  // Group bookings by date for easy frontend lookup
  const scheduleMap = {};
  bookings.forEach(b => {
    if (!scheduleMap[b.start_date]) scheduleMap[b.start_date] = [];
    scheduleMap[b.start_date].push(b);
  });

  res.json(scheduleMap);
});

// NEW ENDPOINT: Let the frontend fetch all current bookings
app.get('/api/bookings', async (req, res) => {
  const { data, error } = await supabase.from('bookings').select('*').order('id', { ascending: false });
  if (error) {
    console.error("❌ SUPABASE ERROR:", error); // <-- This will print the exact issue!
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// AI Chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, currentBookings, role } = req.body;

    const activeBookingsStr = currentBookings && currentBookings.length > 0 
      ? currentBookings.map(b => `- ID: ${b.booking_id}, Room: ${b.room_number}, Date: ${b.start_date}, Time: ${b.start_time}-${b.end_time}, Status: ${b.status}`).join('\n')
      : "User has no active bookings.";

    // 💡 AWAIT the live Supabase context!
    const liveSystemContext = await getSystemContext();

    // Calculate semester end (5 months from today)
    const today = new Date();
    const semEnd = new Date();
    semEnd.setMonth(today.getMonth() + 5);
    const semEndStr = semEnd.toISOString().split("T")[0];

    const systemPrompt = `You are a smart booking assistant for the CSIS department.
Today's date is ${today.toISOString().split("T")[0]}.
CURRENT SEMESTER RANGE: Now until ${semEndStr}.

SYSTEM CONTEXT (LIVE DB):
${liveSystemContext}

USER INFO:
- Current Role: ${role.toUpperCase()}
- Active Session Bookings: ${activeBookingsStr}

POLICIES:
1. SEMESTER LIMIT: Users can ONLY book rooms between today and ${semEndStr}. Reject any dates outside this 5-month window.
2. ROLE RULES: Students (Pending/Email CSA), Teachers (Approved), Admin (Override/Cancel all).

YOUR JOB:
1. Verify requested dates are within the semester range (${today.toISOString().split("T")[0]} to ${semEndStr}).
2. Check for overlaps in the schedule.
3. Output strict JSON.

OUTPUT FORMAT:
{
  "intent": "BOOK" | "CANCEL" | "INQUIRY",
  "bookings": [...],
  "cancellations": [...],
  "assistant_message": "Your conversational reply. If a date is outside the semester, explain the 5-month policy."
}`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemPrompt });

    let formattedHistory = history.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
    while (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') formattedHistory.shift();

    // ... previous code above ...

    // 💡 FIX 1: Add responseMimeType to FORCE Gemini to output valid JSON
    const chat = model.startChat({
      history: formattedHistory,
      generationConfig: { 
        temperature: 0.1,
        responseMimeType: "application/json" 
      }
    });

    const result = await chat.sendMessage(message);
    const rawText = result.response.text();
    
    let parsedData;
    try {
      // Clean markdown formatting just in case
      const cleanJson = rawText.replace(/```json|```/gi, "").trim();
      parsedData = JSON.parse(cleanJson);
    } catch (parseError) {
      // 💡 FIX 2: If parsing fails, DO NOT CRASH! Fallback gracefully.
      console.warn("⚠️ Gemini returned invalid JSON. Falling back to plain text handling.");
      parsedData = {
        intent: "INQUIRY",
        bookings: [],
        cancellations: [],
        assistant_message: rawText // Just send whatever Gemini said directly to the user
      };
    }

    // 💡 MOCK EMAIL TRIGGER: If a student successfully requests a room
    if (role === 'student' && parsedData.intent === 'BOOK' && parsedData.bookings?.length > 0) {
      console.log(`\n📧 [EMAIL DISPATCHED] To: csa@college.edu | Subject: New Room Request Pending`);
      console.log(`Body: A student has requested Room ${parsedData.bookings[0].room_number}. Please review.\n`);
    }

    // 💡 DATABASE WRITES (Execute AI intents in Supabase)
    // ... rest of your code below ...

    // 💡 DATABASE WRITES (Execute AI intents in Supabase)
    if (parsedData.intent === 'BOOK' && parsedData.bookings?.length > 0) {
      for (const bk of parsedData.bookings) {
        // Generate a random ID like BK-XYZ12
        const genId = "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();
        await supabase.from('bookings').insert([{
          booking_id: genId,
          room_number: bk.room_number,
          start_date: bk.start_date,
          start_time: bk.start_time,
          end_time: bk.end_time,
          status: bk.status || (role === 'student' ? 'Pending' : 'Approved'),
          owner_role: role
        }]);
      }
    }

    if (parsedData.intent === 'CANCEL' && parsedData.cancellations?.length > 0) {
      for (const cx of parsedData.cancellations) {
        await supabase.from('bookings')
          .delete()
          .ilike('room_number', cx.room_number)
          .eq('start_date', cx.date);
      }
    }

    res.json(parsedData);

  } catch (error) {
    console.error("❌ Backend Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 DB Backend running on http://localhost:${PORT}`));