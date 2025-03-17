import React, { useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [podcastData, setPodcastData] = useState(null);
  const [error, setError] = useState(null);
  // Removed podcastLength state

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a PDF file first.");
      return;
    }

    try {
      setError(null);
      setIsUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append("pdf", file);

      const response = await axios.post(
        "http://localhost:3000/api/upload",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setUploadProgress(percentCompleted);
          },
        }
      );

      setIsUploading(false);
      setUploadProgress(100);

      // Start podcast generation
      await generatePodcast(response.data.text, response.data.filename);
    } catch (err) {
      setIsUploading(false);
      setError("Failed to upload PDF. Please try again.");
      console.error("Upload error:", err);
    }
  };

  const generatePodcast = async (text, filename) => {
    try {
      setIsGenerating(true);
      setGenerationProgress(0);

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        });
      }, 3000);

      const response = await axios.post("http://localhost:3000/api/generate", {
        text,
        filename,
        // Removed podcastLength parameter
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setIsGenerating(false);
      setPodcastData(response.data);
    } catch (err) {
      setIsGenerating(false);
      setError("Failed to generate podcast. Please try again.");
      console.error("Generation error:", err);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>AI Podcast Generator</h1>
        <p>Transform your PDF documents into engaging podcasts</p>
      </header>

      <main className="App-main">
        <div className="upload-container">
          <h2>Upload a PDF</h2>
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={isUploading || isGenerating}
          />

          {/* Removed podcast length selector */}

          <button
            onClick={handleUpload}
            disabled={!file || isUploading || isGenerating}
            className="upload-button"
          >
            {isUploading ? "Uploading..." : "Upload & Generate Podcast"}
          </button>

          {error && <div className="error-message">{error}</div>}
        </div>

        {isUploading && (
          <div className="progress-container">
            <h3>Uploading PDF</h3>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p>{uploadProgress}%</p>
          </div>
        )}

        {isGenerating && (
          <div className="progress-container">
            <h3>Generating Podcast</h3>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${generationProgress}%` }}
              ></div>
            </div>
            <p>{generationProgress}%</p>
          </div>
        )}

        {podcastData && (
          <div className="podcast-container">
            <h2>Your Podcast is Ready!</h2>

            <div className="audio-player">
              <h3>Listen to Your Podcast</h3>
              <audio
                controls
                src={`http://localhost:3000${podcastData.audioUrl}`}
              >
                Your browser does not support the audio element.
              </audio>
              <a
                href={`http://localhost:3000${podcastData.audioUrl}`}
                download
                className="download-button"
              >
                Download Audio
              </a>
            </div>

            <div className="podcast-script">
              <h3>Podcast Script</h3>
              <div className="script-content">
                {podcastData.script.split("\n").map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="App-footer">
        <p>&copy; 2025 PDFCast</p>
      </footer>
    </div>
  );
}

export default App;
