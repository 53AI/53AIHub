import { useLibraryStore } from '@/stores/modules/library'
import { RESOURCE_TYPE } from '@/components/KMPermission/constant'
import { LibraryFav } from '../../../components/fav'

export function FileFav() {
  const libraryStore = useLibraryStore()
  const currentFile = libraryStore.currentFile()

  if (!currentFile) {
    return null
  }

  const handleFavoriteChange = (value: boolean) => {
    libraryStore.updateFile({
      id: currentFile.id,
      is_favorite: value
    })
  }

  return (
    <LibraryFav
      is_favorite={currentFile.is_favorite}
      resource_type={RESOURCE_TYPE.file}
      resource_id={currentFile.id}
      onChange={handleFavoriteChange}
    />
  )
}

export default FileFav
