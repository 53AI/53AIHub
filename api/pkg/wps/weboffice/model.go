package weboffice

import "time"

type File struct {
	info     FileInfo
	versions []FileInfo
}

type FileInfo struct {
	id       string
	creator  string
	modifier string

	name       string
	createTime time.Time
	modifyTime time.Time
	version    int32
	size       int64

	content []byte
	digest  string
}

func (file *FileInfo) ToFileInfo() *GetFileReply {
	return &GetFileReply{
		CreateTime: file.createTime.Unix(),
		CreatorId:  file.creator,
		ID:         file.id,
		ModifierId: file.modifier,
		ModifyTime: file.modifyTime.Unix(),
		Name:       file.name,
		Size:       file.size,
		Version:    file.version,
	}
}
