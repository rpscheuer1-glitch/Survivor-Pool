/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        turf: "#1F2A35",
        turfline: "#3A4756",
        chalk: "#EDEFF2",
        navy: "#141B22",
        amber: "#F2661A",
        rust: "#D6453A",
        leaf: "#3FA66C",
      },
    },
  },
  plugins: [],
};
