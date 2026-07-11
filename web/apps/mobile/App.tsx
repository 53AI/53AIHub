import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { getGreetingByTime, generateRandomId } from '@km/shared-utils/universal'

export default function App() {
  const greeting = getGreetingByTime()
  const id = generateRandomId(8)
  return (
    <View style={styles.container}>
      <Text>{greeting}</Text>
      <Text style={styles.hint}>ID: {id}</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
  },
})
