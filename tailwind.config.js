/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Redefine a fonte padrão (sans) do Tailwind
        sans: [
          'Quicksand', 
          'ui-sans-serif', 
          'system-ui', 
          '-apple-system', 
          'BlinkMacSystemFont', 
          '"Segoe UI"', 
          'Roboto', 
          'sans-serif', 
          '"Apple Color Emoji"', 
          '"Segoe UI Emoji"', 
          '"Segoe UI Symbol"'
        ],
      },
    },
  },
  plugins: [],
}