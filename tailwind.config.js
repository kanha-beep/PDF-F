/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        viewer: '0 24px 80px rgba(15, 23, 42, 0.28)'
      }
    }
  },
  plugins: []
};
