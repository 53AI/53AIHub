export namespace Library {
  /**
   * 文件类型枚举
   */
  export enum FileType {
    /** 文件夹类型 */
    Folder = 0,
    /** 文件类型 */
    File = 1,
  }

  /**
   * 文件接口定义
   */
  export interface File {
    id: never
    sort: number
    path: string
    name: string
    extension: string
    isfolder: boolean
    isfile: boolean
    type: FileType.File | FileType.Folder
    base_path: string
    base_path_hash: string
    created_time: number
    updated_time: number
    updated_at: string
    created_at: string
  }

  /**
   * 格式化后的文件接口
   */
  export interface FormattedFile {
    id: number | string
    name: string
    icon: string
    isfolder: boolean
    isfile: boolean
    base_path: string
    extension: string
    created_at: string
    updated_at: string
    [key: string]: any
  }

  /**
   * 格式化后的图书馆接口
   */
  export interface FormattedLibrary {
    id: number
    name: string
    description: string
    updated_at: string
    updated_date: string
    [key: string]: any
  }
}
