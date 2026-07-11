import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'

export function Error500View() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full">
      <h1 className="text-6xl font-bold text-gray-300 mb-4">500</h1>
      <p className="text-xl text-gray-600 mb-8">服务器错误</p>
      <Button type="primary" onClick={() => navigate('/')}>
        返回首页
      </Button>
    </div>
  )
}
