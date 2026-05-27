package enterpriseinit

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

//go:embed graph_template_seed.json
var graphTemplateSeedFS embed.FS

type graphTemplateSeedFile struct {
	Version    string              `json:"version"`
	SourceEID  int64               `json:"source_eid"`
	ExportedAt string              `json:"exported_at"`
	Templates  []graphTemplateSeed `json:"templates"`
}

type graphTemplateSeed struct {
	Name        string                      `json:"name"`
	Description string                      `json:"description"`
	Logo        string                      `json:"logo"`
	Entities    []*model.EntityDefinition   `json:"entities"`
	Relations   []*model.RelationDefinition `json:"relations"`
}

func loadGraphTemplateSeeds() ([]graphTemplateSeed, error) {
	data, err := graphTemplateSeedFS.ReadFile("graph_template_seed.json")
	if err != nil {
		return nil, err
	}

	var seedFile graphTemplateSeedFile
	if err := json.Unmarshal(data, &seedFile); err != nil {
		return nil, err
	}
	if len(seedFile.Templates) == 0 {
		return nil, errors.New("graph template seed file contains no templates")
	}

	return seedFile.Templates, nil
}

func ensureGraphTemplateFromSeed(tx *gorm.DB, eid int64, seed graphTemplateSeed) (*model.GraphTemplate, error) {
	if tx == nil {
		return nil, errors.New("db is nil")
	}
	if strings.TrimSpace(seed.Name) == "" {
		return nil, errors.New("graph template seed name is empty")
	}

	var template model.GraphTemplate
	if err := tx.Where("eid = ? AND name = ?", eid, seed.Name).First(&template).Error; err == nil {
		return &template, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if err := model.ValidateEntities(seed.Entities); err != nil {
		return nil, fmt.Errorf("validate graph template %q entities: %w", seed.Name, err)
	}

	entityNames := make(map[string]bool, len(seed.Entities))
	for _, entity := range seed.Entities {
		entityNames[entity.Name] = true
	}
	if err := model.ValidateRelations(seed.Relations, entityNames); err != nil {
		return nil, fmt.Errorf("validate graph template %q relations: %w", seed.Name, err)
	}

	template = model.GraphTemplate{
		Eid:         eid,
		Name:        seed.Name,
		Description: seed.Description,
		Logo:        seed.Logo,
	}
	if err := template.SetEntities(seed.Entities); err != nil {
		return nil, err
	}
	if err := template.SetRelations(seed.Relations); err != nil {
		return nil, err
	}
	if err := tx.Create(&template).Error; err != nil {
		return nil, err
	}

	return &template, nil
}

func ensureSeededGraphTemplates(tx *gorm.DB, eid int64) (*model.GraphTemplate, error) {
	seeds, err := loadGraphTemplateSeeds()
	if err != nil {
		return nil, err
	}

	var defaultTemplate *model.GraphTemplate
	for _, seed := range seeds {
		template, err := ensureGraphTemplateFromSeed(tx, eid, seed)
		if err != nil {
			return nil, err
		}
		if seed.Name == model.DefaultGraphTemplateName {
			defaultTemplate = template
		}
	}

	if defaultTemplate == nil {
		return nil, fmt.Errorf("default graph template %q not found in seed file", model.DefaultGraphTemplateName)
	}

	return defaultTemplate, nil
}
