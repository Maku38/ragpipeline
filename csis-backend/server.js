/**
 * server.js (full)
 * - Adds robust process + server lifecycle logging so the process won't "silently" exit
 * - Keeps your existing logic intact
 */

process.on("beforeExit", (code) => {
  console.log("🟡 beforeExit event. code =", code);
});

process.on("exit", (code) => {
  console.log("🔴 exit event. code =", code);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 unhandledRejection:", reason);
});

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const { supabase, getSystemContext } = require("./database");
const { checkBookingConflict } = require("./conflictChecker");

const app = express();
app.use(cors());
app.use(express.json());

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  timeout: 30000, // 30 second timeout
});

if (!process.env.GROQ_API_KEY) {
  console.error("❌ FATAL: GROQ_API_KEY not found in .env file");
  process.exit(1);
}

console.log("✅ Groq client initialized successfully");
console.log("🔑 API Key loaded: Yes (length: " + process.env.GROQ_API_KEY.length + ")");

// ─────────────────────────────────────────────────────────────────────────────
// SSE CLIENT REGISTRY — keeps track of every connected frontend tab
// ─────────────────────────────────────────────────────────────────────────────
const sseClients = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rooms  — list all available room names
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/rooms", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rooms")
      .select("room_id, name");

    if (error) {
      console.error("❌ Error fetching rooms:", error);
      return res.status(500).json({ error: error.message });
    }

    // Map to consistent array of room names
    const roomsList = (data || [])
      .map((r) => r.name || r.room_id)
      .filter((name) => name !== null && name !== undefined);

    console.log(`✅ Fetched ${roomsList.length} rooms from Supabase`);
    res.json({ rooms: roomsList });
  } catch (e) {
    console.error("❌ Exception in /api/rooms:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schedule  — grouped by date for the calendar view
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/schedule", async (req, res) => {
  try {
    // 1. Fetch valid room names first
    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("name");
    
    if (roomsError) throw roomsError;
    const validRoomNames = new Set((rooms || []).map(r => r.name.trim().toUpperCase()));

    // 2. Fetch all non-rejected bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("room_number, start_date, start_time, end_time, status")
      .neq("status", "Rejected");

    if (bookingsError) throw bookingsError;

    // 3. Filter schedule to ONLY show bookings for rooms that actually exist!
    // This prevents "ghost" bookings (like A-504) from showing in the timeline.
    const filteredBookings = (bookings || []).filter(b => 
      validRoomNames.has((b.room_number || "").trim().toUpperCase())
    );

    const scheduleMap = {};
    filteredBookings.forEach((b) => {
      if (!scheduleMap[b.start_date]) scheduleMap[b.start_date] = [];
      scheduleMap[b.start_date].push(b);
    });

    res.json(scheduleMap);
  } catch (err) {
    console.error("❌ Schedule fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings  — all bookings for the dashboard
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/bookings", async (req, res) => {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("id", { ascending: false });

  if (error) {
    console.error("❌ SUPABASE ERROR:", error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/approve/:bookingId  — Admin approves a student booking
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/bookings/approve/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { adminRole } = req.body; // Optional: verify admin is actually admin

    // Check if booking exists
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_id", bookingId)
      .single();

    if (fetchError || !booking) {
      console.error("❌ Booking not found:", bookingId);
      return res.status(404).json({ error: "Booking not found" });
    }

    // Update status to Approved
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "Approved" })
      .eq("booking_id", bookingId);

    if (updateError) {
      console.error("❌ Error approving booking:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    console.log(`✅ Booking ${bookingId} approved by admin`);

    // Broadcast the update to all clients
    broadcastToClients("booking_change", {
      eventType: "UPDATE",
      bookingId: bookingId,
      newStatus: "Approved",
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: "Booking approved", bookingId });
  } catch (error) {
    console.error("❌ Error in /api/bookings/approve:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/reject/:bookingId  — Admin rejects a student booking
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/bookings/reject/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { adminRole } = req.body; // Optional: verify admin is actually admin

    // Check if booking exists
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_id", bookingId)
      .single();

    if (fetchError || !booking) {
      console.error("❌ Booking not found:", bookingId);
      return res.status(404).json({ error: "Booking not found" });
    }

    // Update status to Rejected
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "Rejected" })
      .eq("booking_id", bookingId);

    if (updateError) {
      console.error("❌ Error rejecting booking:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    console.log(`✅ Booking ${bookingId} rejected by admin`);

    // Broadcast the update to all clients
    broadcastToClients("booking_change", {
      eventType: "UPDATE",
      bookingId: bookingId,
      newStatus: "Rejected",
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: "Booking rejected", bookingId });
  } catch (error) {
    console.error("❌ Error in /api/bookings/reject:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/stream  — SSE endpoint for real-time updates
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/bookings/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  // Immediately confirm connection
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      ts: new Date().toISOString(),
    })}\n\n`
  );

  sseClients.add(res);
  console.log(`👤 [SSE] Client connected. Total: ${sseClients.size}`);

  // Heartbeat every 25s — keeps connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`👤 [SSE] Client disconnected. Total: ${sseClients.size}`);
  });
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
  dead.forEach((c) => sseClients.delete(c));
  console.log(
    `📡 [SSE] Broadcast "${eventType}" → ${sseClients.size} client(s)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat  — AI booking assistant with hardcoded pre-validation
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history, currentBookings, role } = req.body;
    
    console.log("📨 Received /api/chat request:", { message, role });
    console.log("✅ GROQ_API_KEY present:", !!process.env.GROQ_API_KEY);
    console.log("✅ Groq client initialized:", !!groqClient);

    const getLocalDateStr = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const today = getLocalDateStr(new Date());
    const semEnd = new Date();
    semEnd.setMonth(new Date().getMonth() + 5);
    const semEndStr = getLocalDateStr(semEnd);

    console.log("🤖 Calling Groq API (extraction)...");
    const completion = await groqClient.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are a data extractor. Today is ${today}.
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
- "tomorrow" = ${getLocalDateStr(new Date(Date.now() + 86400000))}
- "next Monday" etc — calculate from today (${today})
- Use 24-hour time format (e.g. "08:00", "13:30")
- Output ONLY JSON. No explanation. No markdown.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
    });

    console.log("✅ Groq API response received (extraction)");
    let extractedData = { is_booking_request: false, bookings: [] };
    try {
      const raw = completion.choices[0].message.content;
      console.log("📝 Raw extraction response:", raw);
      extractedData = JSON.parse(raw);
      console.log("✅ Parsed extraction data:", extractedData);
    } catch (e) {
      console.warn(
        "⚠️ Extraction parse failed, assuming non-booking request:",
        e && e.message ? e.message : e
      );
    }

    // ── STEP 2: Hardcoded conflict check ─────────────────────────────────────
    let conflictReport = null;

    if (extractedData.is_booking_request && extractedData.bookings?.length > 0) {
      const allConflictResults = [];

      for (const proposed of extractedData.bookings) {
        const result = await checkBookingConflict(supabase, proposed);
        allConflictResults.push({ proposed, result });
      }

      const anyConflict = allConflictResults.some((r) => !r.result.valid);

      if (anyConflict) {
        conflictReport = {
          has_conflict: true,
          details: allConflictResults.map(({ proposed, result }) => ({
            room: proposed.room_number,
            date: proposed.start_date,
            time: `${proposed.start_time}–${proposed.end_time}`,
            valid: result.valid,
            reasons: result.reasons,
            conflicting_bookings: result.conflicts,
          })),
        };
      } else {
        conflictReport = {
          has_conflict: false,
          details: allConflictResults.map(({ proposed }) => ({
            room: proposed.room_number,
            date: proposed.start_date,
            time: `${proposed.start_time}–${proposed.end_time}`,
            valid: true,
          })),
        };
      }
    }

    // ── STEP 3: System prompt build ──────────────────────────────────────────
    const activeBookingsStr =
      currentBookings?.length > 0
        ? currentBookings
            .map(
              (b) =>
                `- ID: ${b.booking_id}, Room: ${b.room_number}, Date: ${b.start_date}, Time: ${b.start_time}-${b.end_time}, Status: ${b.status}`
            )
            .join("\n")
        : "No active bookings.";

    const liveSystemContext = await getSystemContext();

    let conflictInstruction = "";
    if (conflictReport !== null) {
      if (conflictReport.has_conflict) {
        const details = conflictReport.details
          .filter((d) => !d.valid)
          .map((d) => `  • ${d.room} on ${d.date} at ${d.time}: ${d.reasons.join(" ")}`)
          .join("\n");

        conflictInstruction = `
⚠️ HARDCODED CONFLICT CHECK RESULT (THIS IS DEFINITIVE — YOU CANNOT OVERRIDE THIS):
THE FOLLOWING BOOKING(S) ARE BLOCKED:
${details}

INSTRUCTION: You MUST tell the user this booking is NOT possible. Explain the exact conflict clearly.
DO NOT proceed with the booking. Set intent to "CONFLICT" and bookings to [].
Suggest alternative times or rooms if you can infer them from the schedule.`;
      } else {
        const details = conflictReport.details
          .map((d) => `  • ${d.room} on ${d.date} at ${d.time}: clear ✓`)
          .join("\n");

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
- Current Role: ${String(role || "").toUpperCase()}
- Active Session Bookings: ${activeBookingsStr}

${conflictInstruction}

POLICIES:
1. SEMESTER LIMIT: Only book between ${today} and ${semEndStr}. Reject dates outside this window.
2. ROLE RULES: Students → Pending status (CSA must approve). Teachers → Approved instantly. Admin → Full override.
3. CONFLICT RULE: NEVER book a room that has an overlapping approved or pending booking. The hardcoded check above is final.
4. ROOM VALIDITY: ONLY book rooms explicitly listed in "AVAILABLE RESOURCES". If the user asks for a room not in that list, refuse and list the available ones.

OUTPUT FORMAT (strict JSON):
{
  "intent": "BOOK" | "CANCEL" | "INQUIRY" | "CONFLICT",
  "bookings": [{ "room_number": "...", "start_date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "status": "..." }],
  "cancellations": [{ "room_number": "...", "date": "YYYY-MM-DD" }],
  "assistant_message": "Your friendly, clear reply to the user. For conflicts, explain exactly what's blocking and suggest alternatives."
}`;

    // ── STEP 4: Full AI response ─────────────────────────────────────────────
    // Format message history for Groq
    const formattedMessages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...(history || [])
        .filter((m) => m.role !== "system")
        .slice(-10)
        .map((msg) => ({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        })),
      {
        role: "user",
        content: message,
      },
    ];

    console.log("🤖 Calling Groq API (full response)...");
    const result = await groqClient.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: formattedMessages,
      temperature: 0.1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
    });

    console.log("✅ Groq API response received (full response)");
    const rawText = result.choices[0].message.content;
    console.log("📝 Raw full response:", rawText);

    let parsedData;
    try {
      const cleanJson = rawText.replace(/```json|```/gi, "").trim();
      parsedData = JSON.parse(cleanJson);
      console.log("✅ Parsed full response data:", parsedData);
    } catch (parseError) {
      console.warn("⚠️ Groq returned invalid JSON, falling back.");
      parsedData = {
        intent: "INQUIRY",
        bookings: [],
        cancellations: [],
        assistant_message: rawText,
      };
    }

    // ── STEP 5: Final safety gate ────────────────────────────────────────────
    if (parsedData.intent === "BOOK" && conflictReport?.has_conflict) {
      console.warn("🚨 SAFETY GATE: AI tried to book despite a conflict. Blocked.");
      parsedData.intent = "CONFLICT";
      parsedData.bookings = [];
      if (!String(parsedData.assistant_message || "").toLowerCase().includes("conflict")) {
        parsedData.assistant_message =
          `Sorry, that booking isn't possible — there's already a booking in that slot. ` +
          conflictReport.details
            .filter((d) => !d.valid)
            .map((d) => d.reasons.join(" "))
            .join(" ");
      }
    }

    // ── STEP 6: DB writes ────────────────────────────────────────────────────
    if (parsedData.intent === "BOOK" && parsedData.bookings?.length > 0) {
      for (const bk of parsedData.bookings) {
        const finalCheck = await checkBookingConflict(supabase, bk);
        if (!finalCheck.valid) {
          console.warn(
            `🚨 Final DB gate blocked insert for ${bk.room_number} on ${bk.start_date}`
          );
          continue;
        }

        const genId = "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();
        const newBooking = {
          booking_id: genId,
          room_number: bk.room_number,
          start_date: bk.start_date,
          start_time: bk.start_time,
          end_time: bk.end_time,
          status: bk.status || (role === "student" ? "Pending" : "Approved"),
          owner_role: role,
        };

        const { error: insertError } = await supabase
          .from("bookings")
          .insert([newBooking]);

        if (insertError) {
          console.error("❌ Insert error:", insertError);
        } else {
          console.log(
            `✅ Booking created: ${genId} — ${bk.room_number} on ${bk.start_date} ${bk.start_time}-${bk.end_time}`
          );
          // Broadcast to all connected clients
          broadcastToClients("booking_change", {
            eventType: "INSERT",
            new: newBooking,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (role === "student") {
        console.log(
          `\n📧 [EMAIL] To: csa@college.edu — New pending room request for ${parsedData.bookings[0]?.room_number}\n`
        );
      }
    }

    if (parsedData.intent === "CANCEL" && parsedData.cancellations?.length > 0) {
      for (const cx of parsedData.cancellations) {
        const { data: deleted } = await supabase
          .from("bookings")
          .delete()
          .ilike("room_number", cx.room_number)
          .eq("start_date", cx.date)
          .select();

        if (deleted && deleted.length > 0) {
          // Broadcast deletion to all clients
          broadcastToClients("booking_change", {
            eventType: "DELETE",
            old: deleted[0],
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return res.json(parsedData);
  } catch (error) {
    console.error("❌ Backend Error in /api/chat:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      status: error.status,
      type: error.type,
    });
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Server start + lifecycle events
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Backend ready to accept /api/chat requests`);
  console.log(`🔗 Groq API: Connected and ready`);
  console.log(`📊 Supabase: Connected and ready`);
});

server.on("error", (err) => {
  console.error("❌ listen error:", err);
});

server.on("close", () => {
  console.log("🧯 server CLOSE event fired");
});