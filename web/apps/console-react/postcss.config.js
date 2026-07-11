// 在测试环境中跳过 PostCSS 处理
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports = {
    plugins: {},
  }
} else {
  module.exports = {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  }
}
