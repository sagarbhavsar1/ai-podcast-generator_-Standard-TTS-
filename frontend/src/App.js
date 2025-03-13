import React, { useState } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [podcast, setPodcast] = useState(null);
  const [error, setError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file) {
      setError("Please select a PDF file");
      return;
    }

    setLoading(true);
    setError(null);
    setUploadStatus("Uploading PDF...");
    setProcessingProgress(10);

    try {
      // Create form data
      const formData = new FormData();
      formData.append("pdf", file);

      // Upload PDF and get text
      setUploadStatus("Extracting text with OCR...");
      setProcessingProgress(30);
      const uploadResponse = await axios.post(
        "http://localhost:3000/api/upload",
        formData
      );

      setUploadStatus("Generating podcast script...");
      setProcessingProgress(60);

      // Generate podcast
      const generateResponse = await axios.post(
        "http://localhost:3000/api/generate",
        {
          text: uploadResponse.data.text,
          filename: uploadResponse.data.filename,
        }
      );

      setUploadStatus("Creating audio...");
      setProcessingProgress(90);

      setPodcast(generateResponse.data);
      setLoading(false);
      setUploadStatus("");
      setProcessingProgress(100);
    } catch (err) {
      console.error("Error:", err);
      setError("Failed to generate podcast. Please try again in some time.");
      setLoading(false);
      setUploadStatus("");
      setProcessingProgress(0);
    }
  };

  return (
    <div className="container mt-5">
      <div className="row justify-content-center">
        <div className="col-md-8">
          <div className="card shadow-sm">
            <div className="card-body">
              <h1 className="text-center mb-4">PDFcast🎙️</h1>

              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label htmlFor="pdfFile" className="form-label">
                    Upload PDF
                  </label>
                  <input
                    type="file"
                    className="form-control"
                    id="pdfFile"
                    accept=".pdf"
                    onChange={handleFileChange}
                  />
                  <div className="form-text">
                    Upload a PDF to generate a podcast conversation about its
                    content.
                  </div>
                </div>

                <div className="d-grid">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || !file}
                  >
                    {loading ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                          aria-hidden="true"
                        ></span>
                        {uploadStatus}
                      </>
                    ) : (
                      "Generate Podcast"
                    )}
                  </button>
                </div>
              </form>

              {loading && (
                <div className="mt-3">
                  <div className="progress">
                    <div
                      className="progress-bar progress-bar-striped progress-bar-animated"
                      role="progressbar"
                      style={{ width: `${processingProgress}%` }}
                      aria-valuenow={processingProgress}
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      {processingProgress}%
                    </div>
                  </div>
                  <p className="text-center mt-2">{uploadStatus}</p>
                </div>
              )}

              {error && <div className="alert alert-danger mt-3">{error}</div>}

              {podcast && (
                <div className="mt-4">
                  <h3>Your Podcast is Ready!</h3>
                  <div className="card mt-3">
                    <div className="card-body">
                      <h5 className="card-title">Podcast Script</h5>
                      <pre className="script-content">{podcast.script}</pre>
                    </div>
                  </div>
                  <div className="mt-3">
                    <h5>Listen to Podcast</h5>
                    <audio
                      controls
                      className="w-100"
                      onError={(e) => console.error("Audio error:", e)}
                    >
                      <source
                        src={`http://localhost:3000${podcast.audioUrl}`}
                        type="audio/wav"
                      />
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                  <div className="d-grid mt-3">
                    <a
                      className="btn btn-outline-primary"
                      href={`http://localhost:3000${podcast.audioUrl}`}
                      download
                    >
                      Download Podcast
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
