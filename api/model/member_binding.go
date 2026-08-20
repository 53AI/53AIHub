package model

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Member binding source constants
const (
	MemberBindingSourceNone   = 0 // No binding
	MemberBindingSourceWeChat = 1 // WeChat Enterprise
)

// Member binding status constants
const (
	MemberBindingStatusInactive = 0 // Inactive
	MemberBindingStatusActive   = 1 // Active
	MemberBindingStatusDisabled = 2 // Disabled
	MemberBindingStatusExpired  = 3 // Expired
)

// MemberBinding represents a binding between a member and a third-party platform
type MemberBinding struct {
	ID        int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement;comment:'Serial ID'"`
	MID       int64  `json:"mid" gorm:"column:mid;not null;default:0;comment:'enterprise_member.id'"`
	EID       int64  `json:"eid" gorm:"column:eid;not null;default:0;comment:'Enterprise ID'"`
	Name      string `json:"name" gorm:"column:name;size:255;not null;default:'';comment:'Name obtained under different authorization scenarios'"`
	BindValue string `json:"bind_value" gorm:"column:bindvalue;size:255;not null;default:'';comment:'WeChat Enterprise, DingTalk unionid'"`
	Status    int    `json:"status" gorm:"column:status;not null;default:0;comment:'Status'"`
	From      int    `json:"from" gorm:"column:from;not null;default:0;comment:'Binding source: 0-Default;1-WeChat Enterprise;'"`
	BaseModel
}

// TableName specifies the table name for MemberBinding model
func (MemberBinding) TableName() string {
	return "member_bindings"
}

// InitMemberBindingTable initializes the member_binding table
func InitMemberBindingTable() error {
	// Check if table exists
	if DB.Migrator().HasTable(&MemberBinding{}) {
		return nil
	}

	// Create table
	err := DB.Migrator().CreateTable(&MemberBinding{})
	if err != nil {
		return fmt.Errorf("failed to create member_binding table: %w", err)
	}

	return nil
}

// CreateMemberBinding creates a new member binding
func CreateMemberBinding(binding *MemberBinding) error {
	if err := validateMemberBinding(binding); err != nil {
		return err
	}

	// Create binding in database
	result := DB.Create(binding)
	return result.Error
}

// validateMemberBinding validates member binding fields
func validateMemberBinding(binding *MemberBinding) error {
	if binding == nil {
		return errors.New("member binding cannot be nil")
	}
	if binding.MID == 0 {
		return errors.New("member ID (MID) cannot be empty")
	}
	if binding.EID == 0 {
		return errors.New("enterprise ID (EID) cannot be empty")
	}
	if binding.BindValue == "" {
		return errors.New("bind value cannot be empty")
	}
	return nil
}

// GetMemberBindingByID retrieves a member binding by its ID
func GetMemberBindingByID(id int64) (*MemberBinding, error) {
	var binding MemberBinding
	result := DB.Where("id = ?", id).First(&binding)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("member binding not found with ID %d", id)
		}
		return nil, result.Error
	}
	return &binding, nil
}

// GetMemberBindingByMID retrieves member bindings by member ID
func GetMemberBindingByMID(mid int64) ([]*MemberBinding, error) {
	var bindings []*MemberBinding
	result := DB.Where("mid = ?", mid).Find(&bindings)
	if result.Error != nil {
		return nil, result.Error
	}
	return bindings, nil
}

func GetMemberBindingByMidAndFrom(mid int64, from int) (*MemberBinding, error) {
	var binding MemberBinding
	result := DB.Where(map[string]interface{}{"mid": mid, "from": from}).First(&binding)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &binding, nil
}

func GetMemberBindingByDepartmentFromBackend(mid int64, tx *gorm.DB) (*MemberBinding, error) {
	user, err := GetUserByID(mid)
	if err != nil {
		return nil, err
	}

	bindValue, err := GetMemberBindingByMidAndFrom(mid, DepartmentFromBackend)
	if err != nil {
		return nil, err
	}

	if bindValue == nil {
		// create
		bindValue = &MemberBinding{
			MID:       mid,
			EID:       user.Eid,
			Name:      user.Username,
			BindValue: fmt.Sprintf("%d", user.UserID),
			Status:    MemberBindingStatusActive,
			From:      DepartmentFromBackend,
		}
		err := tx.Create(bindValue).Error
		if err != nil {
			return nil, err
		}
	}

	return bindValue, nil
}

// GetMemberBindingByBindValue retrieves a member binding by bind value and source
func GetMemberBindingByBindValue(eid int64, bindValue string, from int) (*MemberBinding, error) {
	var binding MemberBinding
	result := DB.Where(map[string]interface{}{"eid": eid, "bindvalue": bindValue, "from": from}).First(&binding)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &binding, nil
}

// GetMemberBindings retrieves all member bindings for a specific enterprise
func GetMemberBindings(eid int64, from int, status int, offset, limit int) ([]*MemberBinding, int64, error) {
	var bindings []*MemberBinding
	var count int64

	query := DB.Model(&MemberBinding{}).Where("eid = ?", eid)

	if from > 0 {
		query = query.Where("from = ?", from)
	}

	if status >= 0 {
		query = query.Where("status = ?", status)
	}

	// Get total count
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}

	// Get paginated results
	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}

	result := query.Order("id DESC").Find(&bindings)
	if result.Error != nil {
		return nil, 0, result.Error
	}

	return bindings, count, nil
}

// UpdateMemberBinding updates an existing member binding
func UpdateMemberBinding(binding *MemberBinding) error {
	if binding.ID == 0 {
		return errors.New("binding ID cannot be empty")
	}

	// Check if binding exists
	_, err := GetMemberBindingByID(binding.ID)
	if err != nil {
		return fmt.Errorf("member binding not found: %w", err)
	}

	// Update binding in database
	result := DB.Model(binding).Updates(map[string]interface{}{
		"mid":       binding.MID,
		"name":      binding.Name,
		"bindvalue": binding.BindValue,
		"status":    binding.Status,
		"from":      binding.From,
	})

	return result.Error
}

// DeleteMemberBinding deletes a member binding
func DeleteMemberBinding(id int64) error {
	// Check if binding exists
	_, err := GetMemberBindingByID(id)
	if err != nil {
		return fmt.Errorf("member binding not found: %w", err)
	}

	// Delete binding from database
	result := DB.Delete(&MemberBinding{}, id)
	return result.Error
}

// BatchDeleteMemberBindings deletes multiple member bindings
func BatchDeleteMemberBindings(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	result := DB.Where("id IN ?", ids).Delete(&MemberBinding{})
	return result.Error
}

// DeleteMemberBindingsByMID deletes all bindings for a specific member
func DeleteMemberBindingsByMID(mid int64) error {
	result := DB.Where("mid = ?", mid).Delete(&MemberBinding{})
	return result.Error
}

// ActivateMemberBinding activates a member binding
func ActivateMemberBinding(id int64) error {
	result := DB.Model(&MemberBinding{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     MemberBindingStatusActive,
		"updatetime": time.Now(),
	})
	return result.Error
}

// DeactivateMemberBinding deactivates a member binding
func DeactivateMemberBinding(id int64) error {
	result := DB.Model(&MemberBinding{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     MemberBindingStatusDisabled,
		"updatetime": time.Now(),
	})
	return result.Error
}

// CountMemberBindings counts the number of bindings in an enterprise
func CountMemberBindings(eid int64, from int) (int64, error) {
	var count int64
	query := DB.Model(&MemberBinding{}).Where("eid = ?", eid)

	if from > 0 {
		query = query.Where("from = ?", from)
	}

	result := query.Count(&count)
	return count, result.Error
}

// GetMemberBindingsBySource retrieves all bindings from a specific source
func GetMemberBindingsBySource(eid int64, from int) ([]*MemberBinding, error) {
	var bindings []*MemberBinding
	result := DB.Where("eid = ? AND from = ?", eid, from).Find(&bindings)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
	}
	return bindings, nil
}
