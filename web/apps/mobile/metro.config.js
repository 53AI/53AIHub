const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')
const packagesRoot = path.join(monorepoRoot, 'packages')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

const rootNodeModules = path.resolve(monorepoRoot, 'node_modules')
config.watchFolders = [packagesRoot, path.resolve(projectRoot, 'node_modules'), rootNodeModules]
config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true
const defaultExtra = config.resolver.extraNodeModules || {}
const fs = require('fs')
config.resolver.extraNodeModules = new Proxy(defaultExtra, {
  get(target, name) {
    const key = String(name)
    if (key === '@km/shared-public') return path.join(packagesRoot, 'shared-public')
    const mobilePath = path.resolve(projectRoot, 'node_modules', ...key.split('/'))
    const rootPath = path.resolve(rootNodeModules, ...key.split('/'))
    if (key === '@babel/runtime' || key.startsWith('@babel/')) {
      if (fs.existsSync(mobilePath)) return mobilePath
      if (fs.existsSync(rootPath)) return rootPath
    }
    if (Object.prototype.hasOwnProperty.call(target, key)) return target[key]
    return mobilePath
  },
})

// shared-public SVG 支持：svg 作为源码经 transformer 转为组件
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer/expo'),
}
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg')
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg']

module.exports = withNativeWind(config, { input: './global.css' })
