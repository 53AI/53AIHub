/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')
// width: 0.25rem; -> w-1
// width: 0.5rem; -> w-2

// Filter out deprecated colors
const { lightBlue, warmGray, trueGray, coolGray, blueGray, ...safeColors } = colors

module.exports = {
  darkMode: 'class',
  theme: {
    colors: {
      ...safeColors
    },
    extend: {
      height: {
        15: '3.75rem',
        17: '4.25rem'
      },
      padding: {
        15: '3.75rem'
      },
      animation: {
        blink: 'blink 1.2s infinite steps(1, start)'
      },
      keyframes: {
        blink: {
          '0%, 100%': { 'background-color': 'currentColor' },
          '50%': { 'background-color': 'transparent' }
        }
      }
    }
  },
  plugins: [
    function ({ addBase }) {
      addBase({
        '.el-button': {
          'background-color': 'var(--el-button-bg-color,val(--el-color-white))'
        }
      })
    }
  ]
}
