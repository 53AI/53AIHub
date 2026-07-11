import {
  formatFileSize,
  getGreetingByTime,
  joinUrl,
} from '@km/shared-utils/universal'
import { Link } from 'expo-router'
import { Image, Text, View } from 'react-native'

// shared-public 图片（PNG）- Metro 通过 extraNodeModules 解析 @km/shared-public
const SharedLogo =
  require('@km/shared-public/images/space/logo.png') as number

// shared-public SVG（需 react-native-svg-transformer）
const StarIcon = require('@km/shared-public/icons/star.svg').default

export default function HomeScreen() {
  const greeting = getGreetingByTime()
  const fileSizeStr = formatFileSize(1536)
  const joinedUrl = joinUrl('https://example.com/api', 'id=1&name=km')

  return (
    <View className="flex-1 bg-white items-center justify-center p-6">
      <Text className="text-xl mb-6">{greeting}</Text>

      {/* shared-public: 图片 + SVG */}
      <View className="mb-6 items-center">
        <Text className="mb-2 text-sm text-gray-500">shared-public 资源</Text>
        <Image
          source={SharedLogo}
          resizeMode="contain"
          style={{ width: 128, height: 64 }}
        />
        <View className="mt-2">
          <StarIcon width={32} height={32} color="#1a1a2e" />
        </View>
      </View>

      {/* shared-utils: 方法 */}
      <View className="mb-6">
        <Text className="mb-1 text-sm text-gray-500">shared-utils 示例</Text>
        <Text className="text-base">
          formatFileSize(1536) = {fileSizeStr}
        </Text>
        <Text className="mt-1 text-xs text-gray-600" numberOfLines={2}>
          joinUrl(...) = {joinedUrl}
        </Text>
      </View>

      <Link href="/todo" asChild>
        <View className="py-3 px-5 bg-[#1a1a2e] rounded-lg">
          <Text className="text-white text-base">进入待办列表 →</Text>
        </View>
      </Link>
    </View>
  )
}
