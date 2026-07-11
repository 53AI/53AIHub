package controller

import (
	"path/filepath"

	"github.com/53AI/53AIHub/model"
)

func trimPersonalLibraryFilePath(file *model.File, library *model.Library) {
	if file == nil || library == nil || !library.IsPersonalLibrary() {
		return
	}
	if file.Path == "" {
		return
	}
	file.Path = filepath.Base(file.Path)
}
