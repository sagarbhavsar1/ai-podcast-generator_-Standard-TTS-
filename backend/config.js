const path = require("path");

// Default development paths
const devPaths = {
  UPLOADS_DIR: path.join(__dirname, "../uploads/"),
  TEMP_DIR: path.join(__dirname, "../temp/"),
  OUTPUT_DIR: path.join(__dirname, "../public/podcasts/"),
};

// Configuration based on environment
const config = {
  // File paths - use environment variables if defined, else use development paths
  UPLOADS_DIR: process.env.UPLOADS_DIR || devPaths.UPLOADS_DIR,
  TEMP_DIR: process.env.TEMP_DIR || devPaths.TEMP_DIR,
  OUTPUT_DIR: process.env.OUTPUT_DIR || devPaths.OUTPUT_DIR,

  // Ensure all directories exist
  ensureDirectories: async () => {
    const fs = require("fs-extra");
    await fs.ensureDir(config.UPLOADS_DIR);
    await fs.ensureDir(config.TEMP_DIR);
    await fs.ensureDir(config.OUTPUT_DIR);
    console.log("Storage directories confirmed");
  },
};

module.exports = config;
