import { useState, useRef, useEffect, useCallback } from "react";
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css'; 
import './booking-gemini.css';
import FaceLogin from './FaceLogin.jsx';

export default function App() {
  // --- States ---
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

  // --- Helpers ---
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

  // --- Effects ---
  useEffect(() => { 
    if (isLoggedIn) fetchBookings(); 
  }, [isLoggedIn]);

  useEffect(() => {
    if (view === "calendar") fetchSchedule();
  }, [view]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // --- Handlers ---
  const handleLoginSuccess = (detectedRole) => {
    setRole(detectedRole);
    setIsLoggedIn(true);
    setMessages([{
      role: "assistant",
      content: `Welcome back, **${detectedRole.toUpperCase()}** ✨\n\nAuthentication successful. How can I help you with the CSIS resources today?`
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

  // --- Guard: Face Login ---
  if (!isLoggedIn) return <FaceLogin onLoginSuccess={handleLoginSuccess} />;

  // --- Main UI Render ---
  return (
    <div className="app">
      {/* Top Navigation */}
      <nav className="top-nav" style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '10px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')} style={{ padding: '8px 15px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: view === 'chat' ? 'var(--accent)' : 'transparent', color: '#fff' }}>
          💬 Assistant
        </button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')} style={{ padding: '8px 15px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: view === 'calendar' ? 'var(--accent)' : 'transparent', color: '#fff' }}>
          📅 Master Calendar
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent)' }}>{role.toUpperCase()}</span>
            <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
        </div>
      </nav>

      {view === 'chat' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', height: 'calc(100vh - 60px)' }}>
          {/* Chat Panel */}
          <div className="chat">
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="bubble" dangerouslySetInnerHTML={{ __html: m.content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
                </div>
              ))}
              {loading && <div className="msg assistant"><div className="bubble"><div className="typing-bubble"><span/><span/><span/></div></div></div>}
              <div ref={endRef} />
            </div>
            <div className="input-area">
              <textarea className="chat-textarea" value={input} onChange={e => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}} placeholder="Request a room..." rows={1} />
              <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>Send</button>
            </div>
          </div>

          {/* Mini Dashboard */}
          <div className="dash">
            <div className="dash-head"><h3>Active Bookings</h3></div>
            <div className="dash-body">
              {bookings.length === 0 ? <div className="empty">No bookings found.</div> : (
                bookings.map(bk => (
                  <div key={bk.id} className={`bk-card ${bk.status === 'Approved' ? 'complete' : 'incomplete'}`}>
                    <div className="bk-head">
                      <div className="bk-id">{bk.booking_id}</div>
                      <div className="bk-room">{bk.room_number}</div>
                    </div>
                    <div className="bk-body" style={{ fontSize: '12px' }}>
                      <div>Date: {bk.start_date}</div>
                      <div>Time: {bk.start_time} - {bk.end_time}</div>
                      <div style={{ color: 'var(--accent)' }}>Role: {bk.owner_role}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Master Calendar View */
        <div className="calendar-view">
          <div className="calendar-left">
            <Calendar 
              onChange={setSelectedDate} 
              value={selectedDate}
              tileClassName={({ date }) => schedule[formatDate(date)] ? 'has-bookings' : null}
            />
          </div>
          <div className="calendar-right">
            <h3>Schedule for {selectedDate.toDateString()}</h3>
            <div className="room-grid">
              {['CSIS-101', 'CSIS-204', 'CSIS-301'].map(roomId => {
                const dayBookings = schedule[formatDate(selectedDate)] || [];
                const roomBookings = dayBookings.filter(b => b.room_number === roomId);
                return (
                  <div key={roomId} className="room-schedule-card">
                    <h4>{roomId}</h4>
                    {roomBookings.length === 0 ? <p className="available">✅ Available</p> : 
                      roomBookings.map((b, i) => (
                        <div key={i} className={`time-slot ${b.status.toLowerCase()}`}>
                          {b.start_time} - {b.end_time} ({b.status})
                        </div>
                    ))}
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