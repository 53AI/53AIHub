package service

import (
	"regexp"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var wikiLinkPattern = regexp.MustCompile(`\[\[([^|\]]+?)(?:\|([^\]]+))?\]\]`)

type WikiLinkTarget struct {
	Slug       string
	AnchorText string
	Aliases    []string
}

type WikiLinkService struct{}

func NewWikiLinkService() *WikiLinkService {
	return &WikiLinkService{}
}

func (s *WikiLinkService) ExtractWikiLinkTargets(markdown string) []WikiLinkTarget {
	matches := wikiLinkPattern.FindAllStringSubmatch(markdown, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(matches))
	targets := make([]WikiLinkTarget, 0, len(matches))
	for _, match := range matches {
		slug := strings.TrimSpace(match[1])
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}

		anchor := slug
		if len(match) > 2 && strings.TrimSpace(match[2]) != "" {
			anchor = strings.TrimSpace(match[2])
		}
		targets = append(targets, WikiLinkTarget{Slug: slug, AnchorText: anchor})
	}
	return targets
}

func (s *WikiLinkService) BuildPageLinks(ctxLinks []WikiLinkTarget, fromPageID, eid, libraryID, creatorID int64, db *gorm.DB) []model.WikiPageLink {
	links := make([]model.WikiPageLink, 0, len(ctxLinks))
	for _, target := range ctxLinks {
		link := model.WikiPageLink{
			Eid:        eid,
			FromPageID: fromPageID,
			LinkKind:   model.WikiPageLinkKindWiki,
			AnchorText: target.AnchorText,
			TargetSlug: target.Slug,
			CreatorID:  creatorID,
		}
		if db != nil {
			resolvedSlug := strings.TrimSpace(target.Slug)
			for hops := 0; hops < 8 && resolvedSlug != ""; hops++ {
				var targetPage model.WikiPage
				if err := db.Where("eid = ? AND library_id = ? AND slug = ?", eid, libraryID, resolvedSlug).First(&targetPage).Error; err == nil {
					link.ToPageID = targetPage.ID
					break
				}
				var redirect model.WikiPageRedirect
				if err := db.Where("eid = ? AND library_id = ? AND from_slug = ?", eid, libraryID, resolvedSlug).First(&redirect).Error; err != nil {
					break
				}
				nextSlug := strings.TrimSpace(redirect.ToSlug)
				if nextSlug == "" || nextSlug == resolvedSlug {
					break
				}
				resolvedSlug = nextSlug
			}
		}
		links = append(links, link)
	}
	return links
}
