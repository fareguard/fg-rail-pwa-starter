/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
  colors: {
    brand: {
      primary: "#10b981",      // emerald green
      primaryDark: "#059669",  // darker emerald
      text: "#1e293b",         // navy/slate-800
      muted: "#64748b",        // slate-500
      bg: "#ffffff",           // white
      surface: "#f8fafc",      // off-white
      border: "#e2e8f0"        // slate-200
    }
  }
}
  },
  plugins: []
};
