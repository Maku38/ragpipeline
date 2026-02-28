import React, { useRef, useEffect, useState } from 'react';
import Webcam from 'react-webcam';
import * as faceapi from 'face-api.js';

export default function FaceLogin({ onLoginSuccess }) {
  const webcamRef = useRef(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [status, setStatus] = useState("Loading AI Models...");
  const [faceMatcher, setFaceMatcher] = useState(null);

  useEffect(() => {
    const loadModelsAndFaces = async () => {
      try {
        // 💡 NEW: Load models directly from the reliable jsDelivr CDN!
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        
        console.log("Starting to load face-api models...");
        
        try {
          await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
          console.log("✅ ssdMobilenetv1 loaded");
        } catch (e) {
          console.error("❌ Failed to load ssdMobilenetv1:", e);
          throw e;
        }
        
        try {
          await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
          console.log("✅ faceLandmark68Net loaded");
        } catch (e) {
          console.error("❌ Failed to load faceLandmark68Net:", e);
          throw e;
        }
        
        try {
          await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
          console.log("✅ faceRecognitionNet loaded");
        } catch (e) {
          console.error("❌ Failed to load faceRecognitionNet:", e);
          throw e;
        }
        
        try {
          await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
          console.log("✅ faceExpressionNet loaded");
        } catch (e) {
          console.error("❌ Failed to load faceExpressionNet:", e);
          throw e;
        }

        setStatus("Models loaded! Training faces...");
        console.log("All models loaded successfully!");

        // 2. Load your team's reference photos
        const roles = ['admin', 'teacher', 'student'];
        const labeledDescriptors = [];

        for (const role of roles) {
          try {
            // Load image as HTML Image element
            const imgElement = new Image();
            imgElement.crossOrigin = "anonymous";
            
            await new Promise((resolve, reject) => {
              imgElement.onload = resolve;
              imgElement.onerror = () => reject(new Error(`Failed to load ${role}.jpeg`));
              imgElement.src = `/faces/${role}.jpeg`;
            });
            
            // Extract the face detection from the photo
            const detection = await faceapi.detectSingleFace(imgElement)
              .withFaceLandmarks()
              .withFaceDescriptor();
              
            if (detection) {
              labeledDescriptors.push(
                new faceapi.LabeledFaceDescriptors(role, [detection.descriptor])
              );
              console.log(`✅ Face loaded for role: ${role}`);
            } else {
              console.error(`⚠️ Could not find a face in ${role}.jpeg!`);
            }
          } catch (imgErr) {
            console.error(`Error loading image for ${role}:`, imgErr);
          }
        }

        // 3. Create the Face Matcher (60% match threshold)
        if (labeledDescriptors.length > 0) {
          const matcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
          setFaceMatcher(matcher);
          setIsModelLoaded(true);
          setStatus("Align your face and SMILE to log in! 😊");
        } else {
          setStatus("Error: No faces found in reference photos.");
        }

      } catch (err) {
        console.error(err);
        setStatus("Failed to load models. Check console.");
      }
    };

    loadModelsAndFaces();
  }, []);

  // 4. Continuously scan the webcam video
  useEffect(() => {
    if (!isModelLoaded || !webcamRef.current || !faceMatcher) return;

    const interval = setInterval(async () => {
      const video = webcamRef.current?.video;
      if (video && video.readyState === 4) {
        try {
          // Detect face + landmarks + expressions
          const detection = await faceapi.detectSingleFace(video)
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptor();

          if (detection) {
            // Check who it is
            const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
            
            if (bestMatch.label !== 'unknown') {
              // Check if they are smiling! (Liveness Detection)
              const isSmiling = detection.expressions.happy > 0.8; 

              if (isSmiling) {
                setStatus(`✅ Logging in as ${bestMatch.label.toUpperCase()}...`);
                clearInterval(interval);
                setTimeout(() => {
                  onLoginSuccess(bestMatch.label); // Send role back to App.jsx!
                }, 1500);
              } else {
                setStatus(`Hi ${bestMatch.label.toUpperCase()}! Please SMILE to verify you are human.`);
              }
            } else {
              setStatus("Face not recognized. Access Denied.");
            }
          } else {
            setStatus("Align your face with the camera...");
          }
        } catch (detectionErr) {
          console.error("Detection error:", detectionErr);
        }
      }
    }, 500); // Scan every half second

    return () => clearInterval(interval);
  }, [isModelLoaded, faceMatcher, onLoginSuccess]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', 
      justifyContent: 'center', height: '100vh', backgroundColor: '#0b0d14', color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <h1 style={{ marginBottom: '10px' }}>Secure Face Login</h1>
      <p style={{ marginBottom: '30px', color: '#8b949e', fontSize: '18px', fontWeight: 'bold' }}>
        {status}
      </p>
      
      <div style={{ 
        borderRadius: '20px', overflow: 'hidden', border: '4px solid #5c6bc0',
        boxShadow: '0 0 30px rgba(92, 107, 192, 0.4)'
      }}>
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          width={640}
          height={480}
          videoConstraints={{ 
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 }
          }}
          onUserMediaError={(err) => {
            console.error("Webcam error:", err);
            setStatus("❌ Camera access denied. Please enable camera permissions.");
          }}
          onUserMedia={() => {
            console.log("✅ Webcam ready!");
          }}
        />
      </div>
    </div>
  );
}