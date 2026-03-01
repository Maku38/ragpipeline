import { useState, useRef, useEffect, useCallback } from "react";
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import './booking-gemini.css';
import FaceLogin from './FaceLogin.jsx';
import { useRealtimeBookings } from './useRealtimeBookings.js';

function md(text) {
  return text
    ? text
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
    : "";
}

// Status badge for the SSE connection indicator
function ConnectionBadge({ status, lastUpdated }) {
  const config = {
    live:       { color: '#00e5a0', dot: true,  label: 'LIVE'       },
    polling:    { color: '#ffb547', dot: true,  label: 'SYNC'       },
    connecting: { color: '#5a6480', dot: false, label: 'CONNECTING' },
    error:      { color: '#ff4d6a', dot: false, label: 'OFFLINE'    },
  }[status] || { color: '#5a6480', dot: false, label: '...' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: '700',
      color: config.color, letterSpacing: '0.1em',
    }}>
      {config.dot && (
        <div style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: config.color,
          boxShadow: `0 0 6px ${config.color}`,
          animation: status === 'live' ? 'pulse 2s infinite' : 'none',
        }} />
      )}
      {config.label}
      {lastUpdated && (
        <span style={{ color: 'var(--text-dim)', marginLeft: '4px' }}>
          {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </div>
  );
}

export default function App() {
  // ─ ALL HOOKS AT THE TOP (before any returns) ─
  const [isLoggedIn, setIsLoggedIn]       = useState(false);
  const [role, setRole]                   = useState("");
  const [view, setView]                   = useState("chat");
  const [messages, setMessages]           = useState([]);
  const [selectedDate, setSelectedDate]   = useState(new Date());
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [availableRooms, setAvailableRooms] = useState(['CSIS-101','CSIS-204','CSIS-301']);
  
  const endRef = useRef(null);

  // ── All booking state comes from here — single source of truth ────────────
  const { bookings, schedule, connectionStatus, lastUpdated, triggerRefresh } = useRealtimeBookings();

  const formatDate = (date) => date.toISOString().split('T')[0];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Fetch rooms list from backend once
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/rooms');
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const payload = await res.json();
        if (Array.isArray(payload.rooms)) {
          setAvailableRooms(payload.rooms);
        } else if (Array.isArray(payload)) {
          setAvailableRooms(payload);
        } else {
          console.warn('Unexpected /api/rooms payload:', payload);
        }
      } catch (e) {
        console.error('Failed to fetch rooms:', e);
      }
    };
    fetchRooms();
  }, []);

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
      
      // Trigger refresh to update the dashboard
      triggerRefresh();
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
      
      // Trigger refresh to update the dashboard
      triggerRefresh();
    } catch (err) {
      console.error("❌ Error rejecting booking:", err);
      alert(`Error rejecting booking: ${err.message}`);
    }
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

      // After a BOOK or CANCEL, nudge the realtime hook to sync fresh data
      if (parsed.intent === "BOOK" || parsed.intent === "CANCEL") {
        triggerRefresh();
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, bookings, role, triggerRefresh]);

  // ─ NOW we can do conditional returns (after all hooks) ─
  if (!isLoggedIn) return <FaceLogin onLoginSuccess={handleLoginSuccess} />;

  const approvedCount = bookings.filter(b => b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED').length;
  const pendingCount  = bookings.filter(b => (b.status !== 'Approved' && b.status !== 'Rejected' && b.status?.toUpperCase() !== 'APPROVED' && b.status?.toUpperCase() !== 'REJECTED')).length;

  // Rooms to show in calendar — pull unique rooms from schedule or use defaults
  const allRooms = availableRooms;

  return (
    <div className="app">

      {/* ── Top Navigation ── */}
      <nav className="top-nav">
        <div className="nav-logo">CSIS RESOURCEBOOK</div>

        <button className={`nav-btn ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
          ⌘ Assistant
        </button>
        <button className={`nav-btn ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>
          ◷ Calendar
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ConnectionBadge status={connectionStatus} lastUpdated={lastUpdated} />
          <span className="nav-role-badge">{role}</span>
          <button className="nav-logout" onClick={handleLogout}>⏻ Exit</button>
        </div>
      </nav>

      {/* ── Chat View ── */}
      {view === 'chat' && (
        <div className="app-body">

          {/* Chat panel */}
          <div className="chat">
            <div className="chat-header">
              <div className="chat-header-title">AI Booking Assistant</div>
              <div className="chat-header-subtitle">CSIS <span>RAG</span> Pipeline</div>
            </div>

            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="msg-label">{m.role === 'user' ? `— ${role.toUpperCase()}` : '— AI AGENT'}</div>
                  <div className="bubble" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                </div>
              ))}
              {loading && (
                <div className="msg assistant">
                  <div className="msg-label">— AI AGENT</div>
                  <div className="bubble"><div className="typing-bubble"><span/><span/><span/></div></div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="input-area">
              <textarea
                className="chat-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
                placeholder={`Book a room as ${role}...`}
                rows={1}
              />
              <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>↑ Send</button>
            </div>
          </div>

          {/* Live dashboard */}
          <div className="dash">
            <div className="dash-head">
              <div className="dash-head-top">
                <div className="dash-title">Live Bookings</div>
                <ConnectionBadge status={connectionStatus} lastUpdated={lastUpdated} />
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
                <div className="empty">No active bookings.</div>
              ) : (
                bookings.map(bk => (
                  <div key={bk.booking_id} className={`bk-card ${(bk.status === 'Approved' || bk.status?.toUpperCase() === 'APPROVED') ? 'complete' : (bk.status === 'Rejected' || bk.status?.toUpperCase() === 'REJECTED') ? 'rejected' : 'incomplete'}`}>
                    <div className="bk-head">
                      <div className="bk-meta">
                        <div className="bk-id">{bk.booking_id} · {bk.owner_role}</div>
                        <div className="bk-room">{bk.room_number || '—'}</div>
                      </div>
                      <span className={`bk-badge badge-${(bk.status === 'Approved' || bk.status?.toUpperCase() === 'APPROVED') ? 'approved' : (bk.status === 'Rejected' || bk.status?.toUpperCase() === 'REJECTED') ? 'rejected' : 'pending'}`}>
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

                    {/* ADMIN: Show approve/reject buttons only for admin users viewing pending student bookings */}
                    {role === 'admin' && bk.owner_role === 'student' && (bk.status === 'Pending' || bk.status?.toUpperCase() === 'PENDING') && (
                      <div style={{ display: 'flex', gap: '8px', padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                        <button 
                          onClick={() => approveBooking(bk.booking_id)}
                          style={{
                            flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: '600',
                            border: 'none', borderRadius: '4px', cursor: 'pointer', transition: '0.2s',
                            background: '#10b981', color: '#fff', fontFamily: 'var(--font-mono)'
                          }}
                          onMouseEnter={(e) => e.target.style.background = '#059669'}
                          onMouseLeave={(e) => e.target.style.background = '#10b981'}
                        >
                          ✓ APPROVE
                        </button>
                        <button 
                          onClick={() => rejectBooking(bk.booking_id)}
                          style={{
                            flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: '600',
                            border: 'none', borderRadius: '4px', cursor: 'pointer', transition: '0.2s',
                            background: '#ef4444', color: '#fff', fontFamily: 'var(--font-mono)'
                          }}
                          onMouseEnter={(e) => e.target.style.background = '#dc2626'}
                          onMouseLeave={(e) => e.target.style.background = '#ef4444'}
                        >
                          ✕ REJECT
                        </button>
                      </div>
                    )}

                    {/* STUDENT: Show approval notification message */}
                    {role === 'student' && bk.owner_role === 'student' && (
                      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', fontSize: '12px', fontWeight: '500' }}>
                        {(bk.status === 'Approved' || bk.status?.toUpperCase() === 'APPROVED') && (
                          <div style={{ color: '#10b981' }}>✓ Your booking has been approved!</div>
                        )}
                        {(bk.status === 'Rejected' || bk.status?.toUpperCase() === 'REJECTED') && (
                          <div style={{ color: '#ef4444' }}>✕ Your booking was rejected by the admin.</div>
                        )}
                        {(bk.status === 'Pending' || bk.status?.toUpperCase() === 'PENDING') && (
                          <div style={{ color: '#ffb547' }}>⏳ Waiting for admin approval...</div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Calendar View ── */}
      {view === 'calendar' && (
        <div className="calendar-view" style={{ height: 'calc(100vh - 56px)' }}>

          {/* Left: calendar picker */}
          <div className="calendar-left">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div className="calendar-section-title">Select Date</div>
              <ConnectionBadge status={connectionStatus} lastUpdated={lastUpdated} />
            </div>

            <Calendar
              onChange={setSelectedDate}
              value={selectedDate}
              tileClassName={({ date }) => {
                const key = formatDate(date);
                return schedule[key]?.length > 0 ? 'has-bookings' : null;
              }}
              tileContent={({ date }) => {
                const key = formatDate(date);
                const dayBookings = schedule[key] || [];
                if (dayBookings.length === 0) return null;
                const hasApproved = dayBookings.some(b => b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED');
                const hasPending  = dayBookings.some(b => b.status === 'Pending' || b.status?.toUpperCase() === 'PENDING');
                return (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginTop: '2px' }}>
                    {hasApproved && <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#00e5a0' }} />}
                    {hasPending  && <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ffb547' }} />}
                  </div>
                );
              }}
            />

            {/* Legend */}
            <div style={{ marginTop: '24px' }}>
              <div className="calendar-section-title" style={{ marginBottom: '12px' }}>Legend</div>
              {[
                { color: '#7b6cff', label: 'Selected date' },
                { color: '#00e5a0', label: 'Approved booking' },
                { color: '#ffb547', label: 'Pending approval' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{label}</span>
                </div>
              ))}
            </div>

            {/* Today's summary */}
            <div style={{ marginTop: '24px', padding: '14px', background: 'var(--bg2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div className="calendar-section-title" style={{ marginBottom: '10px' }}>Today's Totals</div>
              {(() => {
                const todayKey = formatDate(new Date());
                const todayBks = schedule[todayKey] || [];
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[
                      { n: todayBks.length,                                              label: 'Bookings',  color: 'var(--text-main)' },
                      { n: todayBks.filter(b => b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED').length,         label: 'Approved',  color: '#00e5a0' },
                      { n: todayBks.filter(b => b.status === 'Pending' || b.status?.toUpperCase() === 'PENDING').length,          label: 'Pending',   color: '#ffb547' },
                      { n: allRooms.length - new Set(todayBks.map(b => b.room_number)).size, label: 'Free rooms', color: 'var(--accent2)' },
                    ].map(({ n, label, color }) => (
                      <div key={label} style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', fontWeight: '700', color }}>{n}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Right: room grid for selected date */}
          <div className="calendar-right">
            <div className="cal-day-header">
              <div>
                <div className="cal-day-title">
                  {selectedDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric' })}
                </div>
                <div className="cal-day-label">
                  {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {(schedule[formatDate(selectedDate)] || []).length} booking(s)
                </div>
                <ConnectionBadge status={connectionStatus} lastUpdated={lastUpdated} />
              </div>
            </div>

            <div className="room-grid">
              {allRooms.map(roomId => {
                const dayBookings = schedule[formatDate(selectedDate)] || [];
                const roomBookings = dayBookings.filter(b => b.room_number === roomId);
                const isBusy = roomBookings.length > 0;

                return (
                  <div key={roomId} className="room-card">
                    <div className="room-card-head">
                      <div className="room-card-id">{roomId}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div className={`room-status-dot ${isBusy ? 'busy' : ''}`} />
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: '700',
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          color: isBusy ? '#ffb547' : '#00e5a0',
                        }}>
                          {isBusy ? `${roomBookings.length} booked` : 'free'}
                        </span>
                      </div>
                    </div>

                    <div className="room-card-body">
                      {roomBookings.length === 0 ? (
                        <div className="available">✓ Available all day</div>
                      ) : (
                        roomBookings
                          .sort((a, b) => a.start_time?.localeCompare(b.start_time))
                          .map((b, i) => (
                            <div key={i} className={`time-slot ${b.status?.toLowerCase()}`}>
                              <div>
                                <div style={{ fontWeight: '700' }}>{b.start_time} – {b.end_time}</div>
                                <div style={{ fontSize: '9px', opacity: 0.6, marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                  {b.owner_role} · {b.booking_id}
                                </div>
                              </div>
                              <span style={{
                                fontSize: '8px', fontWeight: '700', padding: '2px 6px',
                                borderRadius: '3px', letterSpacing: '0.08em',
                                background: (b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED') ? 'rgba(0,229,160,0.15)' : 'rgba(255,181,71,0.15)',
                                color: (b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED') ? '#00e5a0' : '#ffb547',
                              }}>
                                {b.status?.toUpperCase()}
                              </span>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Full day timeline for selected date */}
            {(schedule[formatDate(selectedDate)] || []).length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <div className="calendar-section-title" style={{ marginBottom: '16px' }}>All Bookings — {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(schedule[formatDate(selectedDate)] || [])
                    .sort((a, b) => a.start_time?.localeCompare(b.start_time))
                    .map((b, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '16px',
                        padding: '12px 16px',
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderLeft: `3px solid ${(b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED') ? '#00e5a0' : '#ffb547'}`,
                        borderRadius: 'var(--radius-sm)',
                        animation: 'cardIn 0.3s ease',
                      }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: '700', color: 'var(--text-main)', minWidth: '120px' }}>
                          {b.start_time} – {b.end_time}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#00e5a0', minWidth: '80px' }}>
                          {b.room_number}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', flex: 1 }}>
                          {b.booking_id} · {b.owner_role}
                        </div>
                        <span style={{
                          fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '3px',
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          background: (b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED') ? 'rgba(0,229,160,0.1)' : 'rgba(255,181,71,0.1)',
                          color: (b.status === 'Approved' || b.status?.toUpperCase() === 'APPROVED') ? '#00e5a0' : '#ffb547',
                        }}>
                          {b.status}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
