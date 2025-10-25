/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { black: "#0D0D0D", white: "#FFFFFF", orange: "#FF6A00" } }
    }
  },
  plugins: []
};
