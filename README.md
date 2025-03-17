# AI Podcast Generator

Transform PDF documents into engaging podcast conversations using AI.

## Features

- Upload PDF documents (up to 50MB)
- Extract text content automatically
- Generate natural-sounding podcast scripts with DeepSeek-R1-Distill-Llama-70B
- Convert scripts to audio using Kokoro TTS
- Get a concise 10-15 minute podcast regardless of document length
- Download generated podcasts

## Tech Stack

### Frontend

- React.js
- Axios for API requests
- CSS for styling

### Backend

- Node.js with Express
- PDF text extraction with pdf-parse
- DeepSeek-R1-Distill-Llama-70B via Groq API
- Kokoro TTS for audio generation
- Rate limiting with express-rate-limit

## Getting Started

### Prerequisites

- Node.js (v14+)
- Python 3.8+ (for TTS)
- Groq API key

### Installation

1. Clone the repository
   git clone https://github.com/sagarbhavsar1/ai-podcast-generator.git
   cd ai-podcast-generator

2. Install backend dependencies
   cd backend
   npm install

3. Install frontend dependencies
   cd ../frontend
   npm install

4. Create a `.env` file in the backend directory
   GROQ_API_KEY=your_groq_api_key_here

5. Start the backend server
   cd ../backend
   npm run dev

6. Start the frontend development server
   cd ../frontend
   npm start

7. Open your browser and navigate to `http://localhost:3001`

## Usage

1. Upload a PDF document using the file selector
2. Click "Upload & Generate Podcast"
3. Wait for the processing to complete
4. Listen to your podcast directly in the browser
5. Download the audio file if desired

## How It Works

1. **PDF Processing**: The application extracts text from uploaded PDFs.
2. **Script Generation**: The extracted text is sent to DeepSeek-R1-Distill-Llama-70B via Groq API, which generates a conversational podcast script between two hosts.
3. **Audio Synthesis**: The script is processed by Kokoro TTS to create natural-sounding voices for each host.
4. **Delivery**: The final podcast is made available for playback and download.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
