import { useState, useRef, useEffect, useCallback } from "react";
import './booking-gemini.css';

function md(text) { return text ? text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>") : ""; }

export default function BookingGemini({ userRole = "student" }) {
  const [role, setRole] = useState(userRole);
  const [messages, setMessages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  // 💡 NEW: Function to fetch live data from Supabase via our Node backend
  const fetchBookings = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/bookings");
      const data = await res.json();
      
      // 💡 FIX: Make sure the data is actually an array before setting it!
      if (Array.isArray(data)) {
        setBookings(data);
      } else {
        console.error("Backend returned an error instead of an array:", data);
        setBookings([]); // Fallback to an empty array so it doesn't crash
      }
    } catch (err) {
      console.error("Failed to load bookings", err);
      setBookings([]);
    }
  };

  // Function to approve a booking (admin only)
  const approveBooking = async (bookingId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/bookings/approve/${bookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminRole: role })
      });

      if (!res.ok) throw new Error("Failed to approve booking");
      
      const result = await res.json();
      console.log("✅ Booking approved:", result);
      
      // Refresh bookings to show the updated status
      await fetchBookings();
    } catch (err) {
      console.error("❌ Error approving booking:", err);
      alert(`Error approving booking: ${err.message}`);
    }
  };

  // Function to reject a booking (admin only)
  const rejectBooking = async (bookingId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/bookings/reject/${bookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminRole: role })
      });

      if (!res.ok) throw new Error("Failed to reject booking");
      
      const result = await res.json();
      console.log("✅ Booking rejected:", result);
      
      // Refresh bookings to show the updated status
      await fetchBookings();
    } catch (err) {
      console.error("❌ Error rejecting booking:", err);
      alert(`Error rejecting booking: ${err.message}`);
    }
  };

  // Fetch immediately on load
  useEffect(() => { fetchBookings(); }, []);

  useEffect(() => {
    setMessages([{
      role: "assistant",
      content: `Hey! I'm your **CSIS ResourceBook AI** ✨\n\nYou are logged in as **${role.toUpperCase()}**.\n${
        role === 'student' ? 'Requested rooms go to the CSA for approval.' : 
        role === 'teacher' ? 'Your bookings are approved instantly.' : 
        'You have full admin system override.'
      }`
    }]);
  }, [role]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const history = messages.filter(m => m.role !== "system").slice(-10);
      
      const response = await fetch("http://localhost:5000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, currentBookings: bookings, role }) 
      });

      if (!response.ok) throw new Error("Backend connection failed");
      const parsed = await response.json();

      setMessages(prev => [...prev, { role: "assistant", content: parsed.assistant_message }]);

      // 💡 RE-FETCH from database if the AI booked or cancelled something!
      if (parsed.intent === "BOOK" || parsed.intent === "CANCEL") {
        await fetchBookings();
      }

    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠ **Error:** Could not connect. (${err.message})` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, bookings, role]);

  return (
    <div className="app">
      {/* ... (Keep your exact same UI HTML/JSX below here!) ... */}
      <div className="chat">
        <div className="chat-top" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
            <div className="chat-logo">🏫</div>
            <div>
              <div className="chat-title">CSIS ResourceBook AI</div>
              <div className="chat-sub">Supabase + Gemini RAG</div>
            </div>
            <div className="gemini-badge" style={{marginLeft: 'auto', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)'}}>
              <div className="dot" style={{background: '#10b981'}} /> Database Live
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '8px', width: '100%' }}>
            {['student', 'teacher', 'admin'].map(r => (
              <button 
                key={r} 
                onClick={() => setRole(r)}
                style={{
                  flex: 1, padding: '6px', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase',
                  border: 'none', borderRadius: '4px', cursor: 'pointer', transition: '0.2s',
                  background: role === r ? '#5c6bc0' : 'transparent',
                  color: role === r ? '#fff' : '#8b949e'
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
            </div>
          ))}
          {loading && (
            <div className="msg assistant"><div className="bubble"><div className="typing-bubble"><span/><span/><span/></div></div></div>
          )}
          <div ref={endRef} />
        </div>

        <div className="input-area">
          <textarea
            className="chat-textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
            placeholder={`Type a request as ${role}...`} rows={1}
          />
          <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>Send</button>
        </div>
      </div>

      <div className="dash">
        <div className="dash-head">
          <h2>Bookings Dashboard</h2>
        </div>

        <div className="dash-body">
          {bookings.length === 0 ? (
             <div className="empty">No active bookings.</div>
          ) : (
            bookings.map(bk => (
              <div key={bk.booking_id} className={`bk-card ${bk.status === 'Approved' ? 'complete' : bk.status === 'Rejected' ? 'rejected' : 'incomplete'}`}>
                <div className="bk-head">
                  <div><div className="bk-id">{bk.booking_id} ({bk.owner_role})</div><div className="bk-room">{bk.room_number || "—"}</div></div>
                  <span className={`bk-badge badge-${bk.status === 'Approved' ? 'approved' : bk.status === 'Rejected' ? 'rejected' : 'pending'}`}>{bk.status}</span>
                </div>
                <div className="bk-body">
                  <div className="field-lbl">Date</div><div className="field-val">{bk.start_date || "—"}</div>
                  <div className="field-lbl">Time</div><div className="field-val">{bk.start_time ? `${bk.start_time} - ${bk.end_time}` : "—"}</div>
                </div>

                {/* ADMIN: Show approve/reject buttons only for admin users viewing pending student bookings */}
                {role === 'admin' && bk.owner_role === 'student' && bk.status === 'Pending' && (
                  <div className="bk-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(91, 107, 192, 0.2)' }}>
                    <button 
                      onClick={() => approveBooking(bk.booking_id)}
                      style={{
                        flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: '600',
                        border: 'none', borderRadius: '4px', cursor: 'pointer', transition: '0.2s',
                        background: '#10b981', color: '#fff'
                      }}
                      onMouseEnter={(e) => e.target.style.background = '#059669'}
                      onMouseLeave={(e) => e.target.style.background = '#10b981'}
                    >
                      ✓ Approve
                    </button>
                    <button 
                      onClick={() => rejectBooking(bk.booking_id)}
                      style={{
                        flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: '600',
                        border: 'none', borderRadius: '4px', cursor: 'pointer', transition: '0.2s',
                        background: '#ef4444', color: '#fff'
                      }}
                      onMouseEnter={(e) => e.target.style.background = '#dc2626'}
                      onMouseLeave={(e) => e.target.style.background = '#ef4444'}
                    >
                      ✕ Reject
                    </button>
                  </div>
                )}

                {/* STUDENT: Show approval notification message */}
                {role === 'student' && bk.owner_role === 'student' && (
                  <div className="bk-notification" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(91, 107, 192, 0.2)' }}>
                    {bk.status === 'Approved' && (
                      <div style={{ color: '#10b981', fontSize: '12px', fontWeight: '500' }}>
                        ✓ Your booking has been approved!
                      </div>
                    )}
                    {bk.status === 'Rejected' && (
                      <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: '500' }}>
                        ✕ Your booking was rejected by the admin.
                      </div>
                    )}
                    {bk.status === 'Pending' && (
                      <div style={{ color: '#ffb547', fontSize: '12px', fontWeight: '500' }}>
                        ⏳ Waiting for admin approval...
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}