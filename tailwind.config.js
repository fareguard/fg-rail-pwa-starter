/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#10b981",
          primaryDark: "#059669",
          text: "#1e293b",
          muted: "#64748b",
          bg: "#ffffff",
          surface: "#f8fafc",
          border: "#e2e8f0",
        },
      },
    },
  },
  plugins: [],
};
