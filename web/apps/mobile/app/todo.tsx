import { useTodoStore } from '../store/todoStore'
import { Link } from 'expo-router'
import { useState } from 'react'
import {
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

export default function TodoScreen() {
  const { items, addTodo, toggleTodo, removeTodo } = useTodoStore()
  const [input, setInput] = useState('')

  const handleAdd = () => {
    if (input.trim()) {
      addTodo(input)
      setInput('')
    }
  }

  return (
    <View className="flex-1 bg-gray-100 p-4">
      <View className="flex-row gap-2 mb-4">
        <TextInput
          className="flex-1 h-11 bg-white rounded-lg px-3 text-base border border-gray-300"
          placeholder="输入待办..."
          placeholderTextColor="#999"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
        <TouchableOpacity
          className="justify-center px-5 bg-[#1a1a2e] rounded-lg"
          onPress={handleAdd}
        >
          <Text className="text-white text-base">添加</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        className="flex-1"
        ListEmptyComponent={
          <Text className="text-center text-gray-500 mt-8 text-[15px]">
            暂无待办，添加一条吧
          </Text>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center justify-between bg-white p-3.5 rounded-lg mb-2 border border-gray-200">
            <TouchableOpacity
              className="flex-row items-center flex-1"
              onPress={() => toggleTodo(item.id)}
            >
              <Text
                className={`text-xl mr-3 text-[#1a1a2e] ${item.done ? 'text-green-500' : ''}`}
              >
                {item.done ? '✓' : '○'}
              </Text>
              <Text
                className={`text-base flex-1 ${item.done ? 'line-through text-gray-500' : ''}`}
              >
                {item.title}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-1.5 px-3"
              onPress={() => removeTodo(item.id)}
            >
              <Text className="text-red-500 text-sm">删除</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <Link href="/" className="mt-4 self-center" asChild>
        <Text className="text-[#1a1a2e] text-[15px]">← 返回首页</Text>
      </Link>
    </View>
  )
}
