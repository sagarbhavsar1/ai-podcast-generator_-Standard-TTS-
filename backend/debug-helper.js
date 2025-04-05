const fs = require("fs-extra");
const path = require("path");

module.exports = {
  // Function to verify directory permissions
  checkDirectoryPermissions: async (dirPath) => {
    try {
      await fs.ensureDir(dirPath);
      // Try to write a test file
      const testFile = path.join(dirPath, `test_${Date.now()}.txt`);
      await fs.writeFile(testFile, "Test write permissions");
      await fs.remove(testFile);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        path: dirPath,
      };
    }
  },
};
