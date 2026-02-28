// useRealtimeBookings.js
// Single source of truth for all booking/schedule data.
// Strategy: SSE (push) primary → polling fallback if SSE drops.
// Both bookings list AND schedule map stay in sync automatically.

import { useState, useEffect, useRef, useCallback } from 'react';

const API = 'http://localhost:5000';
const POLL_INTERVAL_NORMAL = 30000;  // 30s when SSE is healthy
const POLL_INTERVAL_FALLBACK = 5000; // 5s when SSE is down

export function useRealtimeBookings() {
  const [bookings, setBookings] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // connecting | live | polling | error
  const [lastUpdated, setLastUpdated] = useState(null);

  const sseRef = useRef(null);
  const pollTimerRef = useRef(null);
  const isSSEAlive = useRef(false);

  // ── Core fetch functions ───────────────────────────────────────────────────

  const fetchBookings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/bookings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setBookings(data);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.warn('[Realtime] fetchBookings failed:', e.message);
    }
  }, []);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/schedule`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSchedule(data);
      setLastUpdated(new Date());
    } catch (e) {
      console.warn('[Realtime] fetchSchedule failed:', e.message);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchBookings(), fetchSchedule()]);
  }, [fetchBookings, fetchSchedule]);

  // ── Apply a single SSE event to local state (no full re-fetch needed) ──────
  // This gives instant UI updates without a round-trip.

  const applySSEEvent = useCallback((eventType, newRecord, oldRecord) => {
    if (eventType === 'INSERT' && newRecord) {
      // Add to bookings list (newest first)
      setBookings(prev => {
        // Avoid duplicates (Supabase realtime + manual broadcast)
        if (prev.some(b => b.booking_id === newRecord.booking_id)) return prev;
        return [newRecord, ...prev];
      });

      // Add to schedule map
      if (newRecord.start_date && newRecord.status !== 'Rejected') {
        setSchedule(prev => {
          const date = newRecord.start_date;
          const existing = prev[date] || [];
          if (existing.some(b => b.booking_id === newRecord.booking_id)) return prev;
          return { ...prev, [date]: [...existing, newRecord] };
        });
      }
    }

    if (eventType === 'UPDATE' && newRecord) {
      setBookings(prev =>
        prev.map(b => b.booking_id === newRecord.booking_id ? { ...b, ...newRecord } : b)
      );
      // Re-fetch schedule since status change might affect visibility
      fetchSchedule();
    }

    if (eventType === 'DELETE' && oldRecord) {
      setBookings(prev => prev.filter(b => b.booking_id !== oldRecord.booking_id));
      setSchedule(prev => {
        const date = oldRecord.start_date;
        if (!prev[date]) return prev;
        const filtered = prev[date].filter(b => b.booking_id !== oldRecord.booking_id);
        if (filtered.length === 0) {
          const next = { ...prev };
          delete next[date];
          return next;
        }
        return { ...prev, [date]: filtered };
      });
    }

    setLastUpdated(new Date());
  }, [fetchSchedule]);

  // ── Polling (fallback when SSE is down) ───────────────────────────────────

  const startPolling = useCallback((interval = POLL_INTERVAL_FALLBACK) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(fetchAll, interval);
  }, [fetchAll]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // ── SSE connection ─────────────────────────────────────────────────────────

  const connectSSE = useCallback(() => {
    // Don't double-connect
    if (sseRef.current) {
      sseRef.current.close();
    }

    console.log('[SSE] Connecting...');
    setConnectionStatus('connecting');

    const es = new EventSource(`${API}/api/bookings/stream`);
    sseRef.current = es;

    es.addEventListener('connected', () => {
      console.log('[SSE] Connected ✓');
      isSSEAlive.current = true;
      setConnectionStatus('live');
      // Switch polling to slow background refresh (sanity check only)
      startPolling(POLL_INTERVAL_NORMAL);
      // Immediate full sync on connect
      fetchAll();
    });

    es.addEventListener('booking_change', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[SSE] booking_change:', data.eventType, data.new?.booking_id || data.old?.booking_id);
        applySSEEvent(data.eventType, data.new, data.old);
      } catch (err) {
        console.warn('[SSE] Parse error:', err);
        fetchAll(); // Fallback: full sync
      }
    });

    es.onerror = (err) => {
      console.warn('[SSE] Connection error, switching to fast polling');
      isSSEAlive.current = false;
      setConnectionStatus('polling');
      es.close();
      // Reconnect after 5s
      setTimeout(connectSSE, 5000);
      // Fast polling while SSE is down
      startPolling(POLL_INTERVAL_FALLBACK);
    };
  }, [applySSEEvent, fetchAll, startPolling]);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchAll();      // Immediate initial load
    connectSSE();    // Start SSE

    return () => {
      if (sseRef.current) sseRef.current.close();
      stopPolling();
    };
  }, []); // eslint-disable-line

  // ── Manual trigger (call after AI chat response) ──────────────────────────
  // Even though SSE handles it automatically, the chat response resolves
  // before the DB write + SSE event arrives, so we nudge it.

  const triggerRefresh = useCallback(() => {
    setTimeout(fetchAll, 300); // Small delay to let DB write complete
  }, [fetchAll]);

  return {
    bookings,
    schedule,
    connectionStatus, // 'live' | 'polling' | 'connecting' | 'error'
    lastUpdated,
    triggerRefresh,
    fetchAll,
  };
}
