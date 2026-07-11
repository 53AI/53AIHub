/** @type {import('tailwindcss').Config} */
const sharedPreset = require('../../tailwind.preset.js')

module.exports = {
  presets: [sharedPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared-components-react/src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared-business/src/**/*.{js,ts,jsx,tsx}',
  ],
}

