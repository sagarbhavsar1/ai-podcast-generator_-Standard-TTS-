# 🎙️ PDFCast - AI Podcast Generator 🤖

![PDFCast Banner](frontend/public/images/logo.png)

## 🌟 Overview

PDFCast is a powerful web application that transforms PDF documents into engaging podcast-style conversations between two AI hosts. Simply upload your PDF, and our application will:

1. Extract and analyze the text content
2. Generate a conversational podcast script using advanced AI
3. Convert the script into natural-sounding audio with AWS Polly neural voices
4. Deliver a ready-to-listen podcast with full transcript

Perfect for turning research papers, reports, articles, or any text document into accessible audio content you can enjoy on the go!

## ✨ Key Features

- 📄 **PDF Intelligence**: Process documents up to 50MB with advanced text extraction
- 🎭 **Dual-Host Format**: AI-generated dialogue between two hosts (Joanna & Matthew) with distinct personalities
- 🎧 **Studio-Quality Audio**: Lifelike speech using AWS Polly neural voice technology
- ⏱️ **Perfect Duration**: Automatically generates 10-15 minute podcast episodes
- 💬 **Natural Conversation**: Includes intuitive pauses, emphasis, and conversational elements
- 📱 **Responsive Design**: Clean, modern interface that works on desktop and mobile devices
- 📝 **Complete Transcripts**: Access the full podcast script alongside the audio player
- ⚡ **Smart Processing**: Handles documents of any length with intelligent chunking
- 🔄 **Batch Processing**: Queue multiple documents for back-to-back processing
- 🔒 **Privacy-Focused**: All processing happens on secure servers with no data retention

## 💰 AWS Polly Usage & Cost Management

### Free Tier Limits

PDFCast uses AWS Polly for text-to-speech synthesis with different voice engines offering varying quality levels and free tier limits:

- **Standard Voices**: 5 million free characters per month
- **Neural Voices**: 1 million free characters per month
- **Generative Voices**: 100,000 free characters per month

After exceeding these limits, charges apply at the following rates:

- Standard: $4.00 per million characters
- Neural: $16.00 per million characters
- Generative: $24.00 per million characters

### Budget Controls

To prevent unexpected costs, we implement AWS Budget controls:

1. **Budget Alert**: A $0.50 monthly budget threshold is set for AWS Polly usage
2. **Automated Actions**: When usage reaches $0.50, an AWS IAM policy automatically restricts further Polly access
3. **Monthly Reset**: The budget and access controls reset at the beginning of each month

These measures ensure the application remains cost-effective while providing high-quality audio output.

## 🛠️ Technology Stack

### Frontend

- **React.js**: Modern component-based UI framework
- **CSS3**: Custom responsive design with flexbox layout
- **Axios**: Promise-based HTTP client for API requests
- **React Audio Player**: Enhanced audio playback experience
- **File Upload Component**: Drag-and-drop interface with progress indication

### Backend

- **Node.js**: JavaScript runtime for server-side operations
- **Express**: Fast, minimalist web framework for API handling
- **PDF.js**: Mozilla's PDF extraction library with OCR fallback
- **AWS SDK**: Interface with Amazon Web Services
- **Groq API**: Integration with Groq's large language model API
- **AWS Polly**: Neural text-to-speech synthesis
- **FFmpeg**: Audio processing and enhancement (optional)
- **File System Operations**: Efficient handling of temporary files and disk storage

### AI/ML Components

- **Text Processing**: Natural language processing for content analysis
- **AWS Polly Neural Voices**: State-of-the-art realistic speech synthesis
- **Groq Integration**: Fast inference using large language model
- **Content Summarization**: Smart extraction of key concepts
- **Conversational Script Generation**: Transform formal text into natural dialogue

## 📊 How It Works

1. **Upload Phase**

   - User uploads PDF through drag-and-drop or file selection interface
   - Backend performs initial validation checks (file type, size, corruption)
   - PDF is saved to temporary storage for processing

2. **Text Extraction**

   - PDF.js extracts text content with layout preservation
   - OCR fallback for scanned documents or images
   - Text cleaning and normalization

3. **Content Analysis**

   - Document is analyzed for key topics, themes, and structure
   - Content is chunked for optimal processing
   - Important sections are identified for emphasis

4. **Script Generation**

   - Groq API transforms the content into conversational format
   - Dialogue is distributed between two host personalities
   - Script is optimized for natural speech patterns and flow

5. **Audio Synthesis**

   - AWS Polly generates high-quality neural TTS audio
   - Host A uses Joanna voice, Host B uses Matthew voice
   - Audio segments are processed with appropriate timing and pauses

6. **Post-Processing**

   - Audio segments are merged into a cohesive podcast
   - Optional enhancement for consistent volume and quality
   - Final file is encoded in MP3 format for efficient streaming

7. **Delivery**
   - User receives completed podcast audio and transcript
   - Streaming audio player with standard controls
   - Download options for offline listening

## 📋 Requirements

### System Requirements

- Node.js 16+ (LTS recommended)
- npm 7+ or yarn 1.22+
- 2GB+ free disk space
- Modern web browser (Chrome, Firefox, Safari, Edge)

### API Keys

- AWS account with Polly access
- Groq API key

### Optional Components

- FFmpeg for enhanced audio processing

## 🚀 Installation

### Clone the Repository

```bash
git clone https://github.com/yourusername/ai-podcast-generator.git
cd ai-podcast-generator
```

### Backend Setup

```bash
cd backend
npm install

# Create environment configuration
cp .env.example .env
```

Edit the `.env` file and add your API keys:

```
# AWS Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# Groq API Configuration
GROQ_API_KEY=your_groq_api_key

# Server Configuration
PORT=3000
MAX_PDF_SIZE_MB=50
MAX_CONCURRENT_JOBS=3
```

### Frontend Setup

```bash
cd ../frontend
npm install

# Create environment configuration
cp .env.example .env
```

Edit the frontend `.env` file:

```
REACT_APP_API_URL=http://localhost:3000
REACT_APP_MAX_FILE_SIZE=52428800  # 50MB in bytes
```

### Create Required Directories

```bash
mkdir -p backend/uploads
mkdir -p backend/temp
mkdir -p public/podcasts
```

### Install FFmpeg (Optional but Recommended)

- **macOS**: `brew install ffmpeg`
- **Ubuntu/Debian**: `sudo apt install ffmpeg`
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH

### Test AWS Polly Setup

```bash
cd backend
node test-polly.js

# Or for a more detailed check:
node polly-status.js
```

If successful, you'll see a confirmation message and test audio files will be created.

## 🏃‍♂️ Running the Application

### Development Mode

#### Start the Backend Server

```bash
cd backend
npm run dev
```

#### Start the Frontend Development Server

```bash
cd frontend
npm start
```

The application will be available at [http://localhost:3000](http://localhost:3000)

### Production Mode

#### Build the Frontend

```bash
cd frontend
npm run build
```

#### Start Production Server

```bash
cd backend
npm start
```

The application will be available at the configured port, default [http://localhost:3000](http://localhost:3000)

## 🖥️ Application Structure

### Directory Structure

```
ai-podcast-generator/
├── backend/                   # Server-side code
│   ├── app.js                 # Main Express application
│   ├── aws_polly_tts.js       # AWS Polly integration
│   ├── document_processor.js  # PDF extraction and processing
│   ├── script_generator.js    # AI conversation generation
│   ├── audio_utils.js         # Audio processing utilities
│   ├── routes/                # API route definitions
│   ├── middleware/            # Express middleware
│   ├── uploads/               # Temporary PDF storage
│   └── temp/                  # Temporary processing files
├── frontend/                  # Client-side React application
│   ├── public/                # Static assets
│   │   ├── images/            # App images and icons
│   │   └── podcasts/          # Generated audio output
│   └── src/                   # React source files
│       ├── components/        # Reusable UI components
│       ├── pages/             # Page components
│       ├── services/          # API service connectors
│       ├── utils/             # Helper utilities
│       ├── styles/            # CSS stylesheets
│       ├── App.js             # Main React component
│       └── index.js           # React entry point
├── docs/                      # Documentation
├── .env.example               # Example environment variables
└── README.md                  # Project documentation
```

### Key Components

#### Document Processing Pipeline

The PDF processing pipeline handles document upload, text extraction, and content preparation:

- `document_processor.js`: Main document handling module
- `pdf_extractor.js`: PDF text extraction with OCR fallback
- `text_processor.js`: Text cleaning and normalization

#### Script Generation System

The AI conversation system transforms content into engaging dialogue:

- `script_generator.js`: Main script generation logic
- `groq_service.js`: Interface with Groq API
- `conversation_enhancer.js`: Improves flow and naturalness

#### Audio Synthesis Engine

The TTS system converts scripts into natural-sounding audio:

- `aws_polly_tts.js`: AWS Polly integration
- `audio_utils.js`: Audio processing and enhancement
- `podcast_assembler.js`: Final audio file generation

## ⚙️ Configuration Options

The application includes extensive configuration options in the `.env` file:

### Server Configuration

- `PORT`: Server listening port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)
- `MAX_PDF_SIZE_MB`: Maximum PDF file size in MB (default: 50)
- `MAX_CONCURRENT_JOBS`: Number of simultaneous processing jobs (default: 3)
- `TEMP_FILE_CLEANUP_HOURS`: Hours before cleaning temporary files (default: 24)

### AWS Polly Configuration

- `AWS_REGION`: AWS region for Polly API
- `AWS_ACCESS_KEY_ID`: Your AWS access key
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret key
- `TTS_ENGINE`: TTS engine type (neural/standard/generative)
- `HOST_A_VOICE`: AWS Polly voice for Host A (default: "Joanna")
- `HOST_B_VOICE`: AWS Polly voice for Host B (default: "Matthew")
- `POLLY_LANGUAGE_CODE`: Language code for TTS (default: "en-US")

### Groq API Configuration

- `GROQ_API_KEY`: Your Groq API key
- `GROQ_MODEL`: Model to use (default: "mixtral-8x7b-32768")
- `GROQ_MAX_TOKENS`: Maximum response tokens (default: 4096)
- `GROQ_TEMPERATURE`: Model temperature setting (default: 0.7)

### Content Configuration

- `TARGET_PODCAST_MINUTES`: Target podcast length in minutes (default: 12)
- `WORDS_PER_MINUTE`: Speech rate for duration calculation (default: 160)
- `MAX_CHUNK_SIZE`: Maximum chunk size for processing (default: 12000)
- `INCLUDE_REFERENCES`: Whether to include reference sections (default: false)

## 🛡️ Security Considerations

- 🔒 The application implements rate limiting to prevent API abuse
- 🔍 All file uploads are validated and sanitized
- 🔐 AWS credentials are stored securely in environment variables
- 📊 File size limits prevent resource exhaustion
- 🗑️ Temporary files are automatically cleaned up
- 🚫 Input sanitization prevents injection attacks

## 🎯 Use Cases

- **Academic Papers**: Make research accessible through audio format
- **Business Reports**: Transform quarterly reports into executive briefings
- **News Articles**: Convert long-form journalism into podcast episodes
- **Documentation**: Turn technical documentation into learning materials
- **Books & Literature**: Create audio snippets of books or chapters
- **Legal Documents**: Make complex legal text more approachable
- **Medical Information**: Convert health information into digestible content

## 🧪 Testing

### Unit Tests

```bash
cd backend
npm test
```

### Frontend Tests

```bash
cd frontend
npm test
```

### Integration Tests

```bash
npm run test:integration
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure your code follows the project's coding standards and includes appropriate tests.

## 🙏 Acknowledgements

- [AWS Polly](https://aws.amazon.com/polly/) for neural text-to-speech capabilities
- [Groq API](https://groq.com/) for fast language model inference
- [PDF.js](https://mozilla.github.io/pdf.js/) for PDF text extraction
- [React](https://reactjs.org/) for the frontend framework
- [Express](https://expressjs.com/) for the backend API
- [FFmpeg](https://ffmpeg.org/) for audio processing capabilities

## 🔮 Future Roadmap

- 🌐 Multi-language support with international voices
- 🎨 Custom voice styles and personality options
- 📊 Advanced analytics on document content
- 📱 Mobile app version for iOS and Android
- 🔄 API endpoints for third-party integration
- 🎛️ More audio customization options
- 📝 Custom editing of generated scripts before TTS

## 📞 Contact & Support

- **Project Link**: [https://github.com/yourusername/ai-podcast-generator](https://github.com/yourusername/ai-podcast-generator)
- **Issues**: Please report bugs through the GitHub issues page
- **Questions**: Get in touch with the developer: https://www.linkedin.com/in/sagarbhavsar1/

---

Made with ❤️ by Sagar Bhavsar

## 📜 License

This project is licensed under the MIT License.
