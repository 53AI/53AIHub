import { StarFilled } from '@ant-design/icons'

interface StarRatingProps {
  value: number
  showValue?: boolean
  size?: number
  gap?: 'xs' | 'sm' | 'md' | 'lg'
}

const gapClassMap = {
  xs: 'gap-1',
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-3'
}

const starGapClassMap = {
  xs: 'gap-0.5',
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2'
}

const getStarClipRight = (starIndex: number, value: number): number => {
  if (starIndex <= Math.floor(value)) {
    return 0
  } else if (starIndex === Math.ceil(value)) {
    const decimal = value - Math.floor(value)
    return (1 - decimal) * 100
  } else {
    return 100
  }
}

export const StarRating: React.FC<StarRatingProps> = ({
  value,
  showValue = true,
  size = 14,
  gap = 'xs'
}) => {
  const formattedValue = value.toFixed(1)

  return (
    <div className={`flex items-center ${gapClassMap[gap]}`}>
      {showValue && (
        <span className="text-sm font-bold text-blue-600">
          {formattedValue}
        </span>
      )}
      <div className={`flex ${starGapClassMap[gap]}`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <div key={star} className="relative">
            <StarFilled style={{ fontSize: size }} className="text-gray-200" />
            {star <= Math.ceil(value) && (
              <StarFilled
                style={{
                  fontSize: size,
                  clipPath: `inset(0 ${getStarClipRight(star, value)}% 0 0)`
                }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-500"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default StarRating