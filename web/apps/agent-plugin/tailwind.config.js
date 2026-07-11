/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared-business/src/**/*.{js,ts,jsx,tsx}',
    '../../packages/hub-ui-x-react/packages/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared-components-react/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
