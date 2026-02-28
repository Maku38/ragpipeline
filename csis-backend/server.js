require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase, getSystemContext } = require('./database');
const { checkBookingConflict } = require('./conflictChecker');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// SSE CLIENT REGISTRY — keeps track of every connected frontend tab
// ─────────────────────────────────────────────────────────────────────────────
const sseClients = new Set();

app.get('/api/rooms', async (req, res) => {
  try {
    const { data, error } = await supabase.from('rooms').select('room_id, name');
    if (error) {
      console.error('❌ Error fetching rooms:', error);
      return res.status(500).json({ error: error.message });
    }

    // Map to consistent array of names/ids
    const roomsList = (data || []).map(r => ({ id: r.room_id ?? r.name ?? null, name: r.name ?? null })).filter(x => x.id || x.name);
    const roomNames = roomsList.map(r => r.name || r.id);

    res.json({ rooms: roomNames });
  } catch (e) {
    console.error('❌ Exception in /api/rooms:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

function broadcastToClients(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      dead.push(client);
    }
  }
  dead.forEach(c => sseClients.delete(c));
  console.log(`📡 [SSE] Broadcast "${eventType}" → ${sseClients.size} client(s)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE REALTIME — server subscribes once, fans out to all SSE clients
// This means even manual Supabase dashboard edits push to the frontend!
// ─────────────────────────────────────────────────────────────────────────────
function initSupabaseRealtime() {
  supabase
    .channel('bookings-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bookings' },
      (payload) => {
        console.log(`🔔 [Supabase Realtime] ${payload.eventType}`);
        broadcastToClients('booking_change', {
          eventType: payload.eventType, // INSERT | UPDATE | DELETE
          new: payload.new || null,
          old: payload.old || null,
          timestamp: new Date().toISOString(),
        });
      }
    )
    .subscribe((status) => {
      console.log(`🔌 [Supabase Realtime] Status: ${status}`);
    });
}

initSupabaseRealtime();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/stream  — SSE endpoint, frontend connects once and listens
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/bookings/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Immediately confirm connection
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  sseClients.add(res);
  console.log(`👤 [SSE] Client connected. Total: ${sseClients.size}`);

  // Heartbeat every 25s — keeps connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); }
    catch (e) { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`👤 [SSE] Client disconnected. Total: ${sseClients.size}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schedule  — grouped by date for calendar view
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/schedule', async (req, res) => {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('room_number, start_date, start_time, end_time, status, booking_id, owner_role')
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
// GET /api/bookings  — all bookings, newest first
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

    // ── STEP 1: Extract structured booking data from user message ─────────────
    const extractModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `You are a data extractor. Today is ${today}.
Extract any room booking request. Output ONLY JSON:
{ "is_booking_request": true, "bookings": [{ "room_number": "CSIS-101", "start_date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM" }] }
Or if not a booking: { "is_booking_request": false, "bookings": [] }
"tomorrow" = ${new Date(Date.now() + 86400000).toISOString().split('T')[0]}. 24-hour time. No markdown.`
    });

    let extractedData = { is_booking_request: false, bookings: [] };
    try {
      const extractChat = extractModel.startChat({ generationConfig: { temperature: 0, responseMimeType: "application/json" } });
      const r = await extractChat.sendMessage(message);
      extractedData = JSON.parse(r.response.text().replace(/```json|```/gi, '').trim());
    } catch (e) { console.warn("⚠️ Extract failed:", e.message); }

    // ── STEP 2: HARDCODED CONFLICT CHECK — source of truth ────────────────────
    let conflictReport = null;
    if (extractedData.is_booking_request && extractedData.bookings?.length > 0) {
      const results = [];
      for (const proposed of extractedData.bookings) {
        const result = await checkBookingConflict(supabase, proposed);
        results.push({ proposed, result });
      }
      conflictReport = {
        has_conflict: results.some(r => !r.result.valid),
        details: results.map(({ proposed, result }) => ({
          room: proposed.room_number, date: proposed.start_date,
          time: `${proposed.start_time}–${proposed.end_time}`,
          valid: result.valid, reasons: result.reasons,
          conflicting_bookings: result.conflicts,
        }))
      };
    }

    // ── STEP 3: Build system prompt with conflict verdict ─────────────────────
    const activeBookingsStr = currentBookings?.length > 0
      ? currentBookings.map(b => `- ID: ${b.booking_id}, Room: ${b.room_number}, Date: ${b.start_date}, Time: ${b.start_time}-${b.end_time}, Status: ${b.status}`).join('\n')
      : "No active bookings.";

    const liveSystemContext = await getSystemContext();

    let conflictInstruction = '';
    if (conflictReport !== null) {
      if (conflictReport.has_conflict) {
        const blocked = conflictReport.details.filter(d => !d.valid)
          .map(d => `  • ${d.room} on ${d.date} at ${d.time}: ${d.reasons.join(' ')}`).join('\n');
        conflictInstruction = `\n⚠️ HARDCODED CONFLICT CHECK — FINAL, CANNOT BE OVERRIDDEN:\nBLOCKED:\n${blocked}\nINSTRUCTION: This booking is IMPOSSIBLE. Tell the user clearly. Set intent="CONFLICT", bookings=[]. Suggest alternatives.\n`;
      } else {
        conflictInstruction = `\n✅ HARDCODED CONFLICT CHECK — ALL CLEAR:\n${conflictReport.details.map(d => `  • ${d.room} on ${d.date} at ${d.time}: verified clear`).join('\n')}\nINSTRUCTION: Proceed with booking.\n`;
      }
    }

    const systemPrompt = `You are a smart booking assistant for the CSIS department.
Today: ${today}. Semester: ${today} to ${semEndStr}.
LIVE DB: ${liveSystemContext}
USER: Role=${role.toUpperCase()} | ${activeBookingsStr}
${conflictInstruction}
POLICIES: Students→Pending, Teachers→Approved, Admin→Override. Only book within semester range.
OUTPUT strict JSON:
{ "intent": "BOOK"|"CANCEL"|"INQUIRY"|"CONFLICT", "bookings": [...], "cancellations": [...], "assistant_message": "..." }`;

    // ── STEP 4: Full AI response ──────────────────────────────────────────────
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemPrompt });
    // ... existing code ...

// 1. Format and FILTER history for the SDK
let formattedHistory = history
  .filter(msg => msg.content && msg.content.trim() !== "") // 💡 REMOVE EMPTY MESSAGES
  .map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

// 🛠️ FIX: Gemini strictly requires history to start with a 'user' message. 
while (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') {
  formattedHistory.shift();
}

// 💡 EXTRA SAFETY: Ensure every part has text data initialized
formattedHistory = formattedHistory.filter(h => h.parts && h.parts[0].text);

// 2. Start chat
const chat = model.startChat({
  history: formattedHistory,
  generationConfig: { 
    temperature: 0.1,
    responseMimeType: "application/json" 
  }
});

// ... rest of code ...
    const result = await chat.sendMessage(message);

    let parsedData;
    try {
      parsedData = JSON.parse(result.response.text().replace(/```json|```/gi, '').trim());
    } catch {
      parsedData = { intent: "INQUIRY", bookings: [], cancellations: [], assistant_message: result.response.text() };
    }

    // ── STEP 5: SAFETY GATE — AI cannot override conflict check ──────────────
    if (parsedData.intent === 'BOOK' && conflictReport?.has_conflict) {
      console.warn("🚨 SAFETY GATE: Blocked AI from booking despite conflict.");
      parsedData.intent = 'CONFLICT';
      parsedData.bookings = [];
    }

    // ── STEP 6: DB writes + SSE broadcast ─────────────────────────────────────
    if (parsedData.intent === 'BOOK' && parsedData.bookings?.length > 0) {
      for (const bk of parsedData.bookings) {
        // Belt-and-suspenders: one more check right before insert
        const finalCheck = await checkBookingConflict(supabase, bk);
        if (!finalCheck.valid) { console.warn(`🚨 Final gate blocked: ${bk.room_number}`); continue; }

        const genId = "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();
        const newBooking = {
          booking_id: genId,
          room_number: bk.room_number,
          start_date: bk.start_date,
          start_time: bk.start_time,
          end_time: bk.end_time,
          status: bk.status || (role === 'student' ? 'Pending' : 'Approved'),
          owner_role: role,
        };

        const { error: insertError } = await supabase.from('bookings').insert([newBooking]);

        if (insertError) {
          console.error("❌ Insert error:", insertError);
        } else {
          console.log(`✅ Created: ${genId} — ${bk.room_number} ${bk.start_date} ${bk.start_time}-${bk.end_time}`);
          // Manual broadcast as fallback if Supabase Realtime is not enabled
          broadcastToClients('booking_change', { eventType: 'INSERT', new: newBooking, timestamp: new Date().toISOString() });
          if (role === 'student') console.log(`\n📧 [EMAIL] CSA notified for ${genId}\n`);
        }
      }
    }

    if (parsedData.intent === 'CANCEL' && parsedData.cancellations?.length > 0) {
      for (const cx of parsedData.cancellations) {
        const { data: deleted } = await supabase.from('bookings')
          .delete()
          .ilike('room_number', cx.room_number)
          .eq('start_date', cx.date)
          .select();
        if (deleted?.length > 0) {
          broadcastToClients('booking_change', { eventType: 'DELETE', old: deleted[0], timestamp: new Date().toISOString() });
        }
      }
    }

    res.json(parsedData);

  } catch (error) {
    console.error("❌ Backend Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
