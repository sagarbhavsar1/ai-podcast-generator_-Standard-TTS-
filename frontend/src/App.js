import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import "./App.css";
import {
  FaCloudUploadAlt,
  FaSpinner,
  FaDownload,
  FaPlay,
  FaPause,
  FaGithub,
  FaFileAlt,
  FaClock,
  FaHeadphones,
  FaAccessibleIcon,
} from "react-icons/fa";

function App() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [podcastData, setPodcastData] = useState(null);
  const [error, setError] = useState(null);
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [podcastGenerated, setPodcastGenerated] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadSectionRef = useRef(null); // Add ref for upload section

  // Handle file selection through the file input
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    validateAndSetFile(selectedFile);
  };

  // Validate file type and size
  const validateAndSetFile = (file) => {
    setFileError(null);

    if (!file) {
      setSelectedFile(null);
      setFile(null);
      return;
    }

    if (file.type !== "application/pdf") {
      setFileError("Please select a PDF file");
      setSelectedFile(null);
      setFile(null);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      // 50MB
      setFileError("File size exceeds 50MB limit");
      setSelectedFile(null);
      setFile(null);
      return;
    }

    setSelectedFile(file);
    setFile(file);
  };

  // Handle drag and drop events
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    // Log what's being dropped to debug issues
    console.log("File dropped:", e.dataTransfer.files);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      console.log(
        "Processing dropped file:",
        droppedFile.name,
        droppedFile.type
      );
      validateAndSetFile(droppedFile);
    } else {
      console.error("No files were dropped");
    }
  };

  const handleRemoveFile = () => {
    // Clear the selected file
    setSelectedFile(null);
    setFile(null);
    setFileError(null);
    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle upload and podcast generation
  const handleUpload = async () => {
    if (!file) {
      setError("Please select a PDF file first.");
      return;
    }

    try {
      // Use relative URL instead of trying to detect the API endpoint
      const uploadUrl = "/api/upload";

      console.log(`Uploading to: ${uploadUrl}`);

      setError(null);
      setIsProcessing(true);
      setIsUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append("pdf", file);

      const response = await axios.post(uploadUrl, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(percentCompleted);
        },
        timeout: 30000, // 30 second timeout
      });

      setIsUploading(false);
      setUploadProgress(100);

      // Start podcast generation
      await generatePodcast(response.data.text, response.data.filename);
    } catch (err) {
      setIsProcessing(false);
      setIsUploading(false);

      // Better error messaging
      const errorMessage = err.response
        ? `Error: ${err.response.status} - ${
            err.response.statusText || "Server error"
          }`
        : err.message || "Network error - please check server connection";

      setError(`Failed to upload PDF: ${errorMessage}`);
      console.error("Upload error:", err);
    }
  };

  const generatePodcast = async (text, filename) => {
    try {
      setIsGenerating(true);
      setGenerationProgress(0);

      // Use relative URL instead of trying to detect the API endpoint
      const generateUrl = "/api/generate";

      console.log(`Generating podcast at: ${generateUrl}`);

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

      const response = await axios.post(generateUrl, {
        text,
        filename,
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setIsGenerating(false);
      setPodcastData(response.data);
      setPodcastGenerated(true);
      setIsProcessing(false);
    } catch (err) {
      setIsGenerating(false);
      setIsProcessing(false);
      setError("Failed to generate podcast. Please try again.");
      console.error("Generation error:", err);
    }
  };

  // Handle audio player controls
  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  // Add effect to handle scrolling when upload section is shown
  useEffect(() => {
    if (showUploadSection && uploadSectionRef.current) {
      // Small delay to ensure DOM updates before scrolling
      setTimeout(() => {
        uploadSectionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    }
  }, [showUploadSection]);

  return (
    <div className="app-container">
      {/* Header with PDFCast branding */}
      <header
        className="header"
        style={{
          padding: "10px 5%",
          height: "auto",
          minHeight: "50px",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <div
          className="logo"
          style={{ marginLeft: "10px", display: "flex", alignItems: "center" }}
        >
          <img
            src={process.env.PUBLIC_URL + "/images/logo.png"}
            alt="PDFcast Logo"
            className="logo-image"
            style={{ height: "30px", marginRight: "8px" }}
          />
          PDFCast
        </div>
        <nav className="nav-links" style={{ marginRight: "10px" }}>
          <a
            href="https://github.com/sagarbhavsar1/ai-podcast-generator"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link github-link"
            title="View project on GitHub"
          >
            <FaGithub />
          </a>
        </nav>
      </header>

      <main className="main-content">
        <section className="hero-section">
          <h1
            className="main-heading"
            style={{
              fontSize: "clamp(1.8rem, 5vw, 2.5rem)",
              margin: "clamp(15px, 3vh, 25px) 0",
              fontWeight: "700",
              padding: "0 15px",
            }}
          >
            Transform your PDF📄 into an Engaging Podcast🎙️
          </h1>

          {!showUploadSection && (
            <>
              <button
                onClick={() => setShowUploadSection(true)}
                className="get-started-btn"
                style={{ marginBottom: "1.5rem" }}
              >
                Get Started
              </button>

              {/* Diagram section - only show when upload section is not visible */}
              <div
                className="process-diagram"
                style={{
                  maxWidth: "100%",
                  height: "clamp(200px, 40vw, 350px)",
                  margin: "0 auto 2rem",
                  overflow: "hidden",
                  padding: "0 20px",
                }}
              >
                <img
                  src={process.env.PUBLIC_URL + "/images/process-diagram.png"}
                  alt="PDF to Podcast conversion process"
                  className="diagram-image"
                  style={{
                    maxHeight: "100%",
                    width: "100%",
                    objectFit: "contain",
                  }}
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src =
                      process.env.PUBLIC_URL + "/placeholder-diagram.png";
                    console.log(
                      "Process diagram image failed to load, using placeholder"
                    );
                  }}
                />
              </div>
            </>
          )}
        </section>

        {showUploadSection && (
          <>
            {/* Add spacing div to create separation */}
            <div style={{ height: "20px", clear: "both" }}></div>

            <section
              ref={uploadSectionRef}
              className="upload-section"
              style={{
                marginTop: "2rem",
                clear: "both",
                position: "relative",
                zIndex: 2,
              }}
            >
              {!isProcessing && !podcastGenerated ? (
                <div className="upload-container">
                  <h2>Upload your PDF document</h2>
                  <div
                    className={`upload-area ${isDragActive ? "active" : ""}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                  >
                    <FaCloudUploadAlt className="upload-icon" />
                    <p>Convert your PDF to a podcast</p>

                    <button
                      className="browse-button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="browse-button-icon">📄</span> Select a
                      PDF
                    </button>

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".pdf"
                      className="file-input"
                    />

                    <div className="upload-separator">
                      <span>or</span>
                    </div>

                    <p>Drop your file here</p>
                    <p className="file-size-note">Maximum file size: 50MB</p>
                  </div>

                  {selectedFile && (
                    <div className="file-info-container">
                      <span className="selected-file">{selectedFile.name}</span>
                      <button
                        className="remove-file-btn"
                        onClick={handleRemoveFile}
                        title="Remove selected file"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {fileError && <p className="error-message">{fileError}</p>}
                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile || fileError}
                    className="upload-button"
                  >
                    Upload & Generate Podcast
                  </button>
                </div>
              ) : isProcessing ? (
                <div className="processing-container">
                  <h2>Processing your PDF</h2>

                  {isUploading && (
                    <div className="progress-section">
                      <p>Uploading PDF file...</p>
                      <div className="progress-bar-container">
                        <div
                          className="progress-bar"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                      <p className="progress-percentage">{uploadProgress}%</p>
                    </div>
                  )}

                  {isGenerating && (
                    <div className="progress-section">
                      <p>Generating podcast...</p>
                      <div className="progress-bar-container">
                        <div
                          className="progress-bar"
                          style={{ width: `${generationProgress}%` }}
                        ></div>
                      </div>
                      <p className="progress-percentage">
                        {generationProgress}%
                      </p>
                    </div>
                  )}

                  <div className="loading-icon">
                    <FaSpinner className="spinner" />
                  </div>
                  <p className="processing-info">
                    This may take a few minutes. Good things take time :)
                  </p>
                </div>
              ) : (
                <div className="podcast-player">
                  <h2>Your Podcast is Ready!</h2>
                  <div className="audio-player-container">
                    <div className="audio-controls">
                      <button
                        className="play-pause-btn"
                        onClick={togglePlayPause}
                      >
                        {isPlaying ? <FaPause /> : <FaPlay />}
                      </button>
                      <audio
                        ref={audioRef}
                        src={podcastData?.audioUrl || ""}
                        onEnded={handleAudioEnded}
                        controls
                      />
                    </div>
                  </div>

                  <div className="download-section">
                    <a
                      href={podcastData?.audioUrl || "#"}
                      download
                      className="download-btn"
                    >
                      <FaDownload /> Download Podcast
                    </a>
                  </div>

                  {podcastData?.script && (
                    <div className="script-container">
                      <h3>Podcast Script</h3>
                      <div className="script-content">
                        {podcastData.script.split("\n").map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    className="new-podcast-btn"
                    onClick={() => {
                      setPodcastGenerated(false);
                      setPodcastData(null);
                      setSelectedFile(null);
                      setFile(null);
                    }}
                  >
                    Create Another Podcast
                  </button>
                </div>
              )}

              {error && <p className="error-message">{error}</p>}
            </section>

            {/* Why PDFCast section - fixed structure */}
            <section className="why-pdfcast-section">
              <div className="why-pdfcast-container">
                <h2 className="why-pdfcast-title">Why PDFcast?</h2>

                <div className="feature-cards">
                  <div className="feature-card">
                    <div className="feature-icon">
                      <FaFileAlt />
                    </div>
                    <h3>Any PDF Becomes a Podcast</h3>
                    <p>
                      Transform documents up to 50MB into engaging
                      conversations. Research papers, articles, reports, class
                      readings? PDFcast's got you covered.
                    </p>
                  </div>

                  <div className="feature-card">
                    <div className="feature-icon">
                      <FaClock />
                    </div>
                    <h3>Save Time</h3>
                    <p>
                      Listen to your content on the go. Save time by
                      multitasking 😎
                    </p>
                  </div>

                  <div className="feature-card">
                    <div className="feature-icon">
                      <FaHeadphones />
                    </div>
                    <h3>Natural Conversations</h3>
                    <p>
                      PDFcast creates dynamic dialogues between two distinct
                      hosts, breaking down complex concepts in an entertaining
                      way.
                    </p>
                  </div>

                  <div className="feature-card">
                    <div className="feature-icon">
                      <FaAccessibleIcon />
                    </div>
                    <h3>Enhanced Accessibility</h3>
                    <p>
                      Make your content accessible to those with visual
                      impairments or reading difficulties.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="footer">
        <p>&copy; 2025 PDFCast - Sagar Bhavsar</p>
      </footer>
    </div>
  );
}

export default App;
