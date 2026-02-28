require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase, getSystemContext } = require('./database');
const { checkBookingConflict, extractProposedBookings } = require('./conflictChecker');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schedule  — grouped by date for the calendar view
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/schedule', async (req, res) => {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('room_number, start_date, start_time, end_time, status')
    .neq('status', 'Rejected');

  if (error) return res.status(500).json({ error: error.message });

  const scheduleMap = {};
  bookings.forEach(b => {
    if (!scheduleMap[b.start_date]) scheduleMap[b.start_date] = [];
    scheduleMap[b.start_date].push(b);
  });

  res.json(scheduleMap);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings  — all bookings for the dashboard
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/bookings', async (req, res) => {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    console.error("❌ SUPABASE ERROR:", error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat  — AI booking assistant with hardcoded pre-validation
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, currentBookings, role } = req.body;

    const today = new Date().toISOString().split('T')[0];
    const semEnd = new Date();
    semEnd.setMonth(new Date().getMonth() + 5);
    const semEndStr = semEnd.toISOString().split('T')[0];

    // ── STEP 1: Quick-parse the user message to check for booking intent ──────
    // We do a lightweight first-pass with Gemini ONLY to extract structured
    // booking details (room, date, time). This is intentionally separate from
    // the full conversational response so the conflict check can happen first.

    const extractModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `You are a data extractor. Today is ${today}.
Extract any room booking request from the user message.
If the message is a booking request, output ONLY valid JSON in this exact format:
{
  "is_booking_request": true,
  "bookings": [
    {
      "room_number": "CSIS-101",
      "start_date": "YYYY-MM-DD",
      "start_time": "HH:MM",
      "end_time": "HH:MM"
    }
  ]
}
If it is NOT a booking request (e.g. a question, cancellation, or chitchat), output:
{ "is_booking_request": false, "bookings": [] }
RULES:
- "tomorrow" = ${new Date(Date.now() + 86400000).toISOString().split('T')[0]}
- "next Monday" etc — calculate from today (${today})
- Use 24-hour time format (e.g. "08:00", "13:30")
- Output ONLY JSON. No explanation. No markdown.`
    });

    const extractChat = extractModel.startChat({
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    });

    let extractedData = { is_booking_request: false, bookings: [] };
    try {
      const extractResult = await extractChat.sendMessage(message);
      const raw = extractResult.response.text().replace(/```json|```/gi, '').trim();
      extractedData = JSON.parse(raw);
    } catch (e) {
      console.warn("⚠️ Extraction parse failed, assuming non-booking request:", e.message);
    }

    // ── STEP 2: HARDCODED CONFLICT CHECK (runs before full AI response) ───────
    // This is the source of truth. AI cannot override this.

    let conflictReport = null; // null means no conflict check was needed

    if (extractedData.is_booking_request && extractedData.bookings?.length > 0) {
      const allConflictResults = [];

      for (const proposed of extractedData.bookings) {
        const result = await checkBookingConflict(supabase, proposed);
        allConflictResults.push({ proposed, result });
      }

      const anyConflict = allConflictResults.some(r => !r.result.valid);

      if (anyConflict) {
        // Build a clear, structured conflict summary to inject into the AI prompt
        conflictReport = {
          has_conflict: true,
          details: allConflictResults.map(({ proposed, result }) => ({
            room: proposed.room_number,
            date: proposed.start_date,
            time: `${proposed.start_time}–${proposed.end_time}`,
            valid: result.valid,
            reasons: result.reasons,
            conflicting_bookings: result.conflicts,
          }))
        };
      } else {
        conflictReport = { has_conflict: false, details: allConflictResults.map(({ proposed }) => ({
          room: proposed.room_number,
          date: proposed.start_date,
          time: `${proposed.start_time}–${proposed.end_time}`,
          valid: true,
        }))};
      }
    }

    // ── STEP 3: Build the full AI prompt, injecting the conflict verdict ───────

    const activeBookingsStr = currentBookings?.length > 0
      ? currentBookings.map(b =>
          `- ID: ${b.booking_id}, Room: ${b.room_number}, Date: ${b.start_date}, Time: ${b.start_time}-${b.end_time}, Status: ${b.status}`
        ).join('\n')
      : "No active bookings.";

    const liveSystemContext = await getSystemContext();

    // Inject the conflict report as a definitive fact the AI MUST respect
    let conflictInstruction = '';
    if (conflictReport !== null) {
      if (conflictReport.has_conflict) {
        const details = conflictReport.details
          .filter(d => !d.valid)
          .map(d => `  • ${d.room} on ${d.date} at ${d.time}: ${d.reasons.join(' ')}`)
          .join('\n');

        conflictInstruction = `
⚠️ HARDCODED CONFLICT CHECK RESULT (THIS IS DEFINITIVE — YOU CANNOT OVERRIDE THIS):
THE FOLLOWING BOOKING(S) ARE BLOCKED:
${details}

INSTRUCTION: You MUST tell the user this booking is NOT possible. Explain the exact conflict clearly.
DO NOT proceed with the booking. Set intent to "CONFLICT" and bookings to [].
Suggest alternative times or rooms if you can infer them from the schedule.`;
      } else {
        const details = conflictReport.details
          .map(d => `  • ${d.room} on ${d.date} at ${d.time}: clear ✓`)
          .join('\n');

        conflictInstruction = `
✅ HARDCODED CONFLICT CHECK RESULT (THIS IS DEFINITIVE):
THE FOLLOWING BOOKING(S) ARE VERIFIED CLEAR — NO CONFLICTS FOUND:
${details}

INSTRUCTION: The booking is valid. Proceed with creating it.`;
      }
    }

    const systemPrompt = `You are a smart booking assistant for the CSIS department.
Today's date is ${today}.
CURRENT SEMESTER RANGE: Now until ${semEndStr}.

SYSTEM CONTEXT (LIVE DB):
${liveSystemContext}

USER INFO:
- Current Role: ${role.toUpperCase()}
- Active Session Bookings: ${activeBookingsStr}

${conflictInstruction}

POLICIES:
1. SEMESTER LIMIT: Only book between ${today} and ${semEndStr}. Reject dates outside this window.
2. ROLE RULES: Students → Pending status (CSA must approve). Teachers → Approved instantly. Admin → Full override.
3. CONFLICT RULE: NEVER book a room that has an overlapping approved or pending booking. The hardcoded check above is final.

OUTPUT FORMAT (strict JSON):
{
  "intent": "BOOK" | "CANCEL" | "INQUIRY" | "CONFLICT",
  "bookings": [{ "room_number": "...", "start_date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "status": "..." }],
  "cancellations": [{ "room_number": "...", "date": "YYYY-MM-DD" }],
  "assistant_message": "Your friendly, clear reply to the user. For conflicts, explain exactly what's blocking and suggest alternatives."
}`;

    // ── STEP 4: Full AI response ───────────────────────────────────────────────

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt
    });

    let formattedHistory = history
      .filter(m => m.role !== 'system')
      .slice(-10)
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
    while (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') {
      formattedHistory.shift();
    }

    const chat = model.startChat({
      history: formattedHistory,
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    });

    const result = await chat.sendMessage(message);
    const rawText = result.response.text();

    let parsedData;
    try {
      const cleanJson = rawText.replace(/```json|```/gi, '').trim();
      parsedData = JSON.parse(cleanJson);
    } catch (parseError) {
      console.warn("⚠️ Gemini returned invalid JSON, falling back.");
      parsedData = {
        intent: "INQUIRY",
        bookings: [],
        cancellations: [],
        assistant_message: rawText
      };
    }

    // ── STEP 5: FINAL SAFETY GATE ─────────────────────────────────────────────
    // Even if AI somehow says BOOK despite a conflict, we block it here.
    // The DB write only happens if the hardcoded check was clean.

    if (parsedData.intent === 'BOOK' && conflictReport?.has_conflict) {
      console.warn("🚨 SAFETY GATE: AI tried to book despite a conflict. Blocked.");
      parsedData.intent = 'CONFLICT';
      parsedData.bookings = [];
      if (!parsedData.assistant_message.toLowerCase().includes('conflict')) {
        parsedData.assistant_message =
          `Sorry, that booking isn't possible — there's already a booking in that slot. ` +
          conflictReport.details.filter(d => !d.valid).map(d => d.reasons.join(' ')).join(' ');
      }
    }

    // ── STEP 6: DB writes (only if everything is clean) ───────────────────────

    if (parsedData.intent === 'BOOK' && parsedData.bookings?.length > 0) {
      for (const bk of parsedData.bookings) {
        // One final per-insert conflict check before writing (belt and suspenders)
        const finalCheck = await checkBookingConflict(supabase, bk);
        if (!finalCheck.valid) {
          console.warn(`🚨 Final DB gate blocked insert for ${bk.room_number} on ${bk.start_date}`);
          continue; // Skip this booking
        }

        const genId = "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();
        const { error: insertError } = await supabase.from('bookings').insert([{
          booking_id: genId,
          room_number: bk.room_number,
          start_date: bk.start_date,
          start_time: bk.start_time,
          end_time: bk.end_time,
          status: bk.status || (role === 'student' ? 'Pending' : 'Approved'),
          owner_role: role
        }]);

        if (insertError) {
          console.error("❌ Insert error:", insertError);
        } else {
          console.log(`✅ Booking created: ${genId} — ${bk.room_number} on ${bk.start_date} ${bk.start_time}-${bk.end_time}`);
        }
      }

      // Mock email for student bookings
      if (role === 'student') {
        console.log(`\n📧 [EMAIL] To: csa@college.edu — New pending room request for ${parsedData.bookings[0]?.room_number}\n`);
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
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
