module.exports = {
  // 所有代码文件统一使用 Biome 进行格式化和检查
  '*.{js,jsx,ts,tsx,vue,css,scss,sass,less,styl,json,md,yml,yaml}': ['biome check --write']
}
