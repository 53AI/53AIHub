package model

// ResourceType defines constants for resource types
const (
	ResourceTypeAgent        = "agent"      // Agent resource type
	ResourceTypeUser         = "user"       // User resource type
	ResourceTypeDepartment   = "department" // Department resource type
	ResourceTypePrompt       = "prompt"     // Prompt resource type
	ResourceTypeAILink       = "ai_link"
	ResourceTypeSkillLibrary = "skill_library" // Skill library resource type
)

// Permission defines constants for permission types
const (
	PermissionRead  = "read"  // Read permission
	PermissionWrite = "write" // Write permission
)

// ResourcePermission defines the resource permission association table
type ResourcePermission struct {
	ID           int64       `json:"id" gorm:"primaryKey;autoIncrement"`
	GroupID      int64       `json:"group_id" gorm:"not null;index:idx_group_resource"`
	ResourceID   int64       `json:"resource_id" gorm:"not null;index:idx_group_resource"`
	ResourceType string      `json:"resource_type" gorm:"not null;index:idx_group_resource;type:varchar(100)"` // agent, user, department
	Permission   string      `json:"permission" gorm:"not null;type:varchar(50)"`
	User         *User       `json:"user,omitempty" gorm:"-"`
	Department   *Department `json:"department,omitempty" gorm:"-"`
	BaseModel
}

// TableName specifies the table name for ResourcePermission
func (ResourcePermission) TableName() string {
	return "resource_permissions"
}

// Create creates a new resource permission
func (rule *ResourcePermission) Create() error {
	return DB.Create(rule).Error
}

// Update updates an existing resource permission
func (rule *ResourcePermission) Update() error {
	return DB.Save(rule).Error
}

// Delete deletes a resource permission
func (rule *ResourcePermission) Delete() error {
	return DB.Delete(rule).Error
}

// GetResourcePermissionByID retrieves a resource permission by ID
func GetResourcePermissionByID(id int64) (*ResourcePermission, error) {
	var rule ResourcePermission
	err := DB.Where("id = ?", id).First(&rule).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// GetResourcePermissionsByGroupID retrieves all permissions for a specific group
func GetResourcePermissionsByGroupID(groupID int64) ([]*ResourcePermission, error) {
	var rules []*ResourcePermission
	err := DB.Where("group_id = ?", groupID).Find(&rules).Error
	if err != nil {
		return nil, err
	}
	return rules, nil
}

// CheckPermission checks if a group has permission for a specific resource
func CheckPermission(groupID int64, resourceID int64, resourceType string, requiredPermission string) (bool, error) {
	var count int64
	err := DB.Model(&ResourcePermission{}).
		Where("group_id = ? AND resource_id = ? AND resource_type = ? AND permission = ?",
			groupID, resourceID, resourceType, requiredPermission).
		Count(&count).Error

	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// GetResourcesByGroupAndType retrieves all resources of a specific type that a group has access to
func GetResourcesByGroupAndType(groupID int64, resourceType string) ([]int64, error) {
	var resourceIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Where("group_id = ? AND resource_type = ?", groupID, resourceType).
		Pluck("resource_id", &resourceIDs).Error

	if err != nil {
		return nil, err
	}

	return resourceIDs, nil
}

func GetDistinctResourceIDsByGroupsAndType(groupIDs []int64, resourceType string) ([]int64, error) {
	if len(groupIDs) == 0 {
		return []int64{}, nil
	}

	var resourceIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Distinct("resource_id").
		Where("group_id IN (?) AND resource_type = ?", groupIDs, resourceType).
		Pluck("resource_id", &resourceIDs).Error
	if err != nil {
		return nil, err
	}
	if resourceIDs == nil {
		resourceIDs = []int64{}
	}
	return resourceIDs, nil
}

func GetResourcePermissionGroupIDs(resourceID int64, resourceType string) ([]int64, error) {
	var groupIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Where("resource_id = ? AND resource_type = ?", resourceID, resourceType).
		Pluck("group_id", &groupIDs).Error
	if err != nil {
		return nil, err
	}
	if groupIDs == nil {
		groupIDs = []int64{}
	}
	return groupIDs, nil
}

// DeleteResourcePermissionsByResource
func DeleteResourcePermissionsByResource(resourceID int64, resourceType string) error {
	return DB.Where("resource_id = ? AND resource_type = ?", resourceID, resourceType).Delete(&ResourcePermission{}).Error
}

func GetGroupsByUserID(userID int64) ([]int64, error) {
	var groupIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Where("resource_id = ? AND resource_type = ?", userID, ResourceTypeUser).
		Pluck("group_id", &groupIDs).Error

	if err != nil {
		return nil, err
	}

	return groupIDs, nil
}

func GetGroupsByUserIDAndType(userID int64, groupType int64) ([]int64, error) {
	var groupIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Select("resource_permissions.group_id").
		Joins("JOIN groups ON groups.group_id = resource_permissions.group_id").
		Where("resource_permissions.resource_id = ? AND resource_permissions.resource_type = ? AND groups.group_type = ?",
			userID, ResourceTypeUser, groupType).
		Pluck("resource_permissions.group_id", &groupIDs).Error

	if err != nil {
		return nil, err
	}

	return groupIDs, nil
}

func GetGroupsByDepartmentID(departmentID int64) ([]int64, error) {
	var groupIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Where("resource_id = ? AND resource_type = ?", departmentID, ResourceTypeDepartment).
		Pluck("group_id", &groupIDs).Error

	if err != nil {
		return nil, err
	}

	return groupIDs, nil
}

func GetGroupIDsByDepartmentIDs(dids []int64) ([]int64, error) {
	var groupIDs []int64

	err := DB.Model(&ResourcePermission{}).Where("resource_type = ? AND resource_id IN (?)", ResourceTypeDepartment, dids).Pluck("group_id", &groupIDs).Error
	if err != nil {
		return nil, err
	}

	return groupIDs, nil
}
