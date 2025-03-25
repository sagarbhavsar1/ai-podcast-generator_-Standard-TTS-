// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

// This file will help debug React testing issues
console.log("React environment variables check:");
console.log("REACT_APP_API_URL:", process.env.REACT_APP_API_URL);
console.log("PUBLIC_URL:", process.env.PUBLIC_URL);

// Test if we can access window object (browser environment)
if (typeof window !== "undefined") {
  console.log("Running in browser environment");
}
