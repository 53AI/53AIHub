import { LibraryItem } from '../libraries'
import { SpaceItem } from '../spaces'
import { RawFileItem } from '../files/types'

export interface FavoriteToggleRequest {
  resource_type: number
  resource_id: string
}

export interface FavoriteListResponse {
  files: {
    favorite_time: number
    file: RawFileItem
    library: LibraryItem
    space: SpaceItem
  }[]
  libraries: {
    favorite_time: number
    library: LibraryItem
    space: SpaceItem
  }[]
}
