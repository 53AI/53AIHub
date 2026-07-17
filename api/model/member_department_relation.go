package model

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// MemberDepartmentRelation source constants
const (
	MemberDepartmentRelationFromBackend = 0 // Created from Backend
	MemberDepartmentRelationFromWeChat  = 1 // Imported from Enterprise WeChat
)

// MemberDepartmentRelation represents the relationship between members and departments
type MemberDepartmentRelation struct {
	ID   int64 `json:"id" gorm:"column:id;primaryKey;autoIncrement;comment:'Relation ID'"`
	DID  int64 `json:"did" gorm:"column:did;not null;default:0;index:idx_did_eid_from,priority:1;comment:'Department ID'"`
	EID  int64 `json:"eid" gorm:"column:eid;not null;default:0;index:idx_bid_eid,priority:2;index:idx_did_eid_from,priority:2;comment:'Enterprise ID'"`
	BID  int64 `json:"bid" gorm:"column:bid;not null;default:0;index:idx_bid_eid,priority:1;comment:'Member Binding ID'"`
	From int   `json:"from" gorm:"column:from;not null;default:0;index:idx_did_eid_from,priority:3;comment:'Source: 0-Backend, 1-Enterprise WeChat'"`
	BaseModel
}

// TableName specifies the table name for MemberDepartmentRelation model
func (MemberDepartmentRelation) TableName() string {
	return "member_department_relations"
}

// CreateMemberDepartmentRelation creates a new member-department relation
func CreateMemberDepartmentRelation(relation *MemberDepartmentRelation) error {
	if err := validateMemberDepartmentRelation(relation); err != nil {
		return err
	}

	result := DB.Create(relation)
	return result.Error
}

// validateMemberDepartmentRelation validates member-department relation fields
func validateMemberDepartmentRelation(relation *MemberDepartmentRelation) error {
	if relation == nil {
		return errors.New("relation cannot be nil")
	}
	if relation.DID == 0 {
		return errors.New("department ID (DID) cannot be empty")
	}
	if relation.EID == 0 {
		return errors.New("enterprise ID (EID) cannot be empty")
	}
	if relation.BID == 0 {
		return errors.New("member binding ID (BID) cannot be empty")
	}
	return nil
}

// GetMemberDepartmentRelationByID retrieves a relation by its ID
func GetMemberDepartmentRelationByID(id int64) (*MemberDepartmentRelation, error) {
	var relation MemberDepartmentRelation
	result := DB.Where("id = ?", id).First(&relation)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("relation not found with ID %d", id)
		}
		return nil, result.Error
	}
	return &relation, nil
}

// GetMemberDepartmentRelationsByEID retrieves all relations for a specific enterprise
func GetMemberDepartmentRelationsByEID(eid int64) ([]*MemberDepartmentRelation, error) {
	var relations []*MemberDepartmentRelation
	result := DB.Where("eid = ?", eid).Find(&relations)
	if result.Error != nil {
		return nil, result.Error
	}
	return relations, nil
}

// GetMemberDepartmentRelationsByDID retrieves all relations for a specific department
func GetMemberDepartmentRelationsByDID(eid int64, did int64) ([]*MemberDepartmentRelation, error) {
	var relations []*MemberDepartmentRelation
	result := DB.Where("eid = ? AND did = ?", eid, did).Find(&relations)
	if result.Error != nil {
		return nil, result.Error
	}
	return relations, nil
}

// GetMemberDepartmentRelationsByBID retrieves all relations for a specific member binding
func GetMemberDepartmentRelationsByBID(eid int64, bid int64) ([]*MemberDepartmentRelation, error) {
	var relations []*MemberDepartmentRelation
	result := DB.Where("eid = ? AND bid = ?", eid, bid).Find(&relations)
	if result.Error != nil {
		return nil, result.Error
	}
	return relations, nil
}

func GetMemberDidsByBID(eid int64, bid int64) ([]int64, error) {
	var dids []int64
	var relations []*MemberDepartmentRelation
	result := DB.Where("eid = ? AND bid = ?", eid, bid).Find(&relations)
	if result.Error != nil {
		return nil, result.Error
	}

	for _, relation := range relations {
		dids = append(dids, relation.DID)
	}

	return dids, nil
}

// UpdateMemberDepartmentRelation updates an existing relation
func UpdateMemberDepartmentRelation(relation *MemberDepartmentRelation) error {
	if relation.ID == 0 {
		return errors.New("relation ID cannot be empty")
	}

	// Check if relation exists
	_, err := GetMemberDepartmentRelationByID(relation.ID)
	if err != nil {
		return fmt.Errorf("relation not found: %w", err)
	}

	// Update relation in database
	result := DB.Model(relation).Updates(map[string]interface{}{
		"did":  relation.DID,
		"eid":  relation.EID,
		"bid":  relation.BID,
		"from": relation.From,
	})

	return result.Error
}

// DeleteMemberDepartmentRelation deletes a relation by its ID
func DeleteMemberDepartmentRelation(id int64) error {
	// Check if relation exists
	_, err := GetMemberDepartmentRelationByID(id)
	if err != nil {
		return fmt.Errorf("relation not found: %w", err)
	}

	// Delete relation from database
	result := DB.Delete(&MemberDepartmentRelation{}, id)
	return result.Error
}

// DeleteMemberDepartmentRelationsByDID deletes all relations for a specific department
func DeleteMemberDepartmentRelationsByDID(eid int64, did int64) error {
	result := DB.Where("eid = ? AND did = ?", eid, did).Delete(&MemberDepartmentRelation{})
	return result.Error
}

// DeleteMemberDepartmentRelationsByBID deletes all relations for a specific member binding
func DeleteMemberDepartmentRelationsByBID(eid int64, bid int64) error {
	result := DB.Where("eid = ? AND bid = ?", eid, bid).Delete(&MemberDepartmentRelation{})
	return result.Error
}

// BatchCreateMemberDepartmentRelations creates multiple relations in a single transaction
func BatchCreateMemberDepartmentRelations(relations []*MemberDepartmentRelation) error {
	if len(relations) == 0 {
		return nil
	}

	// Begin transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Create each relation
	for _, relation := range relations {
		if err := validateMemberDepartmentRelation(relation); err != nil {
			tx.Rollback()
			return err
		}

		if err := tx.Create(relation).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	// Commit transaction
	return tx.Commit().Error
}

func GetUsersByDepartmentIDs(eid int64, dids []int64) ([]int64, error) {
	if len(dids) == 0 {
		return []int64{}, nil
	}

	var relations []*MemberDepartmentRelation
	err := DB.Where("eid = ? AND did IN ?", eid, dids).Find(&relations).Error
	if err != nil {
		return nil, err
	}

	bidMap := make(map[int64]bool)
	for _, relation := range relations {
		bidMap[relation.BID] = true
	}

	bids := make([]int64, 0, len(bidMap))
	for bid := range bidMap {
		bids = append(bids, bid)
	}

	if len(bids) == 0 {
		return []int64{}, nil
	}

	var userIDs []int64
	err = DB.Model(&User{}).Where("eid = ? AND binding_id IN ?", eid, bids).Pluck("user_id", &userIDs).Error
	if err != nil {
		return nil, err
	}

	return userIDs, nil
}
