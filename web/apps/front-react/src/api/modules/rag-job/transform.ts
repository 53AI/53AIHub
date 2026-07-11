import { RagJobItem } from './types';
import { formatFileInfo } from '@/api/modules/files/transform';

export const transformJobs = (data: RagJobItem[]) => {
  return data?.map((item: RagJobItem) => {
    const file_info = item.metadata && JSON.parse(item.metadata)?.file_info
    if(file_info) {
      const { fname, icon } = formatFileInfo(file_info.name)
      return {
        ...item,
        file_info: {
          ...file_info,
          name: fname,
          icon
        }
      }
    }
    return item
  })
}
