/** @type {import('tailwindcss').Config} */
import sharedPreset from '../../tailwind.preset.js'

export default {
  presets: [sharedPreset],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/shared-components-react/src/**/*.{js,ts,jsx,tsx}",
    "../../packages/shared-business/src/**/*.{js,ts,jsx,tsx}",
  ],
}
