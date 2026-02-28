import React, { useRef, useEffect, useState } from 'react';
import Webcam from 'react-webcam';
import * as faceapi from 'face-api.js';

export default function FaceLogin({ onLoginSuccess }) {
  const webcamRef = useRef(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [status, setStatus] = useState("Initializing biometric systems...");
  const [phase, setPhase] = useState("loading"); // loading | scanning | detected | success | error
  const [faceMatcher, setFaceMatcher] = useState(null);
  const [detectedRole, setDetectedRole] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const loadModelsAndFaces = async () => {
      try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        const steps = [
          { name: 'ssdMobilenetv1', label: 'Loading face detector...' },
          { name: 'faceLandmark68Net', label: 'Loading landmark model...' },
          { name: 'faceRecognitionNet', label: 'Loading recognition engine...' },
          { name: 'faceExpressionNet', label: 'Loading liveness detector...' },
        ];

        for (let i = 0; i < steps.length; i++) {
          setStatus(steps[i].label);
          setProgress(Math.round(((i + 0.5) / (steps.length + 2)) * 100));
          await faceapi.nets[steps[i].name].loadFromUri(MODEL_URL);
        }

        setStatus("Training identity database...");
        setProgress(70);

        const roles = ['admin', 'teacher', 'student'];
        const labeledDescriptors = [];

        for (const role of roles) {
          try {
            const imgElement = new Image();
            imgElement.crossOrigin = "anonymous";
            await new Promise((resolve, reject) => {
              imgElement.onload = resolve;
              imgElement.onerror = () => reject(new Error(`Failed to load ${role}.jpeg`));
              imgElement.src = `/faces/${role}.jpeg`;
            });
            const detection = await faceapi.detectSingleFace(imgElement).withFaceLandmarks().withFaceDescriptor();
            if (detection) {
              labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(role, [detection.descriptor]));
            }
          } catch (imgErr) {
            console.error(`Error loading image for ${role}:`, imgErr);
          }
        }

        setProgress(95);

        if (labeledDescriptors.length > 0) {
          const matcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
          setFaceMatcher(matcher);
          setIsModelLoaded(true);
          setPhase("scanning");
          setProgress(100);
          setStatus("Align your face with the scanner");
        } else {
          setStatus("Error: No reference faces found.");
          setPhase("error");
        }
      } catch (err) {
        console.error(err);
        setStatus("System initialization failed.");
        setPhase("error");
      }
    };

    loadModelsAndFaces();
  }, []);

  useEffect(() => {
    if (!isModelLoaded || !webcamRef.current || !faceMatcher) return;

    const interval = setInterval(async () => {
      const video = webcamRef.current?.video;
      if (video && video.readyState === 4) {
        try {
          const detection = await faceapi.detectSingleFace(video)
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptor();

          if (detection) {
            const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
            if (bestMatch.label !== 'unknown') {
              setDetectedRole(bestMatch.label);
              const isSmiling = detection.expressions.happy > 0.8;
              if (isSmiling) {
                setPhase("success");
                setStatus(`Identity confirmed — ${bestMatch.label.toUpperCase()}`);
                clearInterval(interval);
                setTimeout(() => onLoginSuccess(bestMatch.label), 1800);
              } else {
                setPhase("detected");
                setStatus(`${bestMatch.label.toUpperCase()} detected — smile to authenticate`);
              }
            } else {
              setPhase("scanning");
              setDetectedRole(null);
              setStatus("Identity unknown — access denied");
            }
          } else {
            setPhase("scanning");
            setDetectedRole(null);
            setStatus("No face detected — position yourself in frame");
          }
        } catch (e) {
          console.error("Detection error:", e);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isModelLoaded, faceMatcher, onLoginSuccess]);

  const ringColor = {
    loading: '#5a6480',
    scanning: '#7b6cff',
    detected: '#ffb547',
    success: '#00e5a0',
    error: '#ff4d6a',
  }[phase];

  const phaseLabel = {
    loading: 'INIT',
    scanning: 'SCAN',
    detected: 'VERIFY',
    success: 'AUTH',
    error: 'ERR',
  }[phase];

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      background: '#080a0f',
      color: '#e8eaf0',
      fontFamily: "'Space Mono', monospace",
      overflow: 'hidden',
      backgroundImage: `
        radial-gradient(ellipse 60% 50% at 50% 0%, rgba(0,229,160,0.04) 0%, transparent 70%),
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
      `,
      backgroundSize: '100% 100%, 40px 40px, 40px 40px',
    }}>
      {/* Left info panel */}
      <div style={{
        width: '340px',
        flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.06)',
        padding: '48px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div>
          {/* Logo */}
          <div style={{ marginBottom: '48px' }}>
            <div style={{
              fontSize: '11px',
              color: '#00e5a0',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{ fontSize: '14px' }}>◈</span>
              CSIS ResourceBook
            </div>
            <div style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: '28px',
              fontWeight: '800',
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              color: '#fff',
            }}>
              Biometric<br />
              <span style={{ color: '#00e5a0' }}>Access</span> Control
            </div>
          </div>

          {/* System status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '9px', color: '#3a4060', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '4px' }}>
              System Status
            </div>
            {[
              { label: 'Face Detection', status: phase !== 'loading', idx: 0 },
              { label: 'Landmark Model', status: phase !== 'loading', idx: 1 },
              { label: 'Recognition Engine', status: isModelLoaded, idx: 2 },
              { label: 'Liveness Check', status: isModelLoaded, idx: 3 },
            ].map(({ label, status: ok }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: '#5a6480' }}>{label}</span>
                <span style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  letterSpacing: '0.08em',
                  padding: '2px 7px',
                  borderRadius: '3px',
                  background: ok ? 'rgba(0,229,160,0.08)' : 'rgba(90,100,128,0.15)',
                  color: ok ? '#00e5a0' : '#3a4060',
                }}>
                  {ok ? 'OK' : '...'}
                </span>
              </div>
            ))}
          </div>

          {/* Progress bar (only during loading) */}
          {phase === 'loading' && (
            <div style={{ marginTop: '32px' }}>
              <div style={{ fontSize: '9px', color: '#3a4060', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '10px' }}>
                Loading — {progress}%
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '4px', height: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #7b6cff, #00e5a0)',
                  borderRadius: '4px',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Role hint */}
        <div style={{ fontSize: '10px', color: '#3a4060', lineHeight: 1.8 }}>
          <div style={{ color: '#5a6480', marginBottom: '8px', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '9px' }}>Auth roles</div>
          {['ADMIN — Full system access', 'TEACHER — Instant booking', 'STUDENT — CSA approval required'].map(r => (
            <div key={r} style={{ color: '#3a4060' }}>{r}</div>
          ))}
        </div>
      </div>

      {/* Main webcam panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '32px',
        padding: '40px',
        position: 'relative',
      }}>

        {/* Phase badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: ringColor,
            boxShadow: `0 0 8px ${ringColor}`,
            animation: phase !== 'loading' && phase !== 'error' ? 'none' : undefined,
          }} />
          <span style={{
            fontSize: '10px',
            fontWeight: '700',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: ringColor,
          }}>
            {phaseLabel} — {status}
          </span>
        </div>

        {/* Camera frame */}
        <div style={{ position: 'relative' }}>
          {/* Corner decorations */}
          {[
            { top: -8, left: -8, borderTop: `2px solid ${ringColor}`, borderLeft: `2px solid ${ringColor}` },
            { top: -8, right: -8, borderTop: `2px solid ${ringColor}`, borderRight: `2px solid ${ringColor}` },
            { bottom: -8, left: -8, borderBottom: `2px solid ${ringColor}`, borderLeft: `2px solid ${ringColor}` },
            { bottom: -8, right: -8, borderBottom: `2px solid ${ringColor}`, borderRight: `2px solid ${ringColor}` },
          ].map((s, i) => (
            <div key={i} style={{
              position: 'absolute',
              width: '24px',
              height: '24px',
              ...s,
              transition: 'border-color 0.4s ease',
              zIndex: 10,
            }} />
          ))}

          {/* Scan line */}
          {phase === 'scanning' && (
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: '2px',
              background: `linear-gradient(90deg, transparent, ${ringColor}, transparent)`,
              zIndex: 10,
              animation: 'scanAnim 2s linear infinite',
              boxShadow: `0 0 12px ${ringColor}`,
            }} />
          )}

          <div style={{
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: `0 0 40px ${ringColor}22, inset 0 0 0 1px ${ringColor}33`,
            transition: 'box-shadow 0.5s ease',
          }}>
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              width={580}
              height={435}
              videoConstraints={{ facingMode: "user", width: { ideal: 580 }, height: { ideal: 435 } }}
              onUserMediaError={() => setStatus("❌ Camera access denied.")}
              style={{ display: 'block' }}
            />
          </div>

          {/* Success overlay */}
          {phase === 'success' && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,229,160,0.08)',
              borderRadius: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(2px)',
            }}>
              <div style={{
                textAlign: 'center',
                animation: 'fadeIn 0.3s ease',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>✓</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: '24px', fontWeight: '800', color: '#00e5a0' }}>
                  ACCESS GRANTED
                </div>
                <div style={{ fontSize: '12px', color: '#00e5a0', opacity: 0.7, marginTop: '4px', letterSpacing: '0.12em' }}>
                  {detectedRole?.toUpperCase()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Instruction text */}
        <div style={{
          display: 'flex',
          gap: '32px',
          fontSize: '10px',
          color: '#3a4060',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          <span style={{ color: phase === 'scanning' ? '#5a6480' : '#3a4060' }}>① Position face</span>
          <span style={{ color: phase === 'detected' ? '#ffb547' : '#3a4060' }}>② Identity match</span>
          <span style={{ color: phase === 'success' ? '#00e5a0' : '#3a4060' }}>③ Smile to confirm</span>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@800&display=swap');
        @keyframes scanAnim {
          0% { top: 0; }
          50% { top: calc(100% - 2px); }
          100% { top: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
