import React, { useState } from "react";
import SpeechInput from "./components/SpeechInput";

export default function App() {
  const [transcript, setTranscript] = useState("");

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f5f3",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      fontFamily: "sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 600,
        background: "#fff",
        borderRadius: 16,
        border: "0.5px solid #e0dfd8",
        padding: "2rem",
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 0 }}>
          Speech to Text
        </h1>
        <p style={{ color: "#888", fontSize: 14, marginBottom: "1.5rem" }}>
          Start speaking — works on Chrome, Edge, Safari and Firefox.
        </p>

        {/* ← Drop this one line anywhere in your real website */}
        <SpeechInput onTranscript={(text) => setTranscript(text)} />

        {transcript && (
          <div style={{
            marginTop: "1.5rem",
            padding: "12px 16px",
            background: "#f0f9f5",
            borderRadius: 8,
            fontSize: 13,
            color: "#555",
          }}>
            <strong>Captured text:</strong> {transcript}
          </div>
        )}
      </div>
    </div>
  );
}