package service

import (
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
)

type WikiIndexService struct{}

func NewWikiIndexService() *WikiIndexService {
	return &WikiIndexService{}
}

func (s *WikiIndexService) BuildIndexMarkdown(pages []model.WikiPage) string {
	return s.BuildIndexMarkdownWithFolders(pages, nil)
}

func (s *WikiIndexService) BuildIndexMarkdownWithFolders(pages []model.WikiPage, folderPaths map[int64]string) string {
	return s.BuildIndexMarkdownWithFoldersAndIntro(pages, folderPaths, "")
}

func (s *WikiIndexService) BuildIndexMarkdownWithFoldersAndIntro(pages []model.WikiPage, folderPaths map[int64]string, intro string) string {
	if len(pages) == 0 {
		if strings.TrimSpace(intro) != "" {
			return strings.TrimSpace(intro)
		}
		return "# Wiki Index\n\n_No pages available._"
	}

	sort.SliceStable(pages, func(i, j int) bool {
		pathI := folderPaths[pages[i].FolderID]
		pathJ := folderPaths[pages[j].FolderID]
		if pathI == pathJ {
			if pages[i].PageType == pages[j].PageType {
				return pages[i].Title < pages[j].Title
			}
			return pages[i].PageType < pages[j].PageType
		}
		return pathI < pathJ
	})

	grouped := make(map[string][]model.WikiPage)
	folderOrder := make([]string, 0, len(pages))
	seenFolders := make(map[string]struct{})
	for _, page := range pages {
		path := strings.TrimSpace(folderPaths[page.FolderID])
		if path == "" {
			path = "Root"
		}
		grouped[path] = append(grouped[path], page)
		if _, ok := seenFolders[path]; !ok {
			seenFolders[path] = struct{}{}
			folderOrder = append(folderOrder, path)
		}
	}
	sort.Strings(folderOrder)

	var builder strings.Builder
	if strings.TrimSpace(intro) != "" {
		builder.WriteString(strings.TrimSpace(intro))
		builder.WriteString("\n\n")
	} else {
		builder.WriteString("# Wiki Index\n\n")
	}
	for _, folderPath := range folderOrder {
		builder.WriteString(fmt.Sprintf("## %s\n", folderPath))
		pagesInFolder := grouped[folderPath]
		currentType := ""
		for _, page := range pagesInFolder {
			if page.PageType != currentType {
				currentType = page.PageType
				builder.WriteString(fmt.Sprintf("### %s\n", strings.Title(currentType)))
			}
			builder.WriteString(fmt.Sprintf("- [[%s|%s]]\n", page.Slug, page.Title))
		}
		builder.WriteString("\n")
	}
	return strings.TrimSpace(builder.String())
}
