import { useState, useRef, useEffect, useCallback } from "react";
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css'; 
import './booking-gemini.css';
import FaceLogin from './FaceLogin.jsx';

function md(text) {
  return text
    ? text
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
    : "";
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState("");
  const [view, setView] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  const formatDate = (date) => date.toISOString().split('T')[0];

  const fetchBookings = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/bookings");
      const data = await res.json();
      if (Array.isArray(data)) setBookings(data);
    } catch (err) { console.error("Sync error"); }
  };

  const fetchSchedule = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/schedule");
      const data = await res.json();
      setSchedule(data);
    } catch (err) { console.error("Schedule fetch error"); }
  };

  useEffect(() => { if (isLoggedIn) fetchBookings(); }, [isLoggedIn]);
  useEffect(() => { if (view === "calendar") fetchSchedule(); }, [view]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const handleLoginSuccess = (detectedRole) => {
    setRole(detectedRole);
    setIsLoggedIn(true);
    setMessages([{
      role: "assistant",
      content: `Welcome back, **${detectedRole.toUpperCase()}** ✨\n\nAuthentication successful. How can I help you with CSIS resources today?`
    }]);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setRole("");
    setMessages([]);
    setView("chat");
  };

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
      const parsed = await response.json();
      setMessages(prev => [...prev, { role: "assistant", content: parsed.assistant_message }]);
      if (parsed.intent === "BOOK" || parsed.intent === "CANCEL") fetchBookings();
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, bookings, role]);

  if (!isLoggedIn) return <FaceLogin onLoginSuccess={handleLoginSuccess} />;

  const approvedCount = bookings.filter(b => b.status === 'Approved').length;
  const pendingCount = bookings.filter(b => b.status !== 'Approved').length;

  return (
    <div className="app">

      {/* ── Top Navigation ── */}
      <nav className="top-nav">
        <div className="nav-logo">CSIS RESOURCEBOOK</div>

        <button
          className={`nav-btn ${view === 'chat' ? 'active' : ''}`}
          onClick={() => setView('chat')}
        >
          ⌘ Assistant
        </button>
        <button
          className={`nav-btn ${view === 'calendar' ? 'active' : ''}`}
          onClick={() => setView('calendar')}
        >
          ◷ Calendar
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="nav-role-badge">{role}</span>
          <button className="nav-logout" onClick={handleLogout}>⏻ Exit</button>
        </div>
      </nav>

      {/* ── Main Body ── */}
      {view === 'chat' ? (
        <div className="app-body">

          {/* Chat */}
          <div className="chat">
            <div className="chat-header">
              <div className="chat-header-title">AI Booking Assistant</div>
              <div className="chat-header-subtitle">
                CSIS <span>RAG</span> Pipeline
              </div>
            </div>

            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="msg-label">
                    {m.role === 'user' ? `— ${role.toUpperCase()}` : '— AI AGENT'}
                  </div>
                  <div
                    className="bubble"
                    dangerouslySetInnerHTML={{ __html: md(m.content) }}
                  />
                </div>
              ))}
              {loading && (
                <div className="msg assistant">
                  <div className="msg-label">— AI AGENT</div>
                  <div className="bubble">
                    <div className="typing-bubble"><span/><span/><span/></div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="input-area">
              <textarea
                className="chat-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder={`Book a room as ${role}...`}
                rows={1}
              />
              <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
                ↑ Send
              </button>
            </div>
          </div>

          {/* Dashboard */}
          <div className="dash">
            <div className="dash-head">
              <div className="dash-head-top">
                <div className="dash-title">Live Bookings</div>
                <div className="dash-live">
                  <div className="dash-live-dot" />
                  Synced
                </div>
              </div>
              <div className="stats-row">
                <div className="stat-box">
                  <div className="stat-box-n total">{bookings.length}</div>
                  <div className="stat-box-label">Total</div>
                </div>
                <div className="stat-box">
                  <div className="stat-box-n approved">{approvedCount}</div>
                  <div className="stat-box-label">Approved</div>
                </div>
                <div className="stat-box">
                  <div className="stat-box-n pending">{pendingCount}</div>
                  <div className="stat-box-label">Pending</div>
                </div>
              </div>
            </div>

            <div className="dash-body">
              {bookings.length === 0 ? (
                <div className="empty">No active bookings found.</div>
              ) : (
                bookings.map(bk => (
                  <div key={bk.id || bk.booking_id} className={`bk-card ${bk.status === 'Approved' ? 'complete' : 'incomplete'}`}>
                    <div className="bk-head">
                      <div className="bk-meta">
                        <div className="bk-id">{bk.booking_id} · {bk.owner_role}</div>
                        <div className="bk-room">{bk.room_number || '—'}</div>
                      </div>
                      <span className={`bk-badge badge-${bk.status === 'Approved' ? 'approved' : 'pending'}`}>
                        {bk.status}
                      </span>
                    </div>
                    <div className="bk-body">
                      <div className="bk-field">
                        <div className="field-lbl">Date</div>
                        <div className="field-val">{bk.start_date || '—'}</div>
                      </div>
                      <div className="bk-field">
                        <div className="field-lbl">Time</div>
                        <div className="field-val">{bk.start_time ? `${bk.start_time}–${bk.end_time}` : '—'}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      ) : (

        /* ── Calendar View ── */
        <div className="calendar-view" style={{ height: 'calc(100vh - 56px)' }}>
          <div className="calendar-left">
            <div className="calendar-section-title">Select Date</div>
            <Calendar
              onChange={setSelectedDate}
              value={selectedDate}
              tileClassName={({ date }) =>
                schedule[formatDate(date)] ? 'has-bookings' : null
              }
            />

            <div style={{ marginTop: '24px' }}>
              <div className="calendar-section-title">Legend</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                {[
                  { color: 'var(--accent)', label: 'Selected date' },
                  { color: 'var(--accent2)', label: 'Has bookings' },
                  { color: 'var(--success)', label: 'Approved slots' },
                  { color: 'var(--warning)', label: 'Pending approval' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="calendar-right">
            <div className="cal-day-header">
              <div>
                <div className="cal-day-title">{selectedDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric' })}</div>
                <div className="cal-day-label">{selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {(schedule[formatDate(selectedDate)] || []).length} booking(s) today
              </div>
            </div>

            <div className="room-grid">
              {['CSIS-101', 'CSIS-204', 'CSIS-301'].map(roomId => {
                const dayBookings = schedule[formatDate(selectedDate)] || [];
                const roomBookings = dayBookings.filter(b => b.room_number === roomId);
                const isBusy = roomBookings.length > 0;
                return (
                  <div key={roomId} className="room-card">
                    <div className="room-card-head">
                      <div className="room-card-id">{roomId}</div>
                      <div className={`room-status-dot ${isBusy ? 'busy' : ''}`} />
                    </div>
                    <div className="room-card-body">
                      {roomBookings.length === 0 ? (
                        <div className="available">✓ Available all day</div>
                      ) : (
                        roomBookings.map((b, i) => (
                          <div key={i} className={`time-slot ${b.status?.toLowerCase()}`}>
                            <span>{b.start_time} – {b.end_time}</span>
                            <span style={{ fontSize: '9px', opacity: 0.7 }}>{b.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
